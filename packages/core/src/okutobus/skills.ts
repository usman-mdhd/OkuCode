export * as OkuSkills from "./skills.js"

// Okutobus (OkuCode): skills can be switched off in Settings → Extensions → Skills. The names of switched-off skills
// are kept in <config>/okucode.json as "disabledSkills". A switched-off skill is not offered to the model and cannot
// be loaded with the skill tool; switching it on again brings it back without a restart.

import { readFileSync, statSync } from "node:fs"
import { OkuApproval } from "./approval.js"

let cache: { file: string; mtime: number; names: ReadonlySet<string> } | undefined

/** IDs or names of the switched-off skills. */
export function disabled(file = OkuApproval.settingsFile()): ReadonlySet<string> {
  try {
    const mtime = statSync(file).mtimeMs
    if (cache && cache.file === file && cache.mtime === mtime) return cache.names
    const value = (JSON.parse(readFileSync(file, "utf8")) as { disabledSkills?: unknown }).disabledSkills
    const names = new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
    cache = { file, mtime, names }
    return names
  } catch {
    return new Set()
  }
}

/** False when the skill is switched off by its ID or its name. */
export function enabled(skill: { readonly id: string; readonly name: string }, off = disabled()) {
  return !off.has(skill.id) && !off.has(skill.name)
}
