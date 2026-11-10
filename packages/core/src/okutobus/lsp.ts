export * as OkuLsp from "./lsp.js"

// Okutobus (OkuCode) SRS FR-17: code errors after every edit, from language servers (LSP).
//
// After the edit or write tool changes a file, OkuCode asks the language server for that language — the same one an
// editor like VS Code uses — for the file's errors, and puts them in the tool result ("Errors after this change:
// line 4: Cannot find name 'totl'") so the model fixes them right away. The chat shows them under the step.
//
// Servers used when they are installed (found on PATH or in the project's node_modules/.bin):
//   Python      pyright-langserver --stdio  (or basedpyright-langserver)
//   TS / JS     typescript-language-server --stdio
//   Go          gopls
//   Rust        rust-analyzer
// One server per project and language is started on first use and kept running. Without a server, OkuCode still
// checks the syntax of JSON, JavaScript/TypeScript (Bun's parser) and Python (python3).
// okucode.json "lsp": false turns it off.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { OkuApproval } from "./approval.js"

export type Diagnostic = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  message: string
  severity: number
  source?: string
}

export const enabled = () => {
  try {
    return (JSON.parse(readFileSync(OkuApproval.settingsFile(), "utf8")) as { lsp?: unknown }).lsp !== false
  } catch {
    return true
  }
}

type Language = { id: string; servers: { command: string; args: string[] }[] }
const LANGUAGES: Record<string, Language> = {
  ".py": {
    id: "python",
    servers: [
      { command: "pyright-langserver", args: ["--stdio"] },
      { command: "basedpyright-langserver", args: ["--stdio"] },
    ],
  },
  ".ts": { id: "typescript", servers: [{ command: "typescript-language-server", args: ["--stdio"] }] },
  ".tsx": { id: "typescriptreact", servers: [{ command: "typescript-language-server", args: ["--stdio"] }] },
  ".js": { id: "javascript", servers: [{ command: "typescript-language-server", args: ["--stdio"] }] },
  ".jsx": { id: "javascriptreact", servers: [{ command: "typescript-language-server", args: ["--stdio"] }] },
  ".mjs": { id: "javascript", servers: [{ command: "typescript-language-server", args: ["--stdio"] }] },
  ".go": { id: "go", servers: [{ command: "gopls", args: [] }] },
  ".rs": { id: "rust", servers: [{ command: "rust-analyzer", args: [] }] },
}

const which = (command: string, root: string) => {
  const local = path.join(root, "node_modules", ".bin", command)
  if (existsSync(local)) return local
  const found = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
    encoding: "utf8",
    timeout: 3000,
  })
  return found.status === 0 ? found.stdout.split("\n")[0]!.trim() || undefined : undefined
}

/** A minimal LSP client: JSON-RPC over stdio, enough for opening files and receiving their diagnostics. */
class Client {
  private buffer = Buffer.alloc(0)
  private id = 0
  private pending = new Map<number, (value: unknown) => void>()
  private waiting = new Map<string, ((list: Diagnostic[]) => void)[]>()
  private versions = new Map<string, number>()
  readonly ready: Promise<void>
  dead = false

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    root: string,
  ) {
    child.stdout.on("data", (chunk: Buffer) => this.read(chunk))
    child.stderr.on("data", () => {})
    child.on("exit", () => {
      this.dead = true
      for (const list of this.waiting.values()) for (const done of list) done([])
      this.waiting.clear()
    })
    child.on("error", () => (this.dead = true))
    const uri = pathToFileURL(root).href
    this.ready = this.request("initialize", {
      processId: process.pid,
      rootUri: uri,
      workspaceFolders: [{ uri, name: path.basename(root) }],
      capabilities: {
        textDocument: { publishDiagnostics: { relatedInformation: false }, synchronization: { didSave: true } },
        workspace: { configuration: true, workspaceFolders: true },
      },
      initializationOptions: {},
    }).then(() => {
      this.notify("initialized", {})
      // Some servers (pyright) only start checking once they have been sent settings.
      this.notify("workspace/didChangeConfiguration", { settings: {} })
    })
  }

  private send(message: object) {
    if (this.dead) return
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }))
    this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
  }
  request(method: string, params: unknown) {
    const id = ++this.id
    return new Promise<unknown>((resolve) => {
      this.pending.set(id, resolve)
      this.send({ id, method, params })
    })
  }
  notify(method: string, params: unknown) {
    this.send({ method, params })
  }

  private read(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const end = this.buffer.indexOf("\r\n\r\n")
      if (end === -1) return
      const length = Number(/Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, end).toString())?.[1] ?? -1)
      if (length < 0 || this.buffer.length < end + 4 + length) return
      const text = this.buffer.subarray(end + 4, end + 4 + length).toString()
      this.buffer = this.buffer.subarray(end + 4 + length)
      try {
        this.handle(JSON.parse(text))
      } catch {}
    }
  }

  private handle(message: { id?: number; method?: string; params?: any; result?: unknown }) {
    if (message.method && message.id !== undefined) {
      // Requests from the server: settings (none), progress and registration (accepted).
      const result = message.method === "workspace/configuration" ? (message.params?.items ?? []).map(() => ({})) : null
      this.send({ id: message.id, result })
      return
    }
    if (message.id !== undefined) {
      this.pending.get(message.id)?.(message.result)
      this.pending.delete(message.id)
      return
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const list = this.waiting.get(message.params.uri)
      if (!list?.length) return
      this.waiting.delete(message.params.uri)
      for (const done of list) done(message.params.diagnostics ?? [])
    }
  }

  /** Opens (or updates) the file and waits for the server's diagnostics for it. */
  async diagnostics(file: string, language: string, text: string, timeout: number): Promise<Diagnostic[] | undefined> {
    await this.ready
    const uri = pathToFileURL(file).href
    const result = new Promise<Diagnostic[] | undefined>((resolve) => {
      const list = this.waiting.get(uri) ?? []
      list.push(resolve)
      this.waiting.set(uri, list)
      setTimeout(() => resolve(undefined), timeout)
    })
    const version = (this.versions.get(uri) ?? 0) + 1
    this.versions.set(uri, version)
    if (version === 1)
      this.notify("textDocument/didOpen", { textDocument: { uri, languageId: language, version, text } })
    else this.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] })
    this.notify("textDocument/didSave", { textDocument: { uri }, text })
    return result
  }

  stop() {
    this.dead = true
    this.child.kill()
  }
}

const clients = new Map<string, Client>()

function client(root: string, language: Language): Client | undefined {
  const key = `${root}\0${language.id.replace(/react$/, "")}`
  const known = clients.get(key)
  if (known && !known.dead) return known
  for (const server of language.servers) {
    const command = which(server.command, root)
    if (!command) continue
    const child = spawn(command, server.args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] })
    const made = new Client(child, root)
    clients.set(key, made)
    return made
  }
  return undefined
}

const at = (line: number, character: number, message: string, source: string): Diagnostic => ({
  range: { start: { line, character }, end: { line, character } },
  message,
  severity: 1,
  source,
})

/** Syntax errors without a language server. */
export function syntax(file: string, text: string): Diagnostic[] {
  const ext = path.extname(file).toLowerCase()
  if (ext === ".json") {
    try {
      JSON.parse(text)
      return []
    } catch (error) {
      const offset = Number(/position (\d+)/.exec(String(error))?.[1] ?? 0)
      const before = text.slice(0, offset).split("\n")
      return [at(before.length - 1, before.at(-1)!.length, String((error as Error).message), "json")]
    }
  }
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext) && typeof Bun !== "undefined") {
    try {
      new Bun.Transpiler({
        loader: ext.slice(1).replace(/^[mc]js$/, "js") as "ts" | "tsx" | "js" | "jsx",
      }).transformSync(text)
      return []
    } catch (error) {
      const errors = (error as { errors?: { message: string; position?: { line: number; column: number } }[] })
        .errors ?? [error as never]
      return errors
        .slice(0, 5)
        .map((item) =>
          at((item.position?.line ?? 1) - 1, item.position?.column ?? 0, item.message ?? String(item), "syntax"),
        )
    }
  }
  if (ext === ".py") {
    const check = spawnSync(
      "python3",
      [
        "-c",
        "import ast,sys\ntry:\n ast.parse(sys.stdin.read())\nexcept SyntaxError as e:\n print(f'{e.lineno}:{e.offset or 1}:{e.msg}')",
      ],
      { input: text, encoding: "utf8", timeout: 5000 },
    )
    const match = check.status === 0 ? /^(\d+):(\d+):(.*)$/m.exec(check.stdout) : null
    return match ? [at(Number(match[1]) - 1, Number(match[2]) - 1, match[3]!.trim(), "python")] : []
  }
  return []
}

/** The errors in a file after a change (language server first, syntax check otherwise). */
export async function check(file: string, root: string, timeout = 8000): Promise<Diagnostic[]> {
  if (!enabled()) return []
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return []
  }
  const language = LANGUAGES[path.extname(file).toLowerCase()]
  if (language) {
    const server = client(root, language)
    const found = server ? await server.diagnostics(file, language.id, text, timeout).catch(() => undefined) : undefined
    if (found) return found.filter((item) => (item.severity ?? 1) === 1).slice(0, 20)
  }
  return syntax(file, text)
}

/** The errors as text for the model, or "" when there are none. */
export function report(diagnostics: ReadonlyArray<Diagnostic>) {
  if (!diagnostics.length) return ""
  const lines = diagnostics
    .slice(0, 10)
    .map(
      (item) => `- line ${item.range.start.line + 1}:${item.range.start.character + 1}: ${item.message.split("\n")[0]}`,
    )
  return `\n\nErrors in this file after the change (fix them before you finish):\n${lines.join("\n")}`
}

export function stopAll() {
  for (const item of clients.values()) item.stop()
  clients.clear()
}
