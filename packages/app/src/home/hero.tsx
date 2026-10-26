// Okutobus (OkuCode): simple start screen — a greeting, one message box and suggestion chips.
// Typing here and pressing Enter opens a new chat in the chosen project and sends the message.
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { Mark } from "@opencode/ui/logo"
import { ServerConnection } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import type { HomeController } from "./model"
import type { createHomeProjectsController } from "./projects/controller"

type HomeProjectsController = ReturnType<typeof createHomeProjectsController>
import { autoSend } from "@/new-session/auto-send"
import { userName } from "./user-name"
import { fetchMe } from "@/okutobus/account"

const DEFAULT_CHAT_FOLDER = "OkuCode-Chats"

// Rotating examples in the empty message box.
const HINTS = [
  "How can I help you today?",
  "Explain this code in simple words…",
  "Fix the failing tests in my project…",
  "Write a SQL query that…",
  "Compare React and Angular in a table…",
]

export function greeting(hour: number) {
  if (hour < 5) return "Working late"
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  if (hour < 22) return "Good evening"
  return "Working late"
}

export function folderName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path
}

export function HomeHero(props: { home: HomeController; projects: HomeProjectsController }) {
  const tabs = useTabs()
  const [text, setText] = createSignal("")
  const [picked, setPicked] = createSignal<string>()
  const [menuOpen, setMenuOpen] = createSignal(false)
  let menuRoot: HTMLDivElement | undefined
  const closeMenu = (event: MouseEvent) => {
    if (menuOpen() && menuRoot && !menuRoot.contains(event.target as Node)) setMenuOpen(false)
  }
  document.addEventListener("mousedown", closeMenu)
  onCleanup(() => document.removeEventListener("mousedown", closeMenu))
  const [sending, setSending] = createSignal(false)
  let input: HTMLTextAreaElement | undefined

  // The name is kept in this browser only (the V2 client does not load config.username yet).
  // A name typed here wins; otherwise the first name of the Google account that signed in.
  const [me] = createResource(
    () => {
      const conn = props.home.server.focused()
      return conn?.type === "http" ? conn.http : undefined
    },
    (http) => fetchMe(http),
  )
  const name = () => userName.value() || (me() && !me()!.owner ? me()!.name?.split(" ")[0] : undefined)
  const [editingName, setEditingName] = createSignal(false)
  const projects = createMemo(() => props.home.project.list())
  // With no project added yet, chat in the folder the server runs in (`okucode web` starts in ~/OkuCode-Chats).
  const [serverFolder] = createResource(
    () => props.home.server.focusedContext(),
    (ctx) =>
      ctx.sdk.api.location
        .get()
        .then((location) => location.directory)
        .catch(() => undefined),
  )
  const directory = createMemo(() => {
    const chosen = picked()
    if (chosen && projects().some((project) => project.worktree === chosen)) return chosen
    const selected = props.home.project.selected()?.worktree
    if (selected) return selected
    const chats = projects().find((project) => folderName(project.worktree) === DEFAULT_CHAT_FOLDER)
    return chats?.worktree ?? props.home.project.newSession()?.worktree ?? serverFolder()
  })
  const [hint, setHint] = createSignal(0)
  const timer = setInterval(() => {
    if (!text()) setHint((value) => (value + 1) % HINTS.length)
  }, 3500)
  onCleanup(() => clearInterval(timer))

  const resize = () => {
    if (!input) return
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`
  }

  const send = async () => {
    const message = text().trim()
    const conn = props.home.server.focused()
    const dir = directory()
    if (!message || !conn || !dir || sending()) return
    setSending(true)
    const ctx = props.home.server.context(conn)
    ctx.projects.open(dir)
    ctx.projects.touch(dir)
    const tab = await tabs.newDraft({ server: ServerConnection.key(conn), directory: dir }, message)
    // The draft page sends the message itself as soon as it is ready.
    autoSend.request(tab.draftID)
  }


  return (
    <section data-slot="okucode-home-hero" class="mx-auto flex w-full max-w-[720px] flex-col items-center gap-6 pb-6 pt-6">
      <h1 class="flex items-center justify-center gap-3 text-center text-[28px] font-medium leading-tight text-v2-text-text-base md:text-[34px]">
        <Mark class="h-8 w-6 shrink-0" />
        <span>
        {greeting(new Date().getHours())}
        <Show when={name()}>{(value) => <>, {value()}</>}</Show>
        </span>
      </h1>
      <Show
        when={editingName()}
        fallback={
          <button
            type="button"
            onClick={() => setEditingName(true)}
            class="-mt-4 text-[12px] text-v2-text-text-faint hover:text-v2-text-text-muted"
            classList={{ "opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity": !!name() }}
          >
            {name() ? "Change name" : "What should OkuCode call you?"}
          </button>
        }
      >
        <input
          autofocus
          aria-label="Your name"
          placeholder="Your name"
          value={name()}
          class="-mt-4 w-48 rounded-md border border-v2-border-border-muted bg-transparent px-2 py-1 text-center text-[13px] text-v2-text-text-base outline-none"
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditingName(false)
            if (event.key !== "Enter") return
            const value = event.currentTarget.value
            userName.set(value)
            setEditingName(false)
          }}
          onBlur={() => setEditingName(false)}
        />
      </Show>

      <div
        class="w-full rounded-[24px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-4 pb-3 pt-4 shadow-[var(--v2-elevation-raised)] transition-[box-shadow,border-color] focus-within:border-v2-border-border-strong focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--v2-text-text-accent)_14%,transparent),var(--v2-elevation-raised)]"
        onClick={(event) => {
          if (event.target === event.currentTarget) input?.focus()
        }}
      >
        <textarea
          ref={input}
          rows={2}
          value={text()}
          placeholder={HINTS[hint()]}
          aria-label="Message OkuCode"
          class="block max-h-[240px] w-full resize-none bg-transparent text-[16px] leading-6 text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
          onInput={(event) => {
            setText(event.currentTarget.value)
            resize()
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <div class="mt-3 flex items-center gap-2">
          {/* Folder for this chat: click to pick another project or open any folder. */}
          <div class="relative" ref={menuRoot}>
            <button
              type="button"
              aria-label="Choose the folder for this chat"
              aria-expanded={menuOpen()}
              title={directory() ?? "Choose a folder"}
              onClick={() => setMenuOpen(!menuOpen())}
              class="flex min-w-0 max-w-[280px] items-center gap-1.5 rounded-full border border-v2-border-border-muted px-3 py-1 text-[12.5px] text-v2-text-text-muted hover:border-v2-border-border-strong hover:text-v2-text-text-base"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="shrink-0">
                <path
                  d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="truncate">{directory() ? folderName(directory() ?? "") : "Choose a folder"}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" class="shrink-0">
                <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </svg>
            </button>
            <Show when={menuOpen()}>
              <div
                role="menu"
                class="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-v2-border-border-muted bg-v2-background-bg-base p-1 shadow-[var(--v2-elevation-raised)]"
              >
                <div class="px-2.5 pb-1 pt-1.5 text-[11.5px] font-medium text-v2-text-text-faint">Chat in folder</div>
                <For each={projects()} fallback={<div class="px-2.5 py-1.5 text-[13px] text-v2-text-text-faint">No projects yet</div>}>
                  {(project) => (
                    <button
                      type="button"
                      role="menuitem"
                      title={project.worktree}
                      onClick={() => {
                        setPicked(project.worktree)
                        setMenuOpen(false)
                        input?.focus()
                      }}
                      class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-v2-text-text-base hover:bg-v2-background-bg-layer-02"
                    >
                      <span class="truncate">{folderName(project.worktree)}</span>
                      <Show when={project.worktree === directory()}>
                        <span class="text-[12px] text-v2-text-text-faint">✓</span>
                      </Show>
                    </button>
                  )}
                </For>
                <div class="my-1 border-t border-v2-border-border-muted" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    const conn = props.home.server.focused()
                    if (conn) props.projects.project.choose(conn)
                  }}
                  class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-v2-text-text-base hover:bg-v2-background-bg-layer-02"
                >
                  + Open another folder…
                </button>
              </div>
            </Show>
          </div>
          <div class="flex-1" />
          <button
            type="button"
            aria-label="Send message"
            disabled={!text().trim() || !directory() || sending()}
            onClick={() => void send()}
            class="flex size-9 items-center justify-center rounded-full bg-v2-background-bg-inverse text-v2-text-text-inverse transition-[opacity,transform] hover:scale-105 disabled:scale-100 disabled:opacity-25"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  )
}
