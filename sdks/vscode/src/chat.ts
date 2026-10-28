// Okutobus (OkuCode) FR-53: the chat panel in the VS Code sidebar.
// - Chats with OkuCode in the open folder; replies stream in as they are written.
// - Commands that need approval show Allow once / Always allow / Deny buttons in the panel.
// - Every file OkuCode changes gets a VS Code diff (before ↔ after) and an Undo button.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import { chatHtml } from "./chat-html"
import type { OkuServer, ServerEvent } from "./server"

export const BEFORE_SCHEME = "okucode-before"
const EDIT_TOOLS = new Set(["write", "edit", "patch"])

type Change = { file: string; before: string | null; after?: string; undone?: boolean }

/** Files a patch tool call touches ("*** Update File: a.ts", "*** Add File: b.ts", "+++ b/c.ts"). */
export function patchFiles(patch: string) {
  const files = new Set<string>()
  for (const line of patch.split("\n")) {
    const match = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line) ?? /^\+\+\+ (?:b\/)?(.+)$/.exec(line)
    if (match && match[1] && match[1] !== "/dev/null") files.add(match[1].trim())
  }
  return [...files]
}

/** Short text for a tool row: "Wrote calc.py", "Ran: npm test". */
export function describeTool(name: string, input: Record<string, unknown>) {
  const file = String(input.path ?? input.filePath ?? "")
  switch (name) {
    case "write":
      return `Write ${file}`
    case "edit":
      return `Edit ${file}`
    case "patch":
      return `Patch ${patchFiles(String(input.patch ?? input.patchText ?? "")).join(", ") || "files"}`
    case "read":
      return `Read ${file}`
    case "shell":
    case "bash":
      return `Run: ${String(input.command ?? "")}`
    case "glob":
      return `Find files: ${String(input.pattern ?? "")}`
    case "grep":
      return `Search: ${String(input.pattern ?? "")}`
    default:
      return name
  }
}

export class ChatView implements vscode.WebviewViewProvider, vscode.TextDocumentContentProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined
  private sessionID: string | undefined
  private directory: string | undefined
  private readonly changes = new Map<string, Change>()
  private readonly pending = new Map<string, { file: string; before: string | null }[]>()
  /** Tool names by call ID: the name arrives with "tool.input.started", the input with "tool.called". */
  private readonly toolNames = new Map<string, string>()
  private readonly queue: unknown[] = []
  private readonly disposables: vscode.Disposable[] = []
  private readonly beforeChanged = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.beforeChanged.event

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly server: OkuServer,
    private readonly workspaceFolder: () => string | undefined,
  ) {
    this.disposables.push(server.onEvent((event) => this.onServerEvent(event)))
  }

  dispose() {
    for (const item of this.disposables) item.dispose()
  }

  /** The open folder as a clean absolute path (the server keys chats by folder). */
  private folder() {
    const value = this.workspaceFolder()
    return value ? path.resolve(value) : undefined
  }

  // ---- the "before" side of diffs ----

  provideTextDocumentContent(uri: vscode.Uri) {
    return this.changes.get(uri.query)?.before ?? ""
  }

  // ---- webview ----

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = chatHtml(view.webview)
    view.webview.onDidReceiveMessage((message) => this.onMessage(message), undefined, this.disposables)
    view.onDidDispose(() => (this.view = undefined), undefined, this.disposables)
  }

  private post(message: unknown) {
    if (this.view) void this.view.webview.postMessage(message)
    else this.queue.push(message)
  }

  /** Shows the panel and puts text (like "@src/app.ts#L3-9 ") into the message box. */
  async insert(text: string, send = false) {
    await vscode.commands.executeCommand("okucode.chat.focus")
    // The webview needs a moment the first time it opens.
    for (let i = 0; i < 20 && !this.view; i++) await new Promise((resolve) => setTimeout(resolve, 100))
    this.post({ type: "insert", text, send })
  }

  private stateKey(directory: string) {
    return `okucode.session:${directory}`
  }

  private async onMessage(message: any) {
    try {
      switch (message.type) {
        case "ready":
          for (const item of this.queue.splice(0)) this.post(item)
          return this.restore()
        case "send":
          return await this.send(String(message.text ?? ""))
        case "stop":
          if (this.sessionID && this.directory)
            await this.server.request("POST", `/api/session/${this.sessionID}/interrupt`, this.directory)
          return
        case "new":
          return await this.newChat()
        case "permission":
          await this.server.request(
            "POST",
            `/api/session/${message.sessionID}/permission/${message.id}/reply`,
            this.directory,
            { decision: message.decision },
          )
          return
        case "diff":
          return await this.openDiff(String(message.id))
        case "undo":
          return this.undo(String(message.id))
        case "open":
          return await this.openFile(String(message.file))
        case "addFile":
          return this.addActiveFile()
      }
    } catch (error) {
      this.post({ type: "error", text: (error as Error).message })
    }
  }

  private async restore() {
    const directory = this.folder()
    if (!directory) return this.post({ type: "status", text: "Open a folder to chat with OkuCode about it." })
    const saved = this.context.workspaceState.get<string>(this.stateKey(directory))
    this.post({ type: "folder", name: path.basename(directory) })
    if (!saved) return
    try {
      const result = await this.server.request<{ data: any[] }>(
        "GET",
        `/api/session/${saved}/message?limit=60`,
        directory,
      )
      this.sessionID = saved
      this.directory = directory
      const history = result.data.slice().reverse()
      this.post({ type: "history", messages: history.map(simplify).filter(Boolean) })
    } catch {
      // The chat was deleted or the server changed; start fresh.
      await this.context.workspaceState.update(this.stateKey(directory), undefined)
    }
  }

  private async newChat() {
    if (this.directory) await this.context.workspaceState.update(this.stateKey(this.directory), undefined)
    this.sessionID = undefined
    this.post({ type: "cleared" })
  }

  private async send(text: string) {
    if (!text.trim()) return
    const directory = this.folder()
    if (!directory) throw new Error("Open a folder first (File → Open Folder), then chat with OkuCode about it.")
    this.post({ type: "status", text: "Connecting to OkuCode…" })
    await this.server.ready()
    if (!this.sessionID || this.directory !== directory) {
      // The folder goes in the body: a new chat belongs to the folder named there.
      const created = await this.server.request<{ data: { id: string } }>("POST", "/api/session", directory, {
        location: { directory },
      })
      this.sessionID = created.data.id
      this.directory = directory
      await this.context.workspaceState.update(this.stateKey(directory), this.sessionID)
    }
    this.post({ type: "user", text })
    this.post({ type: "busy", busy: true })
    await this.server.request("POST", `/api/session/${this.sessionID}/prompt`, directory, { text })
  }

  private addActiveFile() {
    const editor = vscode.window.activeTextEditor
    if (!editor) return this.post({ type: "error", text: "Open a file first." })
    this.post({ type: "insert", text: `${fileReference(editor)} ` })
  }

  // ---- server events for this chat ----

  private onServerEvent(event: ServerEvent) {
    const data = event.data ?? {}
    if (!this.sessionID || data.sessionID !== this.sessionID) return
    switch (event.type) {
      case "session.execution.started":
        return this.post({ type: "busy", busy: true })
      case "session.execution.succeeded":
      case "session.execution.interrupted":
        return this.post({ type: "busy", busy: false })
      case "session.execution.failed":
        this.post({ type: "error", text: data.error?.message ?? "OkuCode stopped with an error." })
        return this.post({ type: "busy", busy: false })
      case "session.text.delta":
        return this.post({ type: "delta", id: `${data.assistantMessageID}:${data.ordinal}`, delta: data.delta })
      case "session.text.ended":
        return this.post({ type: "text", id: `${data.assistantMessageID}:${data.ordinal}`, text: data.text })
      case "session.synthetic":
        return this.post({ type: "note", text: String(data.text ?? "").replace(/^\[OkuCode tests\]\s*/, "Tests: ") })
      case "session.tool.input.started":
        this.toolNames.set(data.id, data.name)
        return
      case "session.tool.called": {
        const name = data.name ?? this.toolNames.get(data.id) ?? "tool"
        this.snapshot(data.id, name, data.input ?? {})
        return this.post({ type: "tool", id: data.id, name, label: describeTool(name, data.input ?? {}) })
      }
      case "session.tool.success":
        return this.toolDone(data.id, true, data.content)
      case "session.tool.failed":
        return this.toolDone(data.id, false, data.content ?? [{ type: "text", text: data.error?.message ?? "Failed" }])
      case "permission.asked":
        return this.post({
          type: "permission",
          id: data.id,
          sessionID: data.sessionID,
          action: data.action,
          resources: data.resources ?? [],
        })
      case "permission.replied":
        return this.post({ type: "permissionDone", id: data.requestID, reply: data.reply })
    }
  }

  private resolve(file: string) {
    return path.isAbsolute(file) ? file : path.join(this.directory ?? "", file)
  }

  /** Remembers the files a write/edit/patch is about to change, so the diff has a "before" side. */
  private snapshot(id: string, name: string, input: Record<string, unknown>) {
    if (!EDIT_TOOLS.has(name)) return
    const files =
      name === "patch"
        ? patchFiles(String(input.patch ?? input.patchText ?? ""))
        : [String(input.path ?? input.filePath ?? "")].filter(Boolean)
    this.pending.set(
      id,
      files.map((file) => {
        const full = this.resolve(file)
        return { file: full, before: existsSync(full) ? readFileSync(full, "utf8") : null }
      }),
    )
  }

  private toolDone(id: string, ok: boolean, content: { type: string; text?: string }[] = []) {
    const output = content
      .map((item) => item.text ?? "")
      .join("\n")
      .trim()
    const touched = ok ? (this.pending.get(id) ?? []) : []
    this.pending.delete(id)
    this.toolNames.delete(id)
    const changes = touched.flatMap((item, index) => {
      const after = existsSync(item.file) ? readFileSync(item.file, "utf8") : null
      if (after === item.before) return []
      const key = `${id}:${index}`
      this.changes.set(key, { file: item.file, before: item.before, after: after ?? undefined })
      const stats = lineStats(item.before ?? "", after ?? "")
      return [{ id: key, file: vscode.workspace.asRelativePath(item.file), ...stats, created: item.before === null }]
    })
    this.post({ type: "toolDone", id, ok, output: output.slice(0, 4000), changes })
    if (changes.length && vscode.workspace.getConfiguration("okucode").get<boolean>("showDiffs", true))
      void this.openDiff(changes[changes.length - 1]!.id, true)
  }

  private async openDiff(id: string, preserveFocus = false) {
    const change = this.changes.get(id)
    if (!change) return
    const before = vscode.Uri.from({ scheme: BEFORE_SCHEME, path: change.file, query: id })
    this.beforeChanged.fire(before)
    const name = path.basename(change.file)
    await vscode.commands.executeCommand(
      "vscode.diff",
      before,
      vscode.Uri.file(change.file),
      `${name} (before ↔ OkuCode)`,
      { preview: true, preserveFocus },
    )
  }

  private undo(id: string) {
    const change = this.changes.get(id)
    if (!change || change.undone) return
    if (change.before === null) rmSync(change.file, { force: true })
    else {
      mkdirSync(path.dirname(change.file), { recursive: true })
      writeFileSync(change.file, change.before)
    }
    change.undone = true
    this.post({ type: "undone", id })
    void vscode.window.showInformationMessage(`Undid OkuCode's change to ${vscode.workspace.asRelativePath(change.file)}.`)
  }

  private async openFile(file: string) {
    const document = await vscode.workspace.openTextDocument(this.resolve(file))
    await vscode.window.showTextDocument(document, { preview: true })
  }
}

export function fileReference(editor: vscode.TextEditor) {
  let reference = `@${vscode.workspace.asRelativePath(editor.document.uri)}`
  const selection = editor.selection
  if (!selection.isEmpty) {
    const start = selection.start.line + 1
    const end = selection.end.line + 1
    reference += start === end ? `#L${start}` : `#L${start}-${end}`
  }
  return reference
}

/** Added and removed line counts between two texts (a simple LCS, enough for a "+3 −1" badge). */
export function lineStats(before: string, after: string) {
  const a = before ? before.replace(/\n$/, "").split("\n") : []
  const b = after ? after.replace(/\n$/, "").split("\n") : []
  if (a.length * b.length > 4_000_000) return { additions: b.length, deletions: a.length }
  let previous = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const current = new Array(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++)
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1])
    previous = current
  }
  const same = previous[b.length]
  return { additions: b.length - same, deletions: a.length - same }
}

/** A stored message as the panel shows it in history. */
function simplify(message: any) {
  if (message.type === "user") return { role: "user", text: message.text }
  if (message.type === "synthetic") return { role: "note", text: String(message.text ?? "").replace(/^\[OkuCode tests\]\s*/, "Tests: ") }
  if (message.type !== "assistant") return undefined
  const parts = (message.content ?? []).flatMap((part: any) => {
    if (part.type === "text") return [{ kind: "text", text: part.text }]
    if (part.type === "tool")
      return [{ kind: "tool", label: describeTool(part.name, part.state?.input ?? {}), ok: part.state?.status !== "error" }]
    return []
  })
  return { role: "assistant", parts }
}
