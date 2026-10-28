// Okutobus (OkuCode): VS Code extension.
// - OkuCode chat panel (FR-53): the OkuCode icon in the activity bar. Chats about the open folder, approves commands in
//   the panel, and shows every file change as a VS Code diff with Undo. Starts its own `okucode serve` in the background.
// - OkuCode: Open in Terminal (Cmd+Esc): the terminal version beside the editor.
// - OkuCode: Open Web App: the full OkuCode web page inside VS Code (starts `okucode web` when needed).
// - OkuCode: Add File to Chat (Cmd+Alt+K): adds @file or @file#L10-20 for the current file/selection to the panel.
// - Right-click a file or selection: Ask OkuCode about this.
import * as net from "node:net"
import * as vscode from "vscode"
import { BEFORE_SCHEME, ChatView, fileReference as editorReference } from "./chat"
import { OkuServer } from "./server"

const TERMINAL_NAME = "OkuCode"
const SERVER_TERMINAL_NAME = "OkuCode server"

export function deactivate() {}

export function activate(context: vscode.ExtensionContext) {
  const config = () => vscode.workspace.getConfiguration("okucode")
  const command = () => config().get<string>("command") || "okucode"
  const port = () => config().get<number>("port") || 4096
  const panelPort = () => config().get<number>("panelPort") || 4097

  const icon = {
    light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
    dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
  }

  function folder() {
    const active = vscode.window.activeTextEditor?.document.uri
    const fromFile = active ? vscode.workspace.getWorkspaceFolder(active) : undefined
    return (fromFile ?? vscode.workspace.workspaceFolders?.[0])?.uri.fsPath
  }

  function openTerminal() {
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: icon,
      cwd: folder(),
      location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      env: { OPENCODE_CALLER: "vscode" },
    })
    terminal.show()
    terminal.sendText(command())
    return terminal
  }

  function okuTerminal() {
    return vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
  }

  function fileReference() {
    const editor = vscode.window.activeTextEditor
    if (!editor || !vscode.workspace.getWorkspaceFolder(editor.document.uri)) return
    let reference = `@${vscode.workspace.asRelativePath(editor.document.uri)}`
    const selection = editor.selection
    if (!selection.isEmpty) {
      const start = selection.start.line + 1
      const end = selection.end.line + 1
      reference += start === end ? `#L${start}` : `#L${start}-${end}`
    }
    return reference
  }

  function isListening(value: number) {
    return new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port: value })
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

  async function openChatPanel() {
    const url = `http://127.0.0.1:${port()}`
    if (!(await isListening(port()))) {
      const server =
        vscode.window.terminals.find((t) => t.name === SERVER_TERMINAL_NAME) ??
        vscode.window.createTerminal({ name: SERVER_TERMINAL_NAME, iconPath: icon, env: { OPENCODE_CALLER: "vscode" } })
      server.sendText(`${command()} web --port ${port()}`)
      server.show(true)
      const started = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Starting OkuCode…" },
        async () => {
          for (let i = 0; i < 120; i++) {
            if (await isListening(port())) return true
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
          return false
        },
      )
      if (!started) {
        vscode.window.showErrorMessage(`OkuCode did not start. Check the "${SERVER_TERMINAL_NAME}" terminal.`)
        return
      }
      vscode.window.showInformationMessage(
        `OkuCode started. Its password is shown in the "${SERVER_TERMINAL_NAME}" terminal.`,
      )
    }
    await vscode.commands.executeCommand("simpleBrowser.show", url)
  }

  const server = new OkuServer(context, { command, port: panelPort })
  const chat = new ChatView(context, server, folder)
  context.subscriptions.push(
    server,
    chat,
    vscode.window.registerWebviewViewProvider("okucode.chat", chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.registerTextDocumentContentProvider(BEFORE_SCHEME, chat),
    vscode.commands.registerCommand("okucode.focusChat", () => vscode.commands.executeCommand("okucode.chat.focus")),
    vscode.commands.registerCommand("okucode.addToChat", () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      void chat.insert(`${editorReference(editor)} `)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("okucode.openTerminal", () => {
      const existing = okuTerminal()
      if (existing) return existing.show()
      openTerminal()
    }),
    vscode.commands.registerCommand("okucode.openNewTerminal", () => {
      openTerminal()
    }),
    vscode.commands.registerCommand("okucode.openChatPanel", () => openChatPanel()),
    vscode.commands.registerCommand("okucode.addFilepathToTerminal", () => {
      const reference = fileReference()
      if (!reference) return
      const terminal = okuTerminal() ?? openTerminal()
      terminal.sendText(`${reference} `, false)
      terminal.show()
    }),
    vscode.commands.registerCommand("okucode.askAboutFile", async (uri?: vscode.Uri) => {
      const reference = uri && !vscode.window.activeTextEditor?.document.uri.fsPath.endsWith(uri.fsPath)
        ? `@${vscode.workspace.asRelativePath(uri)}`
        : fileReference()
      if (!reference) return
      const question = await vscode.window.showInputBox({
        title: "Ask OkuCode",
        prompt: `About ${reference}`,
        placeHolder: "e.g. Explain this code, find bugs, add tests",
      })
      if (!question) return
      await chat.insert(`${reference} ${question}`, true)
    }),
  )
}
