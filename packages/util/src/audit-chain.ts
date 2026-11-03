export * as AuditChain from "./audit-chain.js"

// Okutobus (OkuCode) SRS FR-60: the audit log's hash chain, shared by core (writes entries) and the web server
// (shows and checks the log). See packages/core/src/okutobus/audit.ts.

import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { Global } from "./global.js"

export type Kind = "prompt" | "tool" | "file"

export type Entry = {
  readonly seq: number
  readonly time: string
  readonly kind: Kind
  readonly user: string
  readonly sessionID?: string
  readonly directory?: string
  readonly data: Record<string, unknown>
  readonly prev: string
  readonly hash: string
}

export const GENESIS = "0".repeat(64)

export const directory = () => process.env.OKUCODE_AUDIT_DIR ?? path.join(Global.Path.data, "audit")

export const day = (time: Date) => time.toISOString().slice(0, 10)
const FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/

/** Audit files, oldest first. */
export function files(dir = directory()) {
  try {
    return readdirSync(dir)
      .filter((name) => FILE.test(name))
      .sort()
  } catch {
    return []
  }
}

/** The hash of an entry: SHA-256 over its fields (without "hash") in a fixed order. */
export function hashOf(entry: Omit<Entry, "hash">) {
  const canonical = JSON.stringify([
    entry.seq,
    entry.time,
    entry.kind,
    entry.user,
    entry.sessionID ?? null,
    entry.directory ?? null,
    entry.data,
    entry.prev,
  ])
  return createHash("sha256").update(canonical).digest("hex")
}

export type Verification = {
  readonly ok: boolean
  readonly entries: number
  readonly files: number
  readonly first?: string
  readonly last?: string
  /** Where the chain breaks: file, line (1-based) and why. */
  readonly problem?: { readonly file: string; readonly line: number; readonly reason: string }
}

/** Recomputes every hash and link. The first remaining file may start mid-chain (older files deleted by retention). */
export function verify(dir = directory()): Verification {
  const list = files(dir)
  let entries = 0
  let prev: string | undefined
  let seq: number | undefined
  let first: string | undefined
  let last: string | undefined
  for (const name of list) {
    const lines = readFileSync(path.join(dir, name), "utf8").split("\n")
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]!
      if (!text.trim()) continue
      const fail = (reason: string) => ({ ok: false, entries, files: list.length, first, last, problem: { file: name, line: i + 1, reason } })
      let entry: Entry
      try {
        entry = JSON.parse(text) as Entry
      } catch {
        return fail("not valid JSON")
      }
      const { hash, ...rest } = entry
      if (hashOf(rest) !== hash) return fail("the entry was changed (its hash does not match)")
      if (prev !== undefined && entry.prev !== prev) return fail("an entry before this one was removed or changed")
      if (seq !== undefined && entry.seq !== seq + 1) return fail(`entry number ${entry.seq} follows ${seq}`)
      prev = hash
      seq = entry.seq
      first ??= entry.time
      last = entry.time
      entries++
    }
  }
  return { ok: true, entries, files: list.length, first, last }
}

