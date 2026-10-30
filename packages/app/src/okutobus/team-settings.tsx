// Okutobus (OkuCode) FR-56/57: team administration inside the web app (Settings → Team), so there is one sign-in
// and no separate admin page. Admins and team leads see it; members do not.
//   Users   add / invite / change role / disable / remove (leads: members only)
//   Policy  approval mode, auto-test, model routing and team rules for every chat
//   Sign-in Google sign-in and Gmail invite setup (admins only)
import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { createResource, createSignal, For, Show, type Component, type JSX } from "solid-js"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { showToast } from "@/shell/notifications/toast"
import { APPROVAL_OPTIONS, headers, useCurrentServer, type ApprovalMode, type Http } from "./approval-setting"
import type { Me } from "./account"
import "@/settings/settings.css"

type Role = "admin" | "lead" | "member"
type User = {
  email: string
  name?: string
  picture?: string
  role: Role
  status: "invited" | "active" | "disabled"
  invitedAt?: number
  lastLogin?: number
}
type Policy = {
  approvalMode: ApprovalMode | null
  autoTest: boolean
  routing: boolean
  smallModel: string | null
  teamRules: string
}
type Setup = {
  publicUrl: string
  suggestedUrl: string
  callbackUrl: string
  googleClientId: string
  googleSecretSaved: boolean
  gmailAddress: string
  gmailPasswordSaved: boolean
  fromName: string
  googleReady: boolean
  gmailReady: boolean
}

const ROLE_LABELS: Record<Role, string> = { admin: "Admin", lead: "Team lead", member: "Member" }
const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((value) => ({ value, label: ROLE_LABELS[value] }))
const STATUS: Record<User["status"], { label: string; class: string }> = {
  active: { label: "Active", class: "bg-surface-success-weak text-text-on-success-weak" },
  invited: { label: "Invited", class: "bg-surface-warning-weak text-text-on-warning-weak" },
  disabled: { label: "Disabled", class: "bg-surface-critical-weak text-text-on-critical-weak" },
}

const input =
  "w-full min-w-0 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 py-1.5 text-13-regular text-v2-text-text-base outline-none focus:border-v2-border-border-focus"

async function call<T>(http: Http, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${http.url.replace(/\/+$/, "")}${path}`, {
    method,
    credentials: "include",
    headers: headers(http, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; warning?: string }
  if (!response.ok) throw new Error(data.error || "Something went wrong.")
  return data
}

const done = (title: string) => showToast({ variant: "success", icon: "circle-check", title })
const failed = (error: unknown) => showToast({ title: "Couldn't save", description: (error as Error).message })

function Section(props: { title: string; description?: string; children: JSX.Element }) {
  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{props.title}</h3>
      <Show when={props.description}>
        <p class="mb-3 text-12-regular text-v2-text-text-muted">{props.description}</p>
      </Show>
      {props.children}
    </div>
  )
}

function Field(props: { label: string; hint?: JSX.Element; children: JSX.Element }) {
  return (
    <label class="mb-3 flex flex-col gap-1">
      <span class="text-12-medium text-v2-text-text-base">{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span class="text-11-regular text-v2-text-text-muted">{props.hint}</span>
      </Show>
    </label>
  )
}

export const SettingsTeam: Component<{ me: Me }> = (props) => {
  const server = useCurrentServer()
  const isAdmin = () => props.me.role === "admin"
  const [users, { refetch: reloadUsers }] = createResource(server, (http) =>
    call<{ users: User[] }>(http, "/okucode/api/users").then((data) => data.users),
  )
  const [policy, { refetch: reloadPolicy }] = createResource(server, (http) => call<Policy>(http, "/okucode/api/policy"))
  const [setup, { refetch: reloadSetup }] = createResource(
    () => (isAdmin() ? server() : undefined),
    (http) => call<Setup>(http, "/okucode/api/settings"),
  )

  // ---- users ----
  const [email, setEmail] = createSignal("")
  const [role, setRole] = createSignal<Role>("member")
  const [invite, setInvite] = createSignal(true)
  const [adding, setAdding] = createSignal(false)
  const [confirmRemove, setConfirmRemove] = createSignal("")

  const addUser = async (event: Event) => {
    event.preventDefault()
    setAdding(true)
    try {
      const result = await call<{ user: User; warning?: string }>(server(), "/okucode/api/users", "POST", {
        email: email(),
        role: isAdmin() ? role() : "member",
        invite: invite() && !!setup()?.gmailReady,
      })
      setEmail("")
      await reloadUsers()
      if (result.warning) showToast({ title: "Added, but the invite email failed", description: result.warning })
      else done(result.user.invitedAt ? `Invite sent to ${result.user.email}` : `Added ${result.user.email}`)
    } catch (error) {
      failed(error)
    } finally {
      setAdding(false)
    }
  }

  const userAction = async (user: User, action: "role" | "toggle" | "resend" | "remove", value?: Role) => {
    const path = `/okucode/api/users/${encodeURIComponent(user.email)}`
    try {
      if (action === "role") await call(server(), path, "PATCH", { role: value })
      if (action === "toggle") await call(server(), path, "PATCH", { disabled: user.status !== "disabled" })
      if (action === "resend") await call(server(), `${path}/resend`, "POST", {})
      if (action === "remove") await call(server(), path, "DELETE")
      await reloadUsers()
      done(
        action === "role"
          ? `${user.email} is now ${ROLE_LABELS[value!].toLowerCase()}`
          : action === "toggle"
            ? user.status === "disabled"
              ? `${user.email} can sign in again`
              : `${user.email} can no longer sign in`
            : action === "resend"
              ? `Invite sent to ${user.email}`
              : `Removed ${user.email}`,
      )
    } catch (error) {
      await reloadUsers()
      failed(error)
    }
  }

  // Leads manage members only; nobody changes or removes themselves here.
  const canManage = (user: User) => user.email !== props.me.email && (isAdmin() || user.role === "member")

  // ---- policy ----
  const [rules, setRules] = createSignal<string>()
  const savePolicy = async (change: Partial<Policy>, message: string) => {
    try {
      await call(server(), "/okucode/api/policy", "PUT", change)
      await reloadPolicy()
      done(message)
    } catch (error) {
      failed(error)
    }
  }

  // ---- sign-in setup ----
  const [form, setForm] = createSignal<Record<string, string>>({})
  const value = (key: keyof Setup) => form()[key] ?? String(setup()?.[key] ?? "")
  const set = (key: string) => (event: InputEvent & { currentTarget: HTMLInputElement }) =>
    setForm({ ...form(), [key]: event.currentTarget.value })
  const saveSetup = async (event: Event) => {
    event.preventDefault()
    try {
      await call(server(), "/okucode/api/settings", "PUT", {
        publicUrl: value("publicUrl"),
        googleClientId: value("googleClientId"),
        googleClientSecret: form().googleClientSecret ?? "",
        gmailAddress: value("gmailAddress"),
        gmailAppPassword: form().gmailAppPassword ?? "",
        fromName: value("fromName"),
      })
      setForm({})
      await reloadSetup()
      done("Sign-in setup saved")
    } catch (error) {
      failed(error)
    }
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">Team</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              {isAdmin()
                ? "Who can use OkuCode, the rules every chat follows, and how people sign in."
                : "As a team lead you can add and manage members and set the team policy."}
            </span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned" data-component="okucode-team">
        {/* ---------- Users ---------- */}
        <Section title="People" description="Only people added here can sign in to OkuCode with Google.">
          <form class="mb-4 flex flex-wrap items-center gap-2" onSubmit={addUser}>
            <input
              class={`${input} flex-[1_1_220px]`}
              type="email"
              required
              placeholder="name@okutobus.com"
              aria-label="Email address"
              value={email()}
              onInput={(event) => setEmail(event.currentTarget.value)}
            />
            <Show when={isAdmin()}>
              <Select
                data-action="okucode-team-new-role"
                options={ROLE_OPTIONS}
                current={ROLE_OPTIONS.find((option) => option.value === role())}
                value={(option) => option.value}
                label={(option) => option.label}
                onSelect={(option) => option && setRole(option.value)}
              />
            </Show>
            <Show when={setup()?.gmailReady || !isAdmin()}>
              <label class="flex items-center gap-1.5 text-12-regular text-v2-text-text-muted">
                <input type="checkbox" checked={invite()} onChange={(event) => setInvite(event.currentTarget.checked)} />
                Send invite email
              </label>
            </Show>
            <Button type="submit" variant="contrast" disabled={adding()}>
              Add person
            </Button>
          </form>

          <SettingsList>
            <Show when={!users.loading || users()} fallback={<div class="p-3 text-12-regular text-v2-text-text-muted">Loading…</div>}>
              <For
                each={users() ?? []}
                fallback={<div class="p-3 text-12-regular text-v2-text-text-muted">No one added yet. Add the first person above.</div>}
              >
                {(user) => (
                  <div data-component="settings-row" data-okucode-user={user.email}>
                    <div class="flex min-w-0 flex-1 items-center gap-2.5">
                      <div class="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-v2-background-bg-layer-02 text-12-medium">
                        <Show when={user.picture} fallback={(user.name || user.email).charAt(0).toUpperCase()}>
                          <img src={user.picture} alt="" referrerpolicy="no-referrer" class="size-full" />
                        </Show>
                      </div>
                      <div class="min-w-0">
                        <div class="truncate text-13-medium text-v2-text-text-base">
                          {user.name || user.email.split("@")[0]}
                          {user.email === props.me.email ? " (you)" : ""}
                        </div>
                        <div class="truncate text-12-regular text-v2-text-text-muted">
                          {user.email} ·{" "}
                          <span class={`rounded-full px-1.5 py-px text-11-medium ${STATUS[user.status].class}`}>
                            {STATUS[user.status].label}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div data-slot="settings-row-control" class="flex flex-wrap items-center justify-end gap-1.5">
                      <Show
                        when={isAdmin() && user.email !== props.me.email}
                        fallback={<span class="text-12-regular text-v2-text-text-muted">{ROLE_LABELS[user.role]}</span>}
                      >
                        <Select
                          data-action="okucode-team-role"
                          options={ROLE_OPTIONS}
                          current={ROLE_OPTIONS.find((option) => option.value === user.role)}
                          value={(option) => option.value}
                          label={(option) => option.label}
                          placement="bottom-end"
                          onSelect={(option) => option && option.value !== user.role && void userAction(user, "role", option.value)}
                        />
                      </Show>
                      <Show when={canManage(user)}>
                        <Show when={user.status === "invited" && (setup()?.gmailReady || !isAdmin())}>
                          <Button size="small" variant="ghost" onClick={() => void userAction(user, "resend")}>
                            {user.invitedAt ? "Resend invite" : "Send invite"}
                          </Button>
                        </Show>
                        <Button size="small" variant="ghost" onClick={() => void userAction(user, "toggle")}>
                          {user.status === "disabled" ? "Enable" : "Disable"}
                        </Button>
                        <Button
                          size="small"
                          variant={confirmRemove() === user.email ? "danger" : "ghost"}
                          onClick={() =>
                            confirmRemove() === user.email
                              ? void userAction(user, "remove").then(() => setConfirmRemove(""))
                              : setConfirmRemove(user.email)
                          }
                        >
                          {confirmRemove() === user.email ? "Click again to remove" : "Remove"}
                        </Button>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </Section>

        {/* ---------- Policy ---------- */}
        <Section title="Team policy" description="These apply to every chat on this OkuCode server, for everyone.">
          <Show when={policy()}>
            {(current) => (
              <>
                <SettingsList>
                  <SettingsRow
                    title="Approval mode"
                    description={
                      APPROVAL_OPTIONS.find((option) => option.value === current().approvalMode)?.hint ??
                      "Not chosen yet: OkuCode follows the permission rules in the config."
                    }
                  >
                    <Select
                      data-action="okucode-team-approval"
                      options={APPROVAL_OPTIONS}
                      current={APPROVAL_OPTIONS.find((option) => option.value === current().approvalMode)}
                      placeholder="Choose…"
                      value={(option) => option.value}
                      label={(option) => option.label}
                      placement="bottom-end"
                      onSelect={(option) =>
                        option &&
                        option.value !== current().approvalMode &&
                        void savePolicy({ approvalMode: option.value }, `Approval mode: ${option.label}`)
                      }
                    />
                  </SettingsRow>
                  <SettingsRow
                    title="Run tests after changes"
                    description="After OkuCode changes code it runs the project's tests and fixes failures (up to 3 tries)."
                  >
                    <Switch
                      checked={current().autoTest}
                      onChange={(checked) =>
                        void savePolicy({ autoTest: checked }, checked ? "Auto-testing on" : "Auto-testing off")
                      }
                    />
                  </SettingsRow>
                  <SettingsRow
                    title="Small model for quick questions"
                    description={
                      current().smallModel
                        ? `The first short general question of a new chat goes to ${current().smallModel}. Follow-ups and coding stay on the main model.`
                        : "No small model is set up yet (smallModel in okucode.json)."
                    }
                  >
                    <Switch
                      checked={current().routing}
                      onChange={(checked) =>
                        void savePolicy({ routing: checked }, checked ? "Small-model routing on" : "Small-model routing off")
                      }
                    />
                  </SettingsRow>
                </SettingsList>

                <div class="mt-4">
                  <Field label="Team rules" hint="OkuCode follows these in every chat, on top of each project's OKUCODE.md. One rule per line.">
                    <textarea
                      class={`${input} min-h-32 font-mono text-12-regular`}
                      placeholder={"- Never commit directly to main.\n- Write unit tests for new functions."}
                      value={rules() ?? current().teamRules}
                      onInput={(event) => setRules(event.currentTarget.value)}
                    />
                  </Field>
                  <Button
                    variant="contrast"
                    disabled={rules() === undefined || rules() === current().teamRules}
                    onClick={() => void savePolicy({ teamRules: rules() ?? "" }, "Team rules saved").then(() => setRules(undefined))}
                  >
                    Save team rules
                  </Button>
                </div>
              </>
            )}
          </Show>
        </Section>

        {/* ---------- Sign-in setup (admins) ---------- */}
        <Show when={isAdmin() && setup()}>
          {(current) => (
            <Section title="Sign-in setup" description="Google sign-in for the team, and Gmail for invite emails.">
              <div class="mb-3 flex flex-wrap gap-2">
                <span class={`rounded-full px-2 py-0.5 text-11-medium ${current().googleReady ? STATUS.active.class : STATUS.invited.class}`}>
                  Google sign-in: {current().googleReady ? "ready" : "not set up"}
                </span>
                <span class={`rounded-full px-2 py-0.5 text-11-medium ${current().gmailReady ? STATUS.active.class : STATUS.invited.class}`}>
                  Invite emails: {current().gmailReady ? "ready" : "not set up"}
                </span>
              </div>
              <form onSubmit={saveSetup}>
                <Field label="OkuCode address" hint={<>Leave empty to use {current().suggestedUrl}.</>}>
                  <input class={input} placeholder={current().suggestedUrl} value={value("publicUrl")} onInput={set("publicUrl")} />
                </Field>
                <Field
                  label="Google client ID"
                  hint={
                    <>
                      Google Cloud Console → Credentials → OAuth client ID (Web application). Redirect URI:{" "}
                      <code class="select-all">{current().callbackUrl}</code>
                    </>
                  }
                >
                  <input class={input} autocomplete="off" placeholder="123…apps.googleusercontent.com" value={value("googleClientId")} onInput={set("googleClientId")} />
                </Field>
                <Field label="Google client secret">
                  <input
                    class={input}
                    type="password"
                    autocomplete="new-password"
                    placeholder={current().googleSecretSaved ? "Saved (leave empty to keep it)" : "GOCSPX-…"}
                    value={form().googleClientSecret ?? ""}
                    onInput={set("googleClientSecret")}
                  />
                </Field>
                <Field label="Gmail address for invites">
                  <input class={input} type="email" placeholder="okucode@okutobus.com" value={value("gmailAddress")} onInput={set("gmailAddress")} />
                </Field>
                <Field label="Gmail app password" hint="myaccount.google.com/apppasswords (needs 2-Step Verification). Not your normal password.">
                  <input
                    class={input}
                    type="password"
                    autocomplete="new-password"
                    placeholder={current().gmailPasswordSaved ? "Saved (leave empty to keep it)" : "abcd efgh ijkl mnop"}
                    value={form().gmailAppPassword ?? ""}
                    onInput={set("gmailAppPassword")}
                  />
                </Field>
                <Field label="Sender name">
                  <input class={input} value={value("fromName")} onInput={set("fromName")} />
                </Field>
                <Button type="submit" variant="contrast">
                  Save sign-in setup
                </Button>
              </form>
            </Section>
          )}
        </Show>
      </div>
    </>
  )
}
