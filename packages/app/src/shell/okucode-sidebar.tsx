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
import { Menu } from "@opencode/ui/menu"
import { ServerConnection } from "@/runtime/server/registry"
import { useDialog } from "@opencode/ui/context/dialog"
import { ArchivedChats, createChatActions, isLocked, isPinned } from "@/okutobus/chat-actions"

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
  // « hide the sidebar, » show it again: arrows read more clearly than a panel shape.
  hide: "M8.5 4 4.5 8l4 4M12.5 4l-4 4 4 4",
  show: "M7.5 4l4 4-4 4M3.5 4l4 4-4 4",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  archive: "M2.5 3h11v3h-11zM3.5 6v7.5h9V6M6.5 9h3",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Zm7 2-3.5-3.5",
  shield: "M8 1.8 13 3.6v4.1c0 3.1-2.1 5.6-5 6.5-2.9-.9-5-3.4-5-6.5V3.6L8 1.8Z",
  logout: "M6 2.5H3.5v11H6M10.5 11 13.5 8l-3-3M13.5 8H6",
  help: "M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13ZM6.2 6.2a1.9 1.9 0 0 1 3.6.7c0 1.3-1.8 1.6-1.8 2.8M8 11.6h.01",
}

const MENU_ICONS = {
  rename: "M10.5 2.5l3 3L6 13H3v-3l7.5-7.5Z",
  pin: "M9.5 2 14 6.5l-2 .5-2.5 2.5.5 3-1 1-3-3L3 13.5M6 10 2.5 6.5l1-1 3 .5L9 3.5l.5-1.5",
  lock: "M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z",
  share: "M8 10V2.5M5 5.5l3-3 3 3M3 9v4.5h10V9",
  archive: "M2.5 3h11v3h-11zM3.5 6v7.5h9V6M6.5 9h3",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9",
  folder: "M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z",
  link: "M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.5.5M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.5-.5",
  download: "M8 2.5V10M5 7l3 3 3-3M3 12.5h10",
}

function ItemLabel(props: { icon: keyof typeof MENU_ICONS; children: string; danger?: boolean }) {
  return (
    <span class="flex items-center gap-2.5" style={props.danger ? { color: "#f2555a" } : undefined}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="shrink-0">
        <path d={MENU_ICONS[props.icon]} stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      {props.children}
    </span>
  )
}

type ChatActions = ReturnType<typeof createChatActions>

// Right-click a chat: rename, pin, lock, share, archive, delete or move it to another project.
// A locked chat can only be pinned, shared or unlocked.
function ChatRow(props: {
  record: HomeSessionRecord
  active: boolean
  open: () => void
  remove: () => void
  actions: ChatActions
  projects: { worktree: string }[]
  download: () => void
}) {
  const session = () => props.record.session
  const title = () => sessionTitle(session().title) || "New chat"
  const pinned = () => isPinned(session())
  const locked = () => isLocked(session())
  const [editing, setEditing] = createSignal(false)
  let input: HTMLInputElement | undefined

  const startRename = () => {
    setEditing(true)
    // Wait for the menu to close and give the focus back before selecting the name.
    setTimeout(() => {
      input?.focus()
      input?.select()
    }, 50)
  }
  const finishRename = (save: boolean) => {
    if (!editing()) return
    const value = input?.value ?? ""
    setEditing(false)
    if (save) void props.actions.rename(session(), value)
  }

  return (
    <Show
      when={!editing()}
      fallback={
        <input
          ref={input}
          data-slot="okucode-chat-rename"
          aria-label="Chat name"
          value={title()}
          maxLength={200}
          class={`${row} text-[13.5px] bg-v2-background-bg-layer-02 outline-none ring-1 ring-v2-border-border-strong`}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename(true)
            if (event.key === "Escape") finishRename(false)
          }}
          onBlur={() => finishRename(true)}
        />
      }
    >
      <Menu.Context modal={false}>
        <Menu.Context.Trigger
          as="button"
          type="button"
          class={`${row} text-[13.5px]`}
          classList={{ "bg-v2-background-bg-layer-02": props.active }}
          title={`${title()} · ${props.record.projectName}`}
          onClick={props.open}
          data-chat-id={session().id}
        >
          <span class="min-w-0 flex-1 truncate">{title()}</span>
          <Show when={locked()}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-label="Locked" class="shrink-0 text-v2-text-text-faint">
              <path d={MENU_ICONS.lock} stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
            </svg>
          </Show>
        </Menu.Context.Trigger>
        <Menu.Context.Portal>
          <Menu.Context.Content data-slot="okucode-chat-menu" style={{ "min-width": "200px" }}>
            <Menu.Item onSelect={startRename} disabled={locked()} data-action="okucode-chat-rename">
              <ItemLabel icon="rename">Rename</ItemLabel>
            </Menu.Item>
            <Menu.Item onSelect={() => void props.actions.pin(session(), !pinned())} data-action="okucode-chat-pin">
              <ItemLabel icon="pin">{pinned() ? "Unpin" : "Pin"}</ItemLabel>
            </Menu.Item>
            <Menu.Item onSelect={() => void props.actions.lock(session(), !locked())} data-action="okucode-chat-lock">
              <ItemLabel icon="lock">{locked() ? "Unlock chat" : "Lock chat"}</ItemLabel>
            </Menu.Item>
            <Menu.Separator />
            <Menu.Sub gutter={0} overlap>
              <Menu.SubTrigger data-action="okucode-chat-share">
                <ItemLabel icon="share">Share</ItemLabel>
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent class="w-[200px]">
                  <Menu.Item onSelect={() => void props.actions.copyLink(session())} data-action="okucode-chat-copy-link">
                    <ItemLabel icon="link">Copy link</ItemLabel>
                  </Menu.Item>
                  <Menu.Item onSelect={props.download} data-action="okucode-chat-download">
                    <ItemLabel icon="download">Download chat</ItemLabel>
                  </Menu.Item>
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
            <Menu.Separator />
            <Menu.Item onSelect={() => void props.actions.archive(session())} disabled={locked()} data-action="okucode-chat-archive">
              <ItemLabel icon="archive">Archive</ItemLabel>
            </Menu.Item>
            <Menu.Item onSelect={props.remove} disabled={locked()} data-action="okucode-chat-delete">
              <ItemLabel icon="trash" danger={!locked()}>
                Delete
              </ItemLabel>
            </Menu.Item>
            <Menu.Separator />
            <Menu.Sub gutter={0} overlap>
              <Menu.SubTrigger disabled={locked()} data-action="okucode-chat-move">
                <ItemLabel icon="folder">Move to project</ItemLabel>
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent class="max-h-[min(360px,calc(100dvh-48px))] w-[240px] overflow-y-auto">
                  <For each={props.projects} fallback={<Menu.Item disabled>No projects yet</Menu.Item>}>
                    {(project) => (
                      <Menu.Item
                        disabled={project.worktree === session().location.directory}
                        onSelect={() => void props.actions.move(session(), project.worktree)}
                        data-project={folderName(project.worktree)}
                      >
                        <span class="truncate" title={project.worktree}>
                          {folderName(project.worktree)}
                        </span>
                      </Menu.Item>
                    )}
                  </For>
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
          </Menu.Context.Content>
        </Menu.Context.Portal>
      </Menu.Context>
    </Show>
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
  const actions = createChatActions(home)
  const dialog = useDialog()
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
  const removeChat = (record: HomeSessionRecord) => {
    const conn = server()
    if (conn) sessions.session.showDelete(ServerConnection.key(conn), record.session)
  }
  const download = (record: HomeSessionRecord) => {
    const conn = server()
    if (conn) void sessions.session.export(ServerConnection.key(conn), record.session)
  }
  const openArchived = () => {
    setMenuOpen(false)
    const api = home.server.focusedContext()?.sdk.api
    if (!api) return
    dialog.show(() => (
      <ArchivedChats
        api={api}
        onChanged={() => void actions.refresh()}
        onDelete={(session) => {
          const conn = server()
          if (conn) sessions.session.showDelete(ServerConnection.key(conn), session)
        }}
      />
    ))
  }
  // Pinned chats sit above Today / Yesterday / Older.
  const pinned = createMemo(() => sessions.data.groups().flatMap((group) => group.sessions.filter((record) => isPinned(record.session))))
  const groups = createMemo(() =>
    sessions.data.groups().map((group) => ({ ...group, sessions: group.sessions.filter((record) => !isPinned(record.session)) })),
  )
  const chatRow = (record: HomeSessionRecord) => (
    <ChatRow
      record={record}
      active={isOpen(record)}
      open={() => sessions.session.open(record.session)}
      remove={() => removeChat(record)}
      actions={actions}
      projects={home.project.list()}
      download={() => download(record)}
    />
  )
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
          <button type="button" aria-label="Show sidebar" title="Show sidebar" class="rounded-lg p-2 hover:bg-v2-background-bg-layer-02" onClick={toggle}>
            <Icon path={ICONS.show} />
          </button>
          <button type="button" aria-label="New chat" title="New chat" class="rounded-lg p-2 hover:bg-v2-background-bg-layer-02" onClick={newChat}>
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
          <button type="button" aria-label="Hide sidebar" title="Hide sidebar" class="rounded-md p-1.5 hover:bg-v2-background-bg-layer-02" onClick={toggle}>
            <Icon path={ICONS.hide} />
          </button>
        </div>

        <button type="button" data-slot="okucode-new-chat" class={`${row} bg-v2-background-bg-layer-01 font-medium`} onClick={newChat}>
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
            <button type="button" class={row} onClick={openArchived} data-action="okucode-archived-chats">
              <Icon path={ICONS.archive} />
              Archived chats
            </button>
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
              <>
                <Show when={pinned().length > 0}>
                  <div class="mb-2" data-slot="okucode-pinned-chats">
                    <div class="px-2.5 pb-1 pt-2 text-[12px] font-medium text-v2-text-text-faint">Pinned</div>
                    <For each={pinned()}>{chatRow}</For>
                  </div>
                </Show>
                <For each={groups()} fallback={<span class="px-2.5 text-[13px] text-v2-text-text-faint">No chats yet</span>}>
                  {(group) => (
                    <Show when={group.sessions.length > 0}>
                      <div class="mb-2">
                        <div class="px-2.5 pb-1 pt-2 text-[12px] font-medium text-v2-text-text-faint">{group.title}</div>
                        <For each={group.sessions}>{chatRow}</For>
                      </div>
                    </Show>
                  )}
                </For>
              </>
            }
          >
            <For each={found()} fallback={<span class="px-2.5 text-[13px] text-v2-text-text-faint">No chats found</span>}>
              {chatRow}
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

