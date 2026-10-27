export * as OkuMemory from "./memory.js"

// Okutobus (OkuCode) SRS FR-35: a message that is a single line starting with "# " is a rule to remember.
// "# always use tabs" is appended to the project memory file (OKUCODE.md, or AGENTS.md when only that exists),
// which OkuCode loads into every chat in this folder. The model is then only asked to confirm it.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const HEADER = "# OkuCode memory\n\nRules OkuCode follows in this project. Added with `# rule` in the chat; edit freely.\n\n"

/** The rule in a "# rule" message, or undefined for normal messages (including markdown like "## Title"). */
export function rule(text: string) {
  const trimmed = text.trim()
  if (trimmed.includes("\n")) return undefined
  const match = /^#(?!#)\s+(.+)$/.exec(trimmed)
  const value = match?.[1]?.trim()
  return value && value.length <= 500 ? value : undefined
}

/** The memory file for a folder: OKUCODE.md, or AGENTS.md when only that one exists. */
export function file(directory: string) {
  const okucode = path.join(directory, "OKUCODE.md")
  const agents = path.join(directory, "AGENTS.md")
  return !existsSync(okucode) && existsSync(agents) ? agents : okucode
}

/** Appends the rule as a bullet and returns the file it was written to. */
export function save(directory: string, value: string) {
  const target = file(directory)
  if (!existsSync(target)) {
    writeFileSync(target, `${HEADER}- ${value}\n`)
    return target
  }
  const current = readFileSync(target, "utf8")
  const lines = current.split("\n").map((line) => line.trim())
  if (lines.includes(`- ${value}`)) return target
  appendFileSync(target, `${current.length && !current.endsWith("\n") ? "\n" : ""}- ${value}\n`)
  return target
}

export const NOTE = "(OkuCode saved this rule to"

/** True for the message OkuCode builds from "# rule": the model only confirms, so no tool call is expected. */
export const isConfirmation = (text: string) => text.includes(NOTE)

/** The message the model receives: the user's line plus a short note that the rule is already saved. */
export function confirmation(text: string, target: string) {
  return `${text.trim()}\n\n${NOTE} ${path.basename(target)}, the project memory, and will follow it from now on. Do not create or edit any file for it; just confirm in one short sentence.)`
}

/** Saves a "# rule" message and returns the text to send to the model, or undefined for normal messages. */
export function handle(text: string, directory: string) {
  const value = rule(text)
  if (!value) return undefined
  try {
    return confirmation(text, save(directory, value))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return `The user asked OkuCode to remember this rule: "${value}", but saving it to project memory failed (${reason}). Tell the user in one sentence that it was not saved and why.`
  }
}
