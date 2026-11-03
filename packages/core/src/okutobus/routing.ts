export * as OkuRouting from "./routing.js"

// Okutobus (OkuCode) SRS FR-46: model routing. Set "smallModel" in <config>/okucode.json (for example
// "ollama/qwen2.5-coder:3b") and OkuCode uses it for chat titles. With "routing": true it also answers the opening
// short general question of a new chat ("what is a REST API?"). Follow-up messages, coding work, anything about this
// project, and every step after a tool call stay on the main model: the small model gave short answers and, with
// its small context window, lost the earlier conversation on follow-ups. Routing is off unless turned on.

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

/** Added to the system prompt for the small model: it has no tools and must answer in plain text. */
export const SMALL_NOTE =
  "No tools are available for this reply. Answer the user's question directly in plain text or Markdown. " +
  "Never write JSON or a tool call."

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
 * True when this step should use the small model: routing is turned on, the latest user message is a simple question,
 * it opens the chat (no earlier messages), and no tool has run since it. Newest first.
 */
export function useSmall(messages: readonly SessionMessage.Info[], current = settings()) {
  if (current.routing !== true || !smallModel(current.smallModel)) return false
  const index = messages.findIndex((message) => message.type === "user")
  if (index === -1) return false
  // A follow-up needs the earlier conversation, so it stays on the main model.
  if (messages.slice(index + 1).some((message) => message.type === "user" || message.type === "assistant")) return false
  if (messages.slice(0, index).some((message) => message.type === "assistant" && message.content.some((part) => part.type === "tool")))
    return false
  const latest = messages[index]
  // A message with files (named, attached, or found by the repository map) is about the project: main model.
  if (latest.type === "user" && latest.files?.length) return false
  return latest.type === "user" && simple(latest.text)
}
