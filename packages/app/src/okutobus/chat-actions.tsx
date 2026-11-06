// Okutobus (OkuCode): what you can do with a chat from the sidebar (right-click) — rename, pin, lock, share,
// archive, delete and move to another project — plus the Archived chats window and the locked-chat bar.
// Pinned and locked are kept in the chat's metadata on the server, so they follow the chat to every browser.
import type { SessionInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useQueryClient } from "@tanstack/solid-query"
import { createResource, For, Show } from "solid-js"
import type { HomeController } from "@/home/model"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionTitle } from "@/session/title"
import { sessionHref } from "@/shell/routes/session"
import { showToast } from "@/shell/notifications/toast"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"

export const PINNED = "okucodePinned"
export const LOCKED = "okucodeLocked"

type Meta = { metadata?: Record<string, unknown> }
export const isPinned = (session: Meta | undefined) => session?.metadata?.[PINNED] === true
export const isLocked = (session: Meta | undefined) => session?.metadata?.[LOCKED] === true

const failed = (cause: unknown) =>
  showToast({ title: "Something went wrong", description: cause instanceof Error ? cause.message : String(cause) })

/** The metadata with one OkuCode flag switched on or off (other metadata is kept). */
export function withFlag(metadata: Record<string, unknown> | undefined, key: string, on: boolean) {
  const next = { ...(metadata ?? {}) }
  if (on) next[key] = true
  else delete next[key]
  return next
}

export function createChatActions(home: HomeController) {
  const queryClient = useQueryClient()
  const conn = () => home.server.focused()
  const ctx = () => home.server.focusedContext()
  const current = (session: SessionInfo) => ctx()?.data.session.get(session.id) ?? session
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["home-sessions", conn()], exact: true })
  const patchList = (id: string, patch: Partial<SessionInfo>) =>
    queryClient.setQueryData<SessionInfo[]>(["home-sessions", conn()], (list) =>
      list?.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )

  const setFlag = async (session: SessionInfo, key: string, on: boolean) => {
    const c = ctx()
    if (!c) return
    const latest = current(session)
    const metadata = withFlag(latest.metadata as Record<string, unknown> | undefined, key, on)
    await c.sdk.api.session
      .update({ sessionID: session.id, metadata: metadata as never })
      .then(() => {
        c.data.session.remember({ ...latest, metadata } as SessionInfo)
        patchList(session.id, { metadata } as Partial<SessionInfo>)
      })
      .catch(failed)
  }

  const gone = (session: SessionInfo) => {
    const c = conn()
    if (c)
      notifySessionTabsRemoved({
        server: ServerConnection.key(c),
        directory: session.location.directory,
        sessionIDs: [session.id],
      })
  }

  return {
    refresh,
    pin: (session: SessionInfo, on: boolean) => setFlag(session, PINNED, on),
    lock: (session: SessionInfo, on: boolean) => setFlag(session, LOCKED, on),

    rename: async (session: SessionInfo, title: string) => {
      const c = ctx()
      const next = title.trim()
      if (!c || !next || next === sessionTitle(session.title)) return
      await c.sdk.api.session
        .update({ sessionID: session.id, title: next })
        .then(() => {
          c.data.session.remember({ ...current(session), title: next })
          patchList(session.id, { title: next })
        })
        .catch(failed)
    },

    archive: async (session: SessionInfo) => {
      const c = ctx()
      if (!c) return
      await c.sdk.api.session
        .update({ sessionID: session.id, archived: true })
        .then(() => {
          c.data.session.remember({ ...current(session), time: { ...current(session).time, archived: Date.now() } })
          gone(session)
          showToast({
            variant: "success",
            icon: "circle-check",
            title: "Chat archived",
            description: "Find it in ☰ → Archived chats.",
          })
        })
        .catch(failed)
        .finally(refresh)
    },

    move: async (session: SessionInfo, directory: string) => {
      const c = ctx()
      if (!c || session.location.directory === directory) return
      await c.sdk.api.session
        .move({ sessionID: session.id, directory })
        .then(() => {
          c.data.session.invalidate(session.id)
          void c.data.session.sync(session.id).catch(() => {})
          showToast({ variant: "success", icon: "circle-check", title: "Chat moved", description: directory })
        })
        .catch(failed)
        .finally(refresh)
    },

    copyLink: async (session: SessionInfo) => {
      const c = conn()
      if (!c) return
      const link = `${location.origin}${sessionHref(ServerConnection.key(c), session.id)}`
      await navigator.clipboard
        .writeText(link)
        .then(() =>
          showToast({
            variant: "success",
            icon: "circle-check",
            title: "Link copied",
            description: "Teammates on this OkuCode can open it.",
          }),
        )
        .catch(failed)
    },
  }
}

/** ☰ → Archived chats: bring a chat back or delete it for good. */
export function ArchivedChats(props: {
  api: ReturnType<typeof useServerSDK>["api"]
  onChanged: () => void
  onDelete: (session: SessionInfo) => void
}) {
  const sdk = { api: props.api }
  const dialog = useDialog()
  const [list, { refetch }] = createResource(() =>
    sdk.api.session
      .list({ archived: true, parentID: null, limit: 200, order: "desc" })
      .then((result) => result.data)
      .catch((cause) => {
        failed(cause)
        return [] as SessionInfo[]
      }),
  )
  const restore = async (session: SessionInfo) => {
    await sdk.api.session.update({ sessionID: session.id, archived: false }).catch(failed)
    await refetch()
    props.onChanged()
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title="Archived chats"
          description="Archived chats are hidden from the list. Restore one to see it again."
        />
      </DialogHeader>
      <DialogBody class="flex max-h-[60vh] min-w-[420px] flex-col gap-1 overflow-y-auto">
        <Show when={!list.loading} fallback={<span class="text-[13px] text-v2-text-text-faint">Loading…</span>}>
          <For
            each={list() ?? []}
            fallback={<span class="text-[13px] text-v2-text-text-faint">No archived chats.</span>}
          >
            {(session) => (
              <div
                data-slot="okucode-archived-chat"
                class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-v2-background-bg-layer-02"
              >
                <span class="min-w-0 flex-1 truncate text-[14px] text-v2-text-text-base">
                  {sessionTitle(session.title) || "New chat"}
                </span>
                <Button size="small" variant="ghost" onClick={() => void restore(session)}>
                  Restore
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  class="text-v2-text-text-critical"
                  onClick={() => {
                    dialog.close()
                    props.onDelete(session)
                  }}
                >
                  Delete
                </Button>
              </div>
            )}
          </For>
        </Show>
      </DialogBody>
    </Dialog>
  )
}

/** Shown instead of the message box while a chat is locked. */
export function LockedChatBar(props: { session: SessionInfo }) {
  const sdk = useServerSDK()
  const data = useData()
  const unlock = async () => {
    const latest = data.session.get(props.session.id) ?? props.session
    const metadata = withFlag(latest.metadata as Record<string, unknown> | undefined, LOCKED, false)
    await sdk.api.session
      .update({ sessionID: props.session.id, metadata: metadata as never })
      .then(() => data.session.remember({ ...latest, metadata } as SessionInfo))
      .catch(failed)
  }
  return (
    <div
      data-slot="okucode-locked-chat"
      class="flex items-center gap-3 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-4 py-3 text-[14px] text-v2-text-text-muted"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="shrink-0">
        <path
          d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
      </svg>
      <span class="flex-1">
        This chat is locked. It can't get new messages, be renamed, archived, moved or deleted.
      </span>
      <Button size="small" variant="outline" onClick={() => void unlock()}>
        Unlock
      </Button>
    </div>
  )
}
