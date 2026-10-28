export * as OkuRouting from "./routing.js"

// Okutobus (OkuCode) SRS FR-46: model routing. Set "smallModel" in <config>/okucode.json (for example
// "ollama/qwen2.5-coder:3b") and OkuCode sends light work to it: chat titles, and short general questions
// ("what is a REST API?") that need no files or tools. Coding work, anything about this project, and every step
// after a tool call stay on the main model. "routing": false keeps questions on the main model (titles still use
// the small model).

import { readFileSync } from "node:fs"
import type { SessionMessage } from "../session/message.js"
import { OkuApproval } from "./approval.js"

type Settings = { smallModel?: unknown; routing?: unknown }

function settings(): Settings {
  try {
    return JSON.parse(readFileSync(OkuApproval.settingsFile(), "utf8"))
  } catch {
    return {}
  }
}

/** The small model as provider and model ID, or undefined when none is set. */
export function smallModel(value = settings().smallModel): { providerID: string; id: string } | undefined {
  if (typeof value !== "string") return undefined
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { providerID: value.slice(0, slash).trim(), id: value.slice(slash + 1).trim() }
}

const QUESTION =
  /^(?:what|what's|whats|why|how|who|when|where|which|explain|define|describe|tell me|is|are|can|could|does|do|should|difference|compare|hi|hello|hey|thanks|thank you|good (?:morning|evening|afternoon))\b/i
// Words that mean the user wants something done, or asks about their own code: those go to the main model.
const WORK =
  /\b(?:create|make|write|add|build|fix|edit|change|update|refactor|implement|run|test|tests|delete|remove|rename|install|commit|generate|debug|deploy|save|open|read|list|find|search|show|convert|migrate|review|optimi[sz]e|this|my|our|project|repo|repository|codebase|folder|directory|file|files|error|bug|stack trace)\b/i
const FILE = /\b[\w.-]+\.[a-z0-9]{1,5}\b|[\\/]|@\S/i

/** True for a short general question or greeting that the small model can answer without tools. */
export function simple(text: string) {
  const value = text.trim().replace(/^(["'])(.*)\1$/s, "$2").trim()
  if (!value || value.length > 300 || value.includes("\n") || value.includes("`")) return false
  if (FILE.test(value) || WORK.test(value)) return false
  return QUESTION.test(value) || value.endsWith("?")
}

/**
 * True when this step should use the small model: routing is on, the latest user message is a simple question,
 * and no tool has run since it (once the small model calls a tool, the main model takes over). Newest first.
 */
export function useSmall(messages: readonly SessionMessage.Info[], current = settings()) {
  if (current.routing === false || !smallModel(current.smallModel)) return false
  for (const message of messages) {
    if (message.type === "assistant" && message.content.some((part) => part.type === "tool")) return false
    if (message.type === "user") return simple(message.text)
  }
  return false
}
