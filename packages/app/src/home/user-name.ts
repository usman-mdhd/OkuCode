// Okutobus (OkuCode): the name shown in the greeting and the sidebar. Kept in this browser only.
import { createRoot, createSignal } from "solid-js"

const KEY = "okucode.home.name"

function read() {
  try {
    return localStorage.getItem(KEY)?.trim() ?? ""
  } catch {
    return ""
  }
}

const [name, setNameSignal] = createRoot(() => createSignal(read()))

export const userName = {
  value: name,
  set(value: string) {
    const next = value.trim().slice(0, 40)
    setNameSignal(next)
    try {
      if (next) localStorage.setItem(KEY, next)
      else localStorage.removeItem(KEY)
    } catch {
      // Storage can be unavailable (private mode); the name then lasts for this page only.
    }
  },
}
