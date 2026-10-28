// Okutobus (OkuCode) FR-53: the chat panel page (one self-contained webview, VS Code theme colours).
import { randomBytes } from "node:crypto"
import type * as vscode from "vscode"

export function chatHtml(webview: vscode.Webview) {
  const nonce = randomBytes(16).toString("base64")
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;padding:0;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--vscode-panel-border,transparent)}
header .folder{flex:1;min-width:0;opacity:.75;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button{font:inherit;cursor:pointer}
.icon{background:none;border:0;color:var(--vscode-foreground);opacity:.8;padding:3px 6px;border-radius:4px}
.icon:hover{opacity:1;background:var(--vscode-toolbar-hoverBackground)}
#log{flex:1;overflow-y:auto;padding:10px 12px 16px}
.empty{opacity:.7;text-align:center;margin-top:28px;line-height:1.6}
.empty b{display:block;font-size:14px;margin-bottom:4px;opacity:1}
.msg{margin:0 0 12px;line-height:1.5;overflow-wrap:anywhere}
.user{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);border-radius:8px;padding:6px 10px;white-space:pre-wrap}
.text p{margin:0 0 8px}.text p:last-child{margin-bottom:0}
.text ul,.text ol{margin:0 0 8px;padding-left:20px}
.text h1,.text h2,.text h3{font-size:1.05em;margin:10px 0 6px}
pre{background:var(--vscode-textCodeBlock-background);padding:8px 10px;border-radius:6px;overflow-x:auto;margin:6px 0}
code{font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size)}
:not(pre)>code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:4px}
.tool{display:flex;flex-direction:column;gap:4px;margin:0 0 8px;padding:6px 8px;border-left:2px solid var(--vscode-textLink-foreground);background:color-mix(in srgb,var(--vscode-foreground) 5%,transparent);border-radius:0 6px 6px 0;font-size:12px}
.tool.fail{border-left-color:var(--vscode-errorForeground)}
.tool .label{display:flex;gap:6px;align-items:center;font-family:var(--vscode-editor-font-family)}
.tool .state{opacity:.7}
.tool details summary{cursor:pointer;opacity:.75}
.tool details pre{max-height:200px;font-size:11px}
.change{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.change .name{font-family:var(--vscode-editor-font-family)}
.add{color:var(--vscode-gitDecoration-addedResourceForeground,#3fb950)}.del{color:var(--vscode-gitDecoration-deletedResourceForeground,#f85149)}
.link{background:none;border:0;color:var(--vscode-textLink-foreground);padding:0}
.link:hover{text-decoration:underline}
.link:disabled{opacity:.5;cursor:default;text-decoration:none}
.note{font-size:11px;opacity:.7;margin:0 0 10px;font-style:italic}
.error{color:var(--vscode-errorForeground);margin:0 0 10px}
.ask{border:1px solid var(--vscode-focusBorder);border-radius:8px;padding:8px 10px;margin:0 0 12px}
.ask .what{margin:4px 0 8px;font-family:var(--vscode-editor-font-family);white-space:pre-wrap;overflow-wrap:anywhere}
.ask .row{display:flex;gap:6px;flex-wrap:wrap}
.btn{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;border-radius:4px;padding:4px 10px}
.btn:hover{background:var(--vscode-button-hoverBackground)}
.btn.second{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn.second:hover{background:var(--vscode-button-secondaryHoverBackground)}
.answered{opacity:.7;font-size:12px}
.thinking{opacity:.7;font-size:12px;margin:0 0 10px}
.thinking:after{content:"…";animation:dots 1.2s steps(3,end) infinite}
@keyframes dots{0%{content:""}33%{content:"."}66%{content:".."}100%{content:"…"}}
footer{border-top:1px solid var(--vscode-panel-border,transparent);padding:8px 10px 10px}
.box{border:1px solid var(--vscode-input-border,var(--vscode-panel-border));background:var(--vscode-input-background);border-radius:8px;padding:6px 8px}
.box:focus-within{border-color:var(--vscode-focusBorder)}
textarea{width:100%;border:0;outline:0;resize:none;background:transparent;color:var(--vscode-input-foreground);font:inherit;min-height:40px;max-height:200px}
.bar{display:flex;align-items:center;gap:6px;margin-top:4px}
.bar .hint{flex:1;font-size:11px;opacity:.6}
</style>
</head>
<body>
<header>
  <span class="folder" id="folder">OkuCode</span>
  <button class="icon" id="new" title="New chat">＋ New chat</button>
</header>
<div id="log"><div class="empty" id="empty"><b>OkuCode</b>Ask about your code, or tell OkuCode what to build or fix.<br>Use <code>@file</code> to point at a file.</div></div>
<footer>
  <div class="box">
    <textarea id="input" rows="2" placeholder="Ask OkuCode… (Enter to send, Shift+Enter for a new line)"></textarea>
    <div class="bar">
      <button class="icon" id="addFile" title="Add the open file (and selected lines)">@ Add file</button>
      <span class="hint" id="hint"></span>
      <button class="btn" id="send">Send</button>
    </div>
  </div>
</footer>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi()
const log = document.getElementById("log")
const input = document.getElementById("input")
const sendButton = document.getElementById("send")
const hint = document.getElementById("hint")
let busy = false
const texts = new Map()
const tools = new Map()

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

// Small Markdown: code blocks, inline code, bold, headings, lists, paragraphs.
function markdown(source) {
  const blocks = []
  let text = String(source ?? "").replace(/\`\`\`[^\\n]*\\n([\\s\\S]*?)(\`\`\`|$)/g, (_, code) => {
    blocks.push('<pre><code>' + esc(code.replace(/\\n$/, "")) + '</code></pre>')
    return "\\u0000" + (blocks.length - 1) + "\\u0000"
  })
  const inline = (line) => esc(line)
    .replace(/\`([^\`]+)\`/g, "<code>$1</code>")
    .replace(/\\*\\*([^*]+)\\*\\*/g, "<b>$1</b>")
  const out = []
  let list = null
  for (const raw of text.split("\\n")) {
    const line = raw.trimEnd()
    const block = /^\\u0000(\\d+)\\u0000$/.exec(line.trim())
    const bullet = /^\\s*(?:[-*]|\\d+[.)])\\s+(.*)$/.exec(line)
    if (bullet) {
      const ordered = /^\\s*\\d/.test(line)
      if (!list || list.ordered !== ordered) { if (list) out.push(list.ordered ? "</ol>" : "</ul>"); list = { ordered }; out.push(ordered ? "<ol>" : "<ul>") }
      out.push("<li>" + inline(bullet[1]) + "</li>")
      continue
    }
    if (list) { out.push(list.ordered ? "</ol>" : "</ul>"); list = null }
    if (block) { out.push(blocks[Number(block[1])]); continue }
    const heading = /^(#{1,3})\\s+(.*)$/.exec(line)
    if (heading) { out.push("<h3>" + inline(heading[2]) + "</h3>"); continue }
    if (!line.trim()) { out.push(""); continue }
    out.push("<p>" + inline(line) + "</p>")
  }
  if (list) out.push(list.ordered ? "</ol>" : "</ul>")
  return out.join("").replace(/\\u0000(\\d+)\\u0000/g, (_, i) => blocks[Number(i)])
}

function add(html, className) {
  document.getElementById("empty")?.remove()
  const element = document.createElement("div")
  element.className = className
  element.innerHTML = html
  log.appendChild(element)
  scroll()
  return element
}
function scroll() { log.scrollTop = log.scrollHeight }

function setBusy(value) {
  busy = value
  sendButton.textContent = busy ? "Stop" : "Send"
  sendButton.className = busy ? "btn second" : "btn"
  document.getElementById("thinking")?.remove()
  if (busy) { const t = add("OkuCode is working", "thinking"); t.id = "thinking" }
  hint.textContent = ""
}
function keepThinkingLast() {
  const t = document.getElementById("thinking")
  if (t) log.appendChild(t)
  scroll()
}

function textPart(id, value, replace) {
  let element = texts.get(id)
  if (!element) { element = add("", "msg text"); element.dataset.raw = ""; texts.set(id, element) }
  element.dataset.raw = replace ? value : element.dataset.raw + value
  element.innerHTML = markdown(element.dataset.raw)
  keepThinkingLast()
}

function toolRow(id, label) {
  const element = add('<div class="label"><span>' + esc(label) + '</span><span class="state">running…</span></div>', "tool")
  tools.set(id, element)
  keepThinkingLast()
}

function toolDone(message) {
  let element = tools.get(message.id)
  if (!element) { toolRow(message.id, "Tool"); element = tools.get(message.id) }
  element.classList.toggle("fail", !message.ok)
  element.querySelector(".state").textContent = message.ok ? "done" : "failed"
  for (const change of message.changes || []) {
    const row = document.createElement("div")
    row.className = "change"
    row.innerHTML = '<span class="name">' + esc(change.file) + '</span>' +
      (change.created ? '<span class="add">new file</span>' : '<span class="add">+' + change.additions + '</span><span class="del">−' + change.deletions + '</span>') +
      '<button class="link" data-diff="' + esc(change.id) + '">View diff</button>' +
      '<button class="link" data-undo="' + esc(change.id) + '">Undo</button>'
    element.appendChild(row)
  }
  if (message.output && !(message.changes || []).length) {
    const details = document.createElement("details")
    details.innerHTML = '<summary>Output</summary><pre><code>' + esc(message.output) + '</code></pre>'
    element.appendChild(details)
  }
  keepThinkingLast()
}

function permission(message) {
  const what = (message.resources || []).join("\\n") || message.action
  const label = message.action === "shell" || message.action === "bash" ? "OkuCode wants to run:" : message.action === "edit" ? "OkuCode wants to change:" : "OkuCode wants to use " + esc(message.action) + ":"
  const element = add('<div>' + label + '</div><div class="what">' + esc(what) + '</div><div class="row">' +
    '<button class="btn" data-reply="once">Allow once</button><button class="btn second" data-reply="always">Always allow</button><button class="btn second" data-reply="reject">Deny</button></div>', "ask")
  element.id = "perm-" + message.id
  element.querySelectorAll("[data-reply]").forEach((button) => button.onclick = () => {
    vscode.postMessage({ type: "permission", id: message.id, sessionID: message.sessionID, decision: button.dataset.reply })
    element.querySelector(".row").innerHTML = '<span class="answered">Sending…</span>'
  })
  keepThinkingLast()
}

log.addEventListener("click", (event) => {
  const target = event.target.closest("button")
  if (!target) return
  if (target.dataset.diff) vscode.postMessage({ type: "diff", id: target.dataset.diff })
  if (target.dataset.undo) vscode.postMessage({ type: "undo", id: target.dataset.undo })
})

function send() {
  if (busy) return vscode.postMessage({ type: "stop" })
  const text = input.value.trim()
  if (!text) return
  input.value = ""
  vscode.postMessage({ type: "send", text })
}
sendButton.onclick = send
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() }
})
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 200) + "px" })
document.getElementById("new").onclick = () => vscode.postMessage({ type: "new" })
document.getElementById("addFile").onclick = () => vscode.postMessage({ type: "addFile" })

window.addEventListener("message", ({ data: message }) => {
  switch (message.type) {
    case "folder": document.getElementById("folder").textContent = "OkuCode · " + message.name; break
    case "status": hint.textContent = message.text; break
    case "user": add(esc(message.text), "msg user"); keepThinkingLast(); break
    case "busy": setBusy(message.busy); break
    case "delta": textPart(message.id, message.delta, false); break
    case "text": textPart(message.id, message.text, true); break
    case "note": add(esc(message.text), "note"); keepThinkingLast(); break
    case "tool": toolRow(message.id, message.label); break
    case "toolDone": toolDone(message); break
    case "permission": permission(message); break
    case "permissionDone": {
      const element = document.getElementById("perm-" + message.id)
      if (element) element.querySelector(".row").innerHTML = '<span class="answered">' + ({ once: "Allowed once", always: "Always allowed", reject: "Denied" })[message.reply] + '</span>'
      break
    }
    case "undone": {
      const button = log.querySelector('[data-undo="' + CSS.escape(message.id) + '"]')
      if (button) { button.textContent = "Undone"; button.disabled = true }
      break
    }
    case "error": add(esc(message.text), "error"); hint.textContent = ""; break
    case "cleared":
      texts.clear(); tools.clear(); setBusy(false)
      log.innerHTML = '<div class="empty" id="empty"><b>New chat</b>Ask about your code, or tell OkuCode what to build or fix.</div>'
      break
    case "history":
      for (const item of message.messages) {
        if (item.role === "user") add(esc(item.text), "msg user")
        else if (item.role === "note") add(esc(item.text), "note")
        else for (const part of item.parts) {
          if (part.kind === "text") add(markdown(part.text), "msg text")
          else add('<div class="label"><span>' + esc(part.label) + '</span><span class="state">' + (part.ok ? "done" : "failed") + '</span></div>', part.ok ? "tool" : "tool fail")
        }
      }
      break
    case "insert":
      input.value = (input.value && !input.value.endsWith(" ") ? input.value + " " : input.value) + message.text
      input.focus()
      if (message.send) send()
      break
  }
})
vscode.postMessage({ type: "ready" })
</script>
</body>
</html>`
}
