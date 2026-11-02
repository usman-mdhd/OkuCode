export * as OkuDocs from "./docs.js"

// Okutobus (OkuCode): the document tool (Word/PDF files) is only offered when the user asks for a file. Small models
// otherwise make a Word file on their own after "give me another example" and reply only "I've created a document".

import type { SessionMessage } from "../session/message.js"

/** Words that ask for a file. */
export const FILE_REQUEST =
  /\b(?:word|docx|pdf|document|documents|doc|docs|file|files|report|save|download|export|pptx|powerpoint|excel|xlsx|csv|sheet)\b/i
// "yes" to the assistant's offer ("Shall I put this in a Word file?").
const CONFIRM = /^\s*(?:yes|yeah|yep|ok|okay|sure|go ahead|do it|please do|please|proceed)\b/i

const assistantText = (message: SessionMessage.Info) =>
  message.type === "assistant"
    ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
    : ""

/** True when the latest user message asks for a file, or says yes to an offer of one. Messages are oldest first. */
export function fileRequested(messages: readonly SessionMessage.Info[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.type !== "user") continue
    if (FILE_REQUEST.test(message.text)) return true
    if (!CONFIRM.test(message.text)) return false
    for (let j = i - 1; j >= 0; j--) {
      const previous = messages[j]!
      if (previous.type === "user") return false
      if (previous.type === "assistant" && assistantText(previous).trim()) return FILE_REQUEST.test(assistantText(previous))
    }
    return false
  }
  return false
}
