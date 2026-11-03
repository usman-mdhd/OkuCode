export * as OkuAudit from "./audit.js"

// Okutobus (OkuCode) SRS FR-60: tamper-evident audit log of prompts, tool calls and file changes.
//
// Every entry is one JSON line in <data>/audit/YYYY-MM-DD.jsonl. Each entry carries the SHA-256 hash of the entry
// before it ("prev") and its own hash over its content and "prev", so the entries form a chain: changing, removing or
// reordering any entry breaks every hash after it, and verify() reports where. Secrets are redacted and long texts
// are cut before they are written. Settings in okucode.json:
//   "audit": false                 turn the log off
//   "auditRetentionDays": 90       days to keep (default 90; 0 keeps everything)

import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { AuditChain } from "@opencode/util/audit-chain"
import { OkuApproval } from "./approval.js"
import { OkuProtect } from "./protect.js"

export type Kind = AuditChain.Kind
export type Entry = AuditChain.Entry
export type Verification = AuditChain.Verification
export const { directory, files, hashOf, verify } = AuditChain
const day = AuditChain.day
const GENESIS = AuditChain.GENESIS
const MAX_TEXT = 4000

type Settings = { audit?: unknown; auditRetentionDays?: unknown }
function settings(): Settings {
  try {
    return JSON.parse(readFileSync(OkuApproval.settingsFile(), "utf8")) as Settings
  } catch {
    return {}
  }
}

export const enabled = (current = settings()) => current.audit !== false
export const retentionDays = (current = settings()) =>
  typeof current.auditRetentionDays === "number" && current.auditRetentionDays >= 0 ? current.auditRetentionDays : 90

/** Redacts secrets and cuts long strings, recursively. */
export function clean(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const redacted = OkuProtect.redact(value)
    return redacted.length > MAX_TEXT ? `${redacted.slice(0, MAX_TEXT)}… [${redacted.length - MAX_TEXT} more characters]` : redacted
  }
  if (depth > 5 || value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => clean(item, depth + 1))
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clean(item, depth + 1)]))
}

let head: { dir: string; file: string; size: number; seq: number; hash: string } | undefined
let pruned = ""

function lastEntry(dir: string): { seq: number; hash: string } {
  const list = files(dir)
  for (let i = list.length - 1; i >= 0; i--) {
    const lines = readFileSync(path.join(dir, list[i]!), "utf8").trim().split("\n").filter(Boolean)
    const last = lines.at(-1)
    if (!last) continue
    try {
      const entry = JSON.parse(last) as Entry
      return { seq: entry.seq, hash: entry.hash }
    } catch {
      // A damaged last line: start a new chain from it; verify() reports the damage.
      return { seq: lines.length, hash: createHash("sha256").update(last).digest("hex") }
    }
  }
  return { seq: 0, hash: GENESIS }
}

/** Deletes audit files older than the retention period (once a day). */
function prune(dir: string, now: Date) {
  const today = day(now)
  if (pruned === `${dir}\n${today}`) return
  pruned = `${dir}\n${today}`
  const keep = retentionDays()
  if (keep === 0) return
  const oldest = day(new Date(now.getTime() - keep * 86_400_000))
  for (const name of files(dir)) if (name.slice(0, 10) < oldest) rmSync(path.join(dir, name), { force: true })
}

/** The data of a file change: path, what happened, size and SHA-256 of the new content. */
export function fileChange(file: string, change: "created" | "changed" | "deleted", bytes?: Uint8Array) {
  return {
    path: file,
    change,
    ...(bytes ? { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") } : {}),
  }
}

/** Appends one entry. Never throws: auditing must not break the agent. */
export function record(
  kind: Kind,
  data: Record<string, unknown>,
  context: { sessionID?: string; directory?: string } = {},
  now = new Date(),
) {
  try {
    if (!enabled()) return undefined
    const dir = directory()
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    prune(dir, now)
    const file = path.join(dir, `${day(now)}.jsonl`)
    let size = 0
    try {
      size = statSync(file).size
    } catch {}
    // Another process may have written since: read the chain's end again.
    if (!head || head.dir !== dir || head.file !== file || head.size !== size) head = { dir, file, size, ...lastEntry(dir) }
    const base: Omit<Entry, "hash"> = {
      seq: head.seq + 1,
      time: now.toISOString(),
      kind,
      user: process.env.USER || process.env.USERNAME || os.userInfo().username,
      ...(context.sessionID ? { sessionID: context.sessionID } : {}),
      ...(context.directory ? { directory: context.directory } : {}),
      data: clean(data) as Record<string, unknown>,
      prev: head.hash,
    }
    const entry: Entry = { ...base, hash: hashOf(base) }
    const line = `${JSON.stringify(entry)}\n`
    appendFileSync(file, line, { mode: 0o600 })
    head = { dir, file, size: size + Buffer.byteLength(line), seq: entry.seq, hash: entry.hash }
    return entry
  } catch {
    return undefined
  }
}

/** For tests: forget the cached end of the chain. */
export function reset() {
  head = undefined
  pruned = ""
}
