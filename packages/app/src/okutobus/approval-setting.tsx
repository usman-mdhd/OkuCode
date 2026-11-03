// Okutobus (OkuCode) SRS FR-22: choose how much OkuCode may do without asking. Stored on the server
// (okucode.json), so it applies to every chat and to the terminal too. Only admins can change it.
import { Select } from "@opencode/ui/select"
import { createResource, createSignal, Show, type Component } from "solid-js"
import { SettingsRow } from "@/settings/row"
import { useSettings } from "@/settings/model"
import { useServers } from "@/runtime/server/registry"

export type ApprovalMode = "ask" | "auto-edit" | "full-auto"

export const APPROVAL_OPTIONS: { value: ApprovalMode; label: string; hint: string }[] = [
  { value: "ask", label: "Ask every time", hint: "OkuCode asks before it changes a file or runs a command." },
  { value: "auto-edit", label: "Auto-edit", hint: "OkuCode changes files by itself but asks before running commands." },
  {
    value: "full-auto",
    label: "Full-auto",
    hint:
      "OkuCode changes files and runs commands without asking. Commands run in a sandbox: they can only change files in the project folder and cannot read keys like ~/.ssh. Without a sandbox (Linux without bubblewrap) commands still ask.",
  },
]

export type Http = { url: string; password?: string }

// The server this window is connected to (with its password when signed in with one).
export function useCurrentServer() {
  const servers = useServers()
  return (): Http => {
    const list = servers.visible.flatMap((conn) => (conn.type === "http" ? [conn.http] : []))
    const same = list.find((http) => http.url.replace(/\/+$/, "") === window.location.origin)
    return same ?? list[0] ?? { url: window.location.origin }
  }
}

const endpoint = (http: Http) => `${http.url.replace(/\/+$/, "")}/okucode/api/approval`
export const headers = (http: Http, json = false) => {
  const value: Record<string, string> = json ? { "content-type": "application/json" } : {}
  if (http.password) value.authorization = `Basic ${btoa(`opencode:${http.password}`)}`
  return value
}

async function load(http: Http): Promise<ApprovalMode | null | undefined> {
  try {
    const response = await fetch(endpoint(http), { credentials: "include", headers: headers(http) })
    if (!response.ok) return undefined
    return ((await response.json()) as { mode?: ApprovalMode | null }).mode ?? null
  } catch {
    return undefined
  }
}

export const ApprovalModeSetting: Component = () => {
  const settings = useSettings()
  const server = useCurrentServer()
  const [mode, { mutate }] = createResource(server, load)
  const [error, setError] = createSignal("")
  const current = () => APPROVAL_OPTIONS.find((option) => option.value === mode())

  const choose = async (next: ApprovalMode) => {
    setError("")
    const previous = mode()
    mutate(next)
    try {
      const http = server()
      const response = await fetch(endpoint(http), {
        method: "PUT",
        credentials: "include",
        headers: headers(http, true),
        body: JSON.stringify({ mode: next }),
      })
      if (!response.ok) throw new Error()
      // The older "auto-accept everything" switch would answer every prompt itself; the mode now decides.
      if (settings.permissions.autoApproveDefault()) settings.permissions.setAutoApproveDefault(false)
    } catch {
      mutate(previous)
      setError("Could not save. Only admins can change this.")
    }
  }

  return (
    <SettingsRow
      title="Approval mode"
      description={
        <>
          {current()?.hint ?? "Not chosen yet: OkuCode follows the permission rules in your config. Pick a mode to decide."}
          <Show when={error()}>
            <span class="block text-v2-text-text-danger">{error()}</span>
          </Show>
          <Show when={!mode.loading && mode() === undefined}>
            <span class="block">Only admins can change this.</span>
          </Show>
        </>
      }
    >
      <Select
        data-action="okucode-approval-mode"
        options={APPROVAL_OPTIONS}
        current={current()}
        placeholder="Choose…"
        value={(option) => option.value}
        label={(option) => option.label}
        placement="bottom-end"
        gutter={6}
        disabled={mode() === undefined}
        onSelect={(option) => option && option.value !== mode() && void choose(option.value)}
      />
    </SettingsRow>
  )
}
