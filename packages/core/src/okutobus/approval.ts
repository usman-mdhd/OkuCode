export * as OkuApproval from "./approval.js"

// Okutobus (OkuCode) SRS FR-22: three approval modes, chosen in Settings and kept in <config>/okucode.json.
//   ask        Ask every time: file changes and shell commands both wait for the user's OK.
//   auto-edit  File changes go ahead; shell commands still ask.
//   full-auto  File changes and shell commands go ahead without asking.
// The safety rules (protected files, blocked commands) and explicit "deny" rules always win, and Plan mode
// still cannot edit. Full-auto has no OS sandbox yet (FR-24), so it is meant for trusted folders only.

import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { Global } from "@opencode/util/global"

export const MODES = ["ask", "auto-edit", "full-auto"] as const
export type Mode = (typeof MODES)[number]

export const isMode = (value: unknown): value is Mode => typeof value === "string" && MODES.includes(value as Mode)

const EDIT = new Set(["edit"])
const SHELL = new Set(["shell", "bash"])

export const settingsFile = () => path.join(process.env.OPENCODE_CONFIG_DIR ?? Global.Path.config, "okucode.json")

let cache: { file: string; mtime: number; mode: Mode | undefined } | undefined

/** The chosen mode, or undefined when none is chosen yet (OpenCode's configured rules then apply unchanged). */
export function mode(file = settingsFile()): Mode | undefined {
  try {
    const mtime = statSync(file).mtimeMs
    if (cache && cache.file === file && cache.mtime === mtime) return cache.mode
    const value = (JSON.parse(readFileSync(file, "utf8")) as { approvalMode?: unknown }).approvalMode
    cache = { file, mtime, mode: isMode(value) ? value : undefined }
    return cache.mode
  } catch {
    return undefined
  }
}

/**
 * The effect after applying the approval mode. `explicitAllow` is true when the user already chose "Always" for
 * this request, or a rule allows this exact command or file pattern (FR-23, e.g. "npm test*": allow); such
 * choices are kept in every mode. Catch-all "allow everything" rules are what the mode replaces.
 */
export function apply(current: "allow" | "ask", action: string, selected: Mode | undefined, explicitAllow: boolean) {
  if (!selected) return current
  const edit = EDIT.has(action)
  const shell = SHELL.has(action)
  if (!edit && !shell) return current
  if (selected === "full-auto") return "allow"
  if (selected === "auto-edit") return edit || explicitAllow ? "allow" : "ask"
  return explicitAllow ? "allow" : "ask"
}
