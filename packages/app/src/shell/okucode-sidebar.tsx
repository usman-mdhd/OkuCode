// Okutobus (OkuCode): left sidebar — New chat, projects, recent chats and the user at the bottom.
// It replaces the tab strip on wide screens so the app works like a simple chat app.
import { useLocation, useNavigate } from "@solidjs/router"
import { Mark } from "@opencode/ui/logo"
import { createMemo, createSignal, For, type JSX, Show } from "solid-js"
import { createHomeController } from "@/home/model"
import { createHomeProjectsController } from "@/home/projects/controller"
import { createHomeSessionsController } from "@/home/sessions/controller"
import { folderName } from "@/home/hero"
import { userName } from "@/home/user-name"
import { sessionTitle } from "@/session/title"
import { useSettingsCommand } from "@/settings/command"

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
}

function Section(props: { title: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="mt-5 flex min-h-0 flex-col">
      <div class="flex items-center justify-between px-2.5 pb-1">
        <span class="text-[12px] font-medium text-v2-text-text-faint">{props.title}</span>
        {props.action}
      </div>
      {props.children}
    </div>
  )
}

export function OkuCodeSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const openSettings = useSettingsCommand()
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const [collapsed, setCollapsed] = createSignal(readCollapsed())

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
  const recents = createMemo(() => sessions.data.records().slice(0, 40))
  const initial = () => (userName.value() || "You").charAt(0).toUpperCase()

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

        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Section
            title="Projects"
            action={
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
            }
          >
            <For each={home.project.list()} fallback={<span class="px-2.5 text-[13px] text-v2-text-text-faint">Add a folder to start</span>}>
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
          </Section>

          <Section title={selected() ? `Chats in ${folderName(selected() ?? "")}` : "Recents"}>
            <For each={recents()} fallback={<span class="px-2.5 text-[13px] text-v2-text-text-faint">No chats yet</span>}>
              {(record) => (
                <button
                  type="button"
                  class={`${row} text-[13.5px]`}
                  title={`${sessionTitle(record.session.title) ?? "Chat"} · ${record.projectName}`}
                  onClick={() => sessions.session.open(record.session)}
                >
                  <span class="truncate">{sessionTitle(record.session.title) || "New chat"}</span>
                </button>
              )}
            </For>
          </Section>
        </div>

        <div class="mt-2 flex items-center gap-2 border-t border-v2-border-border-muted px-1.5 pt-2">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-v2-background-bg-layer-03 text-[13px] font-semibold text-v2-text-text-base">
            {initial()}
          </span>
          <span class="min-w-0 flex-1 truncate text-[14px] text-v2-text-text-base">{userName.value() || "You"}</span>
          <button type="button" aria-label="Settings" class="rounded-md p-1.5 hover:bg-v2-background-bg-layer-02" onClick={() => openSettings()}>
            <Icon path={ICONS.settings} />
          </button>
        </div>
      </aside>
    </Show>
  )
}

