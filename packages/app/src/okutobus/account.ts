// Okutobus (OkuCode): who is signed in (Google accounts or the server password) and the admin panel link.
import type { ServerConnection } from "@/runtime/server/registry"

export type Me = {
  email: string
  name?: string
  picture?: string
  role: "admin" | "lead" | "member"
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

/** Which sign-in providers the server has set up (FR-56: Google and GitHub). */
export async function signInProviders(url: string): Promise<{ google: boolean; github: boolean }> {
  try {
    const response = await fetch(`${base(url)}/okucode/auth/config`, { credentials: "include" })
    if (!response.ok) return { google: false, github: false }
    const value = (await response.json()) as { google?: boolean; github?: boolean }
    return { google: value.google === true, github: value.github === true }
  } catch {
    return { google: false, github: false }
  }
}

export async function googleEnabled(url: string) {
  return (await signInProviders(url)).google
}

export const googleSignInUrl = (url: string) => `${base(url)}/okucode/auth/google`
export const githubSignInUrl = (url: string) => `${base(url)}/okucode/auth/github`
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

/** Message for ?okucode_error=… after a Google or GitHub sign-in that did not work. */
export function signInError(search: string) {
  const params = new URLSearchParams(search)
  const code = params.get("okucode_error")
  if (!code) return undefined
  const email = params.get("email")
  if (code === "not_invited")
    return `${email ?? "This account"} hasn't been added to OkuCode yet. Ask your admin to invite you.`
  if (code === "disabled") return `Access for ${email ?? "this account"} is turned off. Ask your admin.`
  if (code === "google_not_set_up") return "Google sign-in isn't set up yet. An admin can set it up in Settings → Team."
  if (code === "github_not_set_up") return "GitHub sign-in isn't set up yet. An admin can set it up in Settings → Team."
  if (code === "github_failed")
    return "GitHub sign-in didn't finish. Make sure your GitHub account has a verified email, then try again."
  return "Google sign-in didn't finish. Please try again."
}
