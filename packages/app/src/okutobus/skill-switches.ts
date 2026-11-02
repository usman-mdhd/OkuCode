// Okutobus (OkuCode): on/off switches for skills in Settings → Extensions → Skills. The switched-off skills are kept on
// the server (okucode.json "disabledSkills"), so they apply to every chat. Only admins and team leads can change them.
import { createResource, createSignal } from "solid-js"
import { headers, useCurrentServer, type Http } from "@/okutobus/approval-setting"

const endpoint = (http: Http) => `${http.url.replace(/\/+$/, "")}/okucode/api/skills`

async function load(http: Http): Promise<string[] | undefined> {
  try {
    const response = await fetch(endpoint(http), { credentials: "include", headers: headers(http) })
    if (!response.ok) return undefined
    return ((await response.json()) as { disabled?: string[] }).disabled ?? []
  } catch {
    return undefined
  }
}

export function useSkillSwitches() {
  const server = useCurrentServer()
  const [disabled, { mutate }] = createResource(server, load)
  const [error, setError] = createSignal("")

  const save = async (name: string, enabled: boolean) => {
    const http = server()
    const response = await fetch(endpoint(http), {
      method: "PUT",
      credentials: "include",
      headers: headers(http, true),
      body: JSON.stringify({ name, enabled }),
    })
    if (!response.ok) throw new Error()
    return ((await response.json()) as { disabled?: string[] }).disabled ?? []
  }

  /** Switches the named skills on or off, one request each, and shows the server's final list. */
  const set = async (names: string[], enabled: boolean) => {
    setError("")
    const previous = disabled()
    const next = new Set(previous ?? [])
    for (const name of names) enabled ? next.delete(name) : next.add(name)
    mutate([...next])
    try {
      let latest = previous ?? []
      for (const name of names) latest = await save(name, enabled)
      mutate(latest)
    } catch {
      mutate(previous)
      setError("Could not save. Only admins and team leads can switch skills on or off.")
    }
  }

  return {
    /** undefined while loading or when this user cannot change skills. */
    disabled,
    ready: () => disabled() !== undefined,
    isOn: (name: string) => !(disabled() ?? []).includes(name),
    set,
    error,
  }
}
