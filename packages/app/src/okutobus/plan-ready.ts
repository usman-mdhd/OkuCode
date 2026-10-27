// Okutobus (OkuCode) SRS FR-03: when the Plan approval bar should show.
export const PLAN_AGENT = "plan"
export const APPROVAL_TEXT = "The plan is approved. Carry it out now, step by step, and tell me when each step is done."

type Message = { type: string; agent?: string }

/** True when the last real turn is a reply written in Plan mode, so there is a plan to approve. */
export function planReady(messages: ReadonlyArray<Message>) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "assistant") return message.agent === PLAN_AGENT
    if (message.type === "user") return false
  }
  return false
}
