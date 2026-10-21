// Okutobus (OkuCode): drafts whose first message should be sent as soon as the draft page is ready
// (used by the home screen message box).
import { createRoot, createSignal } from "solid-js"

const [pending, setPending] = createRoot(() => createSignal<ReadonlySet<string>>(new Set()))

export const autoSend = {
  request(draftID: string) {
    setPending((current) => new Set([...current, draftID]))
  },
  has(draftID: string | undefined) {
    return !!draftID && pending().has(draftID)
  },
  done(draftID: string) {
    setPending((current) => new Set([...current].filter((id) => id !== draftID)))
  },
}
