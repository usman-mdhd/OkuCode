export * as OkuNudge from "./nudge.js"

// Okutobus (OkuCode): small models often end a turn by *announcing* an action
// ("I'll add the code to the document now.") or by pasting file content as text,
// without calling any tool. When that happens once in a turn, the runner sends one
// short reminder and lets the model try again, instead of stopping.
//
// Only when the user asked for something to be done: after a plain question ("give me another example") an answer
// that ends with "let me know!" or mentions creating things is a complete answer, and a reminder made the model
// create a Word file nobody asked for.

import type { SessionMessage } from "../session/message.js"
import { OkuMemory } from "./memory.js"

export const TEXT =
  "You said what you would do but did not call a tool, so nothing happened. Do it now by calling the right tool " +
  "(document for Word/PDF files, write or edit for code files, read, shell) with the complete content. " +
  "Do not describe it again and do not ask the user to run commands."

// An announcement followed closely by an action: "I'll add the code", "let me now create the file". Not "let me know".
const ANNOUNCED =
  /\b(?:i'?ll|i will|let me|i am going to|i'm going to|i have|i've|please wait,? i'?ll)\s+(?!know\b)(?:[\w'-]+\s+){0,3}?(?:add|added|update|updated|create|created|write|written|generate|make|run|read|fix|edit|save|saved|put)\b/i
// The user asked for work, not just an answer. Short confirmations ("yes", "go ahead") answer an offer to do work.
const REQUEST =
  /\b(?:add|create|make|write|generate|build|fix|edit|change|update|modify|refactor|implement|run|test|delete|remove|rename|install|save|convert|export|put|insert|append|replace|document|docx|word|pdf|file)\b/i
const CONFIRM = /^\s*(?:yes|yeah|yep|ok|okay|sure|go ahead|do it|please do|proceed|continue)\b/i
const FILE = /\b[\w.-]+\.(?:docx|pdf|odt|rtf|pptx|md|txt|html|py|js|ts|java|cs|sql|json|csv)\b/i

/** The reminder to send, or undefined. `messages` are the newest messages first. */
export function decide(messages: readonly SessionMessage.Info[]): string | undefined {
  const latest = messages[0]
  if (!latest || latest.type !== "assistant") return undefined
  if (latest.content.some((part) => part.type === "tool")) return undefined
  // At most one reminder per user message.
  for (const message of messages.slice(1)) {
    // A "# rule" message only needs a one-line confirmation ("I will use tabs"), never a tool call.
    if (message.type === "user") {
      if (OkuMemory.isConfirmation(message.text)) return undefined
      if (!REQUEST.test(message.text) && !CONFIRM.test(message.text)) return undefined
      break
    }
    if (message.type === "synthetic" && message.text === TEXT) return undefined
    // The work already happened earlier in this turn ("I have created test.py" after the write tool ran);
    // a reminder would only make the model do it again. Reading alone does not count: "I'll update it" after
    // a read still needs the reminder.
    if (message.type === "assistant" && message.content.some((part) => part.type === "tool" && part.name !== "read"))
      return undefined
  }
  const text = latest.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  if (!text.trim()) return undefined
  // The announcement closes the reply; one in the middle of an explanation is not a promise to act now.
  const announced = ANNOUNCED.test(text.slice(-400))
  const pastedFile = /```/.test(text) && FILE.test(text) && /\b(?:document|file|docx|word)\b/i.test(text)
  return announced || pastedFile ? TEXT : undefined
}
