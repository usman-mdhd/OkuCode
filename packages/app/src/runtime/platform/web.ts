import { createBrowserDraftStore } from "@/runtime/persistence/drafts"
import type { Platform } from "./platform"

// Okutobus (OkuCode): Safari and Chrome only show the "Allow notifications?" prompt when it is asked from a
// click or key press, so ask once on the first one instead of when a reply finishes.
function askNotificationPermissionOnFirstInput() {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "default") return
  const ask = () => {
    window.removeEventListener("pointerdown", ask, true)
    window.removeEventListener("keydown", ask, true)
    if (Notification.permission === "default") void Notification.requestPermission().catch(() => undefined)
  }
  window.addEventListener("pointerdown", ask, true)
  window.addEventListener("keydown", ask, true)
}

export function createWebPlatform(version: string) {
  askNotificationPermissionOnFirstInput()
  const platform: Platform = {
    platform: "web",
    draftStore: createBrowserDraftStore(),
    version,
    openExternal(value) {
      if (!URL.canParse(value)) return
      const url = new URL(value)

      if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return
      window.open(url.href, "_blank", "noopener,noreferrer")
    },
    restart: async () => window.location.reload(),
    async notify(title, description, onClick) {
      if (!("Notification" in window)) return

      if (Notification.permission !== "granted") return

      if (document.visibilityState === "visible" && document.hasFocus()) return

      const notification = new Notification(title, {
        body: description ?? "",
        icon: `${location.origin}/favicon-96x96-v3.png`,
        tag: title + (description ?? ""),
      })

      notification.onclick = () => {
        window.focus()
        onClick?.()
        notification.close()
      }
    },
  }

  return {
    platform,
    currentServerUrl: getCurrentServerUrl(),
  }
}

function getCurrentServerUrl() {
  if (import.meta.env.VITE_OPENCODE_SERVER_MODE === "none") return undefined

  if (import.meta.env.DEV) {
    const loopback =
      location.hostname === "localhost" || location.hostname === "[::1]" || location.hostname.startsWith("127.")

    const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? (loopback ? location.hostname : "localhost")

    return `http://${host}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  }

  return location.origin
}
