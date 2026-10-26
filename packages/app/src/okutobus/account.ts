// Okutobus (OkuCode): who is signed in (Google accounts or the server password) and the admin panel link.
import type { ServerConnection } from "@/runtime/server/registry"

export type Me = {
  email: string
  name?: string
  picture?: string
  role: "admin" | "member"
  owner?: boolean
}

const base = (url: string) => url.replace(/\/+$/, "")

export async function fetchMe(http: ServerConnection.HttpBase | undefined): Promise<Me | undefined> {
  if (!http?.url) return undefined
  const headers: Record<string, string> = {}
  if (http.password) headers.authorization = `Basic ${btoa(`opencode:${http.password}`)}`
  try {
    const response = await fetch(`${base(http.url)}/okucode/me`, { headers, credentials: "include" })
    return response.ok ? ((await response.json()) as Me) : undefined
  } catch {
    return undefined
  }
}

export async function googleEnabled(url: string) {
  try {
    const response = await fetch(`${base(url)}/okucode/auth/config`, { credentials: "include" })
    return response.ok && ((await response.json()) as { google?: boolean }).google === true
  } catch {
    return false
  }
}

export const googleSignInUrl = (url: string) => `${base(url)}/okucode/auth/google`
export const adminPanelUrl = (url: string) => `${base(url)}/okucode/admin`

export async function signOut(url: string) {
  await fetch(`${base(url)}/okucode/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => undefined)
  location.reload()
}

/** Message for ?okucode_error=… after a Google sign-in that did not work. */
export function signInError(search: string) {
  const params = new URLSearchParams(search)
  const code = params.get("okucode_error")
  if (!code) return undefined
  const email = params.get("email")
  if (code === "not_invited")
    return `${email ?? "This Google account"} hasn't been added to OkuCode yet. Ask your admin to invite you.`
  if (code === "disabled") return `Access for ${email ?? "this account"} is turned off. Ask your admin.`
  if (code === "google_not_set_up") return "Google sign-in isn't set up yet. An admin can set it up in the admin panel."
  return "Google sign-in didn't finish. Please try again."
}
