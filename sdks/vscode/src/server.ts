// Okutobus (OkuCode) FR-53: the connection between the VS Code chat panel and an OkuCode server.
// The extension starts its own `okucode serve` in the background (port `okucode.panelPort`, a private password kept in
// VS Code's secret storage), so the panel works without a terminal. Events arrive over Server-Sent Events.
import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import * as net from "node:net"
import * as vscode from "vscode"

export type ServerEvent = { type: string; data: any }

const PASSWORD_KEY = "okucode.panelPassword"

export class OkuServer implements vscode.Disposable {
  private child: ChildProcess | undefined
  private password: string | undefined
  private starting: Promise<void> | undefined
  private readonly output: vscode.OutputChannel
  private readonly listeners = new Set<(event: ServerEvent) => void>()
  private stream: AbortController | undefined

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly settings: { command: () => string; port: () => number },
  ) {
    this.output = vscode.window.createOutputChannel("OkuCode server")
  }

  get url() {
    return `http://127.0.0.1:${this.settings.port()}`
  }

  private headers(directory?: string): Record<string, string> {
    return {
      authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString("base64")}`,
      "content-type": "application/json",
      ...(directory ? { "x-opencode-directory": encodeURIComponent(directory) } : {}),
    }
  }

  /** Starts the server when needed and waits until it answers. */
  ready() {
    this.starting ??= this.start().finally(() => (this.starting = undefined))
    return this.starting
  }

  private async start() {
    this.password ??= await this.context.secrets.get(PASSWORD_KEY)
    if (!this.password) {
      this.password = randomBytes(18).toString("base64url")
      await this.context.secrets.store(PASSWORD_KEY, this.password)
    }
    if (await this.ping()) return this.listen()
    if (await listening(this.settings.port()))
      throw new Error(
        `Port ${this.settings.port()} is used by another program. Change "okucode.panelPort" in VS Code settings.`,
      )
    // An interactive login shell reads ~/.zprofile and ~/.zshrc, so it finds `okucode` and `bun` on the user's PATH
    // even when VS Code was opened from the Dock.
    const shell = process.platform === "win32" ? undefined : process.env.SHELL || "/bin/sh"
    const line = `exec ${this.settings.command()} serve --hostname 127.0.0.1 --port ${this.settings.port()}`
    this.output.appendLine(`Starting: ${line}`)
    this.child = shell
      ? spawn(shell, ["-ilc", line], { env: { ...process.env, OPENCODE_PASSWORD: this.password, OPENCODE_CALLER: "vscode" } })
      : spawn(line.replace(/^exec /, ""), {
          shell: true,
          env: { ...process.env, OPENCODE_PASSWORD: this.password, OPENCODE_CALLER: "vscode" },
        })
    this.child.stdout?.on("data", (chunk) => this.output.append(String(chunk)))
    this.child.stderr?.on("data", (chunk) => this.output.append(String(chunk)))
    this.child.on("exit", (code) => {
      this.output.appendLine(`OkuCode server stopped (exit ${code}).`)
      this.child = undefined
    })
    for (let i = 0; i < 120; i++) {
      if (await this.ping()) return this.listen()
      if (!this.child) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    this.output.show(true)
    throw new Error(`OkuCode did not start. See the "OkuCode server" output for details.`)
  }

  private async ping() {
    try {
      const response = await fetch(`${this.url}/api/info`, { headers: this.headers(), signal: AbortSignal.timeout(1500) })
      return response.ok
    } catch {
      return false
    }
  }

  async request<T = any>(method: string, path: string, directory?: string, body?: unknown): Promise<T> {
    await this.ready()
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: this.headers(directory),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    if (!response.ok) {
      let message = text
      try {
        message = JSON.parse(text).message ?? JSON.parse(text).error ?? text
      } catch {}
      throw new Error(`OkuCode: ${message || response.statusText}`)
    }
    return (text ? JSON.parse(text) : undefined) as T
  }

  onEvent(listener: (event: ServerEvent) => void): vscode.Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  /** Keeps one event stream open, reconnecting after drops. */
  private listen() {
    if (this.stream) return
    const controller = new AbortController()
    this.stream = controller
    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(`${this.url}/api/event`, { headers: this.headers(), signal: controller.signal })
          if (!response.ok || !response.body) throw new Error(`events ${response.status}`)
          const decoder = new TextDecoder()
          let buffer = ""
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            buffer += decoder.decode(chunk, { stream: true })
            let end: number
            while ((end = buffer.indexOf("\n\n")) !== -1) {
              const block = buffer.slice(0, end)
              buffer = buffer.slice(end + 2)
              const data = block
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n")
              if (!data) continue
              try {
                const event = JSON.parse(data) as ServerEvent
                for (const listener of this.listeners) listener(event)
              } catch {
                // Not an event we understand.
              }
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return
          this.output.appendLine(`Event stream dropped: ${(error as Error).message}. Reconnecting…`)
        }
        await new Promise((resolve) => setTimeout(resolve, 1500))
        if (!(await this.ping())) await this.ready().catch(() => {})
      }
    }
    void run()
  }

  dispose() {
    this.stream?.abort()
    this.child?.kill()
    this.output.dispose()
  }
}

function listening(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port })
    socket.setTimeout(800)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("timeout", () => {
      socket.destroy()
      resolve(false)
    })
    socket.once("error", () => resolve(false))
  })
}
