// Okutobus (OkuCode): left sidebar — New chat, projects, recent chats and the user at the bottom.
// It replaces the tab strip on wide screens so the app works like a simple chat app.
import { useLocation, useNavigate } from "@solidjs/router"
import { Mark } from "@opencode/ui/logo"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { fetchMe, signOut } from "@/okutobus/account"
import { createHomeController } from "@/home/model"
import { createHomeProjectsController } from "@/home/projects/controller"
import { createHomeSessionsController, type HomeSessionRecord } from "@/home/sessions/controller"
import { folderName } from "@/home/hero"
import { userName } from "@/home/user-name"
import { sessionTitle } from "@/session/title"
import { useSettingsCommand, useSettingsDialog } from "@/settings/command"
import { usePlatform } from "@/runtime/platform/platform"

const COLLAPSED_KEY = "okucode.sidebar.collapsed"

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
}

const row =
  "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] text-v2-text-text-base hover:bg-v2-background-bg-layer-02"

function Icon(props: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="shrink-0 text-v2-text-text-muted">
      <path d={props.path} stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

const ICONS = {
  plus: "M8 3v10M3 8h10",
  folder: "M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z",
  chat: "M3 3.5h10v7H6.5L3.5 13v-2.5H3v-7Z",
  settings: "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm5.5-2-1.3-.5-.3-.8.6-1.2-1-1-1.2.6-.8-.3L9 2.5H7l-.5 1.3-.8.3-1.2-.6-1 1 .6 1.2-.3.8L2.5 7v2l1.3.5.3.8-.6 1.2 1 1 1.2-.6.8.3L7 13.5h2l.5-1.3.8-.3 1.2.6 1-1-.6-1.2.3-.8 1.3-.5V8Z",
  panel: "M2.5 3h11v10h-11zM6 3v10",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Zm7 2-3.5-3.5",
  shield: "M8 1.8 13 3.6v4.1c0 3.1-2.1 5.6-5 6.5-2.9-.9-5-3.4-5-6.5V3.6L8 1.8Z",
  logout: "M6 2.5H3.5v11H6M10.5 11 13.5 8l-3-3M13.5 8H6",
  help: "M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13ZM6.2 6.2a1.9 1.9 0 0 1 3.6.7c0 1.3-1.8 1.6-1.8 2.8M8 11.6h.01",
}

function ChatRow(props: { record: HomeSessionRecord; active: boolean; open: () => void }) {
  const title = () => sessionTitle(props.record.session.title) || "New chat"
  return (
    <button
      type="button"
      class={`${row} text-[13.5px]`}
      classList={{ "bg-v2-background-bg-layer-02": props.active }}
      title={`${title()} · ${props.record.projectName}`}
      onClick={props.open}
    >
      <span class="truncate">{title()}</span>
    </button>
  )
}

export function OkuCodeSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const openSettings = useSettingsCommand()
  const openTeam = useSettingsDialog("team")
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const platform = usePlatform()
  const [collapsed, setCollapsed] = createSignal(readCollapsed())
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")

  const toggle = () => {
    const next = !collapsed()
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0")
    } catch {
      // Not saved; the sidebar state then lasts for this page only.
    }
  }

  const server = () => home.server.focused()
  const selected = () => home.selection.value().directory
  const found = createMemo(() => {
    const text = query().trim().toLowerCase()
    if (!text) return []
    return sessions.data
      .searchRecords()
      .filter((record) => (sessionTitle(record.session.title) ?? "").toLowerCase().includes(text))
      .slice(0, 50)
  })
  const isOpen = (record: HomeSessionRecord) => location.pathname.endsWith(`/session/${record.session.id}`)
  // Signed-in person (Google account or the owner with the server password).
  const [me] = createResource(
    () => (server()?.type === "http" ? server()!.http : undefined),
    (http) => fetchMe(http),
  )
  const serverUrl = () => {
    const conn = server()
    return conn?.type === "http" ? conn.http.url : undefined
  }
  const displayName = () => me()?.name || userName.value() || (me() && !me()!.owner ? me()!.email : "") || "You"
  const initial = () => displayName().charAt(0).toUpperCase()

  const newChat = () => {
    navigate("/")
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Message OkuCode"]')?.focus())
  }

  const pickProject = (directory: string) => {
    const conn = server()
    if (!conn) return
    // Clicking the selected project again shows chats from all projects.
    home.project.select(conn, directory)
    if (location.pathname !== "/") navigate("/")
  }

  return (
    <Show
      when={!collapsed()}
      fallback={
        <div class="flex shrink-0 flex-col items-center gap-2 px-2 py-3">
          <button type="button" aria-label="Open sidebar" class="rounded-lg p-2 hover:bg-v2-background-bg-layer-02" onClick={toggle}>
            <Icon path={ICONS.panel} />
          </button>
          <button type="button" aria-label="New chat" class="rounded-lg p-2 hover:bg-v2-background-bg-layer-02" onClick={newChat}>
            <Icon path={ICONS.plus} />
          </button>
        </div>
      }
    >
      <aside
        data-slot="okucode-sidebar"
        class="flex h-full min-h-0 w-[272px] shrink-0 flex-col border-e border-v2-border-border-muted bg-v2-background-bg-deep px-2 pb-2 pt-3"
      >
        <div class="flex items-center justify-between px-2.5 pb-3">
          <div class="flex items-center gap-2">
            <Mark class="h-5 w-4" />
            <span class="text-[17px] font-semibold text-v2-text-text-base">OkuCode</span>
          </div>
          <button type="button" aria-label="Close sidebar" class="rounded-md p-1.5 hover:bg-v2-background-bg-layer-02" onClick={toggle}>
            <Icon path={ICONS.panel} />
          </button>
        </div>

        <button type="button" class={`${row} bg-v2-background-bg-layer-01 font-medium`} onClick={newChat}>
          <Icon path={ICONS.plus} />
          New chat
        </button>

        {/* ☰ opens Projects, Settings and Help; next to it, search the chat history. */}
        <div class="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Menu: projects, settings and help"
            aria-expanded={menuOpen()}
            class="rounded-lg p-2 hover:bg-v2-background-bg-layer-02"
            classList={{ "bg-v2-background-bg-layer-02": menuOpen() }}
            onClick={() => setMenuOpen(!menuOpen())}
          >
            <Icon path={ICONS.menu} />
          </button>
          <label class="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base px-2.5 py-1.5 focus-within:border-v2-border-border-strong">
            <Icon path={ICONS.search} />
            <input
              aria-label="Search chats"
              placeholder="Search chats"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              class="min-w-0 flex-1 bg-transparent text-[13.5px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
            />
          </label>
        </div>

        <Show when={menuOpen()}>
          <div class="mt-2 rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1.5">
            <div class="flex items-center justify-between px-2.5 pb-1 pt-1">
              <span class="text-[12px] font-medium text-v2-text-text-faint">Projects</span>
              <button
                type="button"
                aria-label="Add project"
                class="rounded p-0.5 hover:bg-v2-background-bg-layer-02"
                onClick={() => {
                  const conn = server()
                  if (conn) projects.project.choose(conn)
                }}
              >
                <Icon path={ICONS.plus} />
              </button>
            </div>
            <For each={home.project.list()} fallback={<span class="block px-2.5 py-1 text-[13px] text-v2-text-text-faint">Add a folder to start</span>}>
              {(project) => (
                <button
                  type="button"
                  class={row}
                  classList={{ "bg-v2-background-bg-layer-02": selected() === project.worktree }}
                  title={project.worktree}
                  onClick={() => pickProject(project.worktree)}
                >
                  <Icon path={ICONS.folder} />
                  <span class="truncate">{folderName(project.worktree)}</span>
                </button>
              )}
            </For>
            <div class="my-1.5 border-t border-v2-border-border-muted" />
            <button type="button" class={row} onClick={() => openSettings()}>
              <Icon path={ICONS.settings} />
              Settings
            </button>
            {/* Okutobus FR-57: admins and team leads manage the team and its policy here. */}
            <Show when={(me()?.role === "admin" || me()?.role === "lead") && serverUrl()}>
              {(url) => (
                <button type="button" class={row} onClick={() => openTeam()}>
                  <Icon path={ICONS.shield} />
                  Team
                </button>
              )}
            </Show>
            <button type="button" class={row} onClick={() => platform.openExternal("https://okutobus.com")}>
              <Icon path={ICONS.help} />
              Help
            </button>
          </div>
        </Show>

        <div class="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Show when={selected()}>
            <div class="flex items-center justify-between px-2.5 pb-1">
              <span class="truncate text-[12px] text-v2-text-text-faint">Chats in {folderName(selected() ?? "")}</span>
              <button
                type="button"
                class="text-[12px] text-v2-text-text-faint hover:text-v2-text-text-base"
                onClick={() => {
                  const conn = server()
                  const dir = selected()
                  if (conn && dir) home.project.select(conn, dir)
                }}
              >
                Show all
              </button>
            </div>
          </Show>
          <Show
            when={query().trim()}
            fallback={
              <For each={sessions.data.groups()} fallback={<span class="px-2.5 text-[13px] text-v2-text-text-faint">No chats yet</span>}>
                {(group) => (
                  <Show when={group.sessions.length > 0}>
                    <div class="mb-2">
                      <div class="px-2.5 pb-1 pt-2 text-[12px] font-medium text-v2-text-text-faint">{group.title}</div>
                      <For each={group.sessions}>{(record) => <ChatRow record={record} active={isOpen(record)} open={() => sessions.session.open(record.session)} />}</For>
                    </div>
                  </Show>
                )}
              </For>
            }
          >
            <For each={found()} fallback={<span class="px-2.5 text-[13px] text-v2-text-text-faint">No chats found</span>}>
              {(record) => <ChatRow record={record} active={isOpen(record)} open={() => sessions.session.open(record.session)} />}
            </For>
          </Show>
        </div>

        <div class="mt-2 flex items-center gap-2 border-t border-v2-border-border-muted px-1.5 pt-2">
          <span class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-v2-background-bg-layer-03 text-[13px] font-semibold text-v2-text-text-base">
            <Show when={me()?.picture} fallback={initial()}>
              {(src) => <img src={src()} alt="" referrerpolicy="no-referrer" class="size-full" />}
            </Show>
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-[14px] text-v2-text-text-base">{displayName()}</span>
            <Show when={me() && !me()!.owner && me()!.email !== displayName()}>
              <span class="truncate text-[11.5px] text-v2-text-text-faint">{me()!.email}</span>
            </Show>
          </span>
          <Show when={me() && !me()!.owner && serverUrl()}>
            {(url) => (
              <button type="button" aria-label="Sign out" title="Sign out" class="rounded-md p-1.5 hover:bg-v2-background-bg-layer-02" onClick={() => void signOut(url())}>
                <Icon path={ICONS.logout} />
              </button>
            )}
          </Show>
          <button type="button" aria-label="Settings" class="rounded-md p-1.5 hover:bg-v2-background-bg-layer-02" onClick={() => openSettings()}>
            <Icon path={ICONS.settings} />
          </button>
        </div>
      </aside>
    </Show>
  )
}

