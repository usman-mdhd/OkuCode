// Okutobus (OkuCode): the admin panel page served at /okucode/admin (one self-contained HTML file).
export const ADMIN_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OkuCode Team</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1f2328;--muted:#6b7280;--line:#e5e7eb;--soft:#f1f3f5;--accent:#111;--accent-text:#fff;--ok:#127a3a;--ok-bg:#e7f6ec;--warn:#9a6700;--warn-bg:#fff4d6;--bad:#b42318;--bad-bg:#fdecea}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--text:#e6e8eb;--muted:#9aa3ae;--line:#2a2f39;--soft:#1f232b;--accent:#e6e8eb;--accent-text:#111;--ok:#5fd38a;--ok-bg:#12301f;--warn:#e3b341;--warn-bg:#33290f;--bad:#ff7b72;--bad-bg:#3a1714}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 24px;border-bottom:1px solid var(--line);background:var(--card)}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:16px}
.mark{width:14px;height:18px;border:4px solid var(--text);position:relative}
.mark:after{content:"";position:absolute;inset:4px 0 0;background:var(--muted);opacity:.35}
main{max-width:980px;margin:0 auto;padding:24px 16px 48px}
.tabs{display:flex;gap:4px;margin-bottom:16px}
.tab{border:0;background:none;color:var(--muted);padding:8px 14px;border-radius:8px;font:inherit;cursor:pointer}
.tab.on{background:var(--card);color:var(--text);box-shadow:0 0 0 1px var(--line)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 12px}
p.sub{color:var(--muted);margin:0 0 16px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
textarea{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;width:100%;min-height:180px;resize:vertical}
input,select{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:0}
input:focus,select:focus{outline:2px solid color-mix(in srgb,var(--text) 25%,transparent);outline-offset:1px}
input[type=email]{flex:1 1 240px}
button.primary{background:var(--accent);color:var(--accent-text);border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:500;cursor:pointer}
button.ghost{background:none;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:5px 10px;font:inherit;font-size:13px;cursor:pointer}
button.ghost:hover{background:var(--soft)}
button.danger{color:var(--bad)}
button:disabled{opacity:.5;cursor:default}
label.check{display:flex;align-items:center;gap:6px;color:var(--muted)}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:8px;border-bottom:1px solid var(--line)}
td{padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
tr:last-child td{border-bottom:0}
.person{display:flex;align-items:center;gap:10px;min-width:0}
.avatar{width:30px;height:30px;border-radius:50%;background:var(--soft);display:flex;align-items:center;justify-content:center;font-weight:600;flex:none;overflow:hidden}
.avatar img{width:100%;height:100%}
.email{color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500}
.active{background:var(--ok-bg);color:var(--ok)}.invited{background:var(--warn-bg);color:var(--warn)}.disabled{background:var(--bad-bg);color:var(--bad)}
.actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
.note{padding:10px 12px;border-radius:8px;margin:0 0 12px;display:none}
.note.show{display:block}.note.ok{background:var(--ok-bg);color:var(--ok)}.note.bad{background:var(--bad-bg);color:var(--bad)}
.field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
.field span{font-weight:500}.field small{color:var(--muted)}
.steps{color:var(--muted);margin:0 0 14px;padding-left:18px}.steps li{margin:3px 0}
code{background:var(--soft);padding:1px 6px;border-radius:6px;font-size:12px;overflow-wrap:anywhere}
.status{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px}
.login{max-width:380px;margin:60px auto;text-align:center}
.login .card{text-align:left}
.google{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit;font-weight:500;cursor:pointer;text-decoration:none}
.or{color:var(--muted);text-align:center;margin:14px 0;font-size:12px}
.empty{color:var(--muted);text-align:center;padding:24px}
@media (max-width:700px){.hide-sm{display:none}header{padding:12px 16px}}
</style>
</head>
<body>
<header>
  <div class="brand"><div class="mark"></div>OkuCode Admin</div>
  <div class="row" id="who"></div>
</header>
<main id="app"><p class="empty">Loading…</p></main>
<script>
const app = document.getElementById("app")
const who = document.getElementById("who")
const state = { tab: "users", me: null, users: [], settings: null, policy: null }
const ROLE_NAMES = { admin: "Admin", lead: "Team lead", member: "Member" }
const isAdmin = () => state.me && state.me.role === "admin"
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—")

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status })
  return data
}

function note(text, ok) {
  const box = document.getElementById("note")
  if (!box) return
  box.textContent = text
  box.className = "note show " + (ok ? "ok" : "bad")
  clearTimeout(note.timer)
  note.timer = setTimeout(() => (box.className = "note"), 6000)
}

async function start() {
  try {
    state.me = await api("/okucode/me")
  } catch {
    return showLogin()
  }
  if (state.me.role !== "admin" && state.me.role !== "lead") {
    app.innerHTML = '<div class="login"><div class="card"><h2>Admins and team leads only</h2><p class="sub">You are signed in as ' + esc(state.me.email) + ', but only admins and team leads can open this page.</p><a class="google" href="/">Back to OkuCode</a></div></div>'
    return
  }
  who.innerHTML = '<span class="email">' + esc(state.me.owner ? "Signed in as owner" : state.me.email) + '</span><a class="ghost" style="text-decoration:none;padding:5px 10px;border:1px solid var(--line);border-radius:8px;color:inherit" href="/">Open OkuCode</a><button class="ghost" id="logout">Sign out</button>'
  document.getElementById("logout").onclick = async () => {
    await api("/okucode/auth/logout", { method: "POST" }).catch(() => {})
    location.reload()
  }
  await load()
}

async function load() {
  const [users, settings, policy] = await Promise.all([
    api("/okucode/api/users"),
    isAdmin() ? api("/okucode/api/settings") : Promise.resolve({ googleReady: true, gmailReady: true, leadView: true }),
    api("/okucode/api/policy"),
  ])
  state.users = users.users
  state.settings = settings
  state.policy = policy
  if (state.tab === "setup" && !isAdmin()) state.tab = "users"
  render()
}

async function showLogin() {
  const config = await api("/okucode/auth/config").catch(() => ({}))
  app.innerHTML = '<div class="login"><div class="brand" style="justify-content:center;margin-bottom:16px"><div class="mark"></div>OkuCode Admin</div><div class="card">' +
    (config.google ? '<a class="google" href="/okucode/auth/google">' + googleIcon() + 'Sign in with Google</a><div class="or">or</div>' : "") +
    '<form id="pw"><div class="field"><span>Server password</span><input type="password" id="password" autocomplete="current-password" placeholder="Shown when you run okucode web" required></div><div id="note" class="note"></div><button class="primary" style="width:100%">Sign in</button></form></div></div>'
  document.getElementById("pw").onsubmit = async (event) => {
    event.preventDefault()
    try {
      await api("/okucode/auth/password", { method: "POST", body: JSON.stringify({ password: document.getElementById("password").value }) })
      location.reload()
    } catch (error) {
      note(error.message)
    }
  }
}

function googleIcon() {
  return '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>'
}

function render() {
  const s = state.settings
  app.innerHTML =
    '<h1>Team</h1><p class="sub">Only people added here can sign in to OkuCode with Google.' + (isAdmin() ? "" : " As a team lead you can manage members and the team policy.") + '</p>' +
    '<div class="tabs"><button class="tab ' + (state.tab === "users" ? "on" : "") + '" data-tab="users">Users (' + state.users.length + ')</button>' +
    '<button class="tab ' + (state.tab === "policy" ? "on" : "") + '" data-tab="policy">Policy</button>' +
    (isAdmin() ? '<button class="tab ' + (state.tab === "setup" ? "on" : "") + '" data-tab="setup">Setup</button>' : "") + '</div>' +
    '<div id="note" class="note"></div>' +
    (state.tab === "users" ? usersView(s) : state.tab === "policy" ? policyView(state.policy) : setupView(s))
  app.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; render() }))
  if (state.tab === "users") bindUsers()
  else if (state.tab === "policy") bindPolicy()
  else bindSetup()
}

function usersView(s) {
  const warn = isAdmin() && (!s.googleReady || !s.gmailReady)
    ? '<p class="sub" style="margin:0 0 12px">' + (!s.googleReady ? "Google sign-in is not set up yet. " : "") + (!s.gmailReady ? "Invite emails need Gmail. " : "") + '<a href="#" id="go-setup">Open Setup</a></p>'
    : ""
  const rows = state.users.map((u) => {
    const self = u.email === state.me.email
    // A team lead manages members only.
    const locked = !isAdmin() && u.role !== "member"
    const initial = esc((u.name || u.email).charAt(0).toUpperCase())
    return '<tr data-email="' + esc(u.email) + '">' +
      '<td><div class="person"><div class="avatar">' + (u.picture ? '<img src="' + esc(u.picture) + '" alt="" referrerpolicy="no-referrer">' : initial) + '</div><div style="min-width:0"><div>' + esc(u.name || u.email.split("@")[0]) + (self ? " (you)" : "") + '</div><div class="email">' + esc(u.email) + '</div></div></div></td>' +
      '<td>' + (isAdmin() ? '<select data-act="role" aria-label="Role"' + (self ? " disabled" : "") + '>' + Object.keys(ROLE_NAMES).map((r) => '<option value="' + r + '"' + (u.role === r ? " selected" : "") + '>' + ROLE_NAMES[r] + '</option>').join("") + '</select>' : esc(ROLE_NAMES[u.role] || u.role)) + '</td>' +
      '<td><span class="badge ' + u.status + '">' + ({ active: "Active", invited: "Invited", disabled: "Disabled" })[u.status] + '</span></td>' +
      '<td class="hide-sm">' + when(u.lastLogin) + '</td>' +
      '<td><div class="actions">' +
        (locked ? "" : u.status === "invited" ? '<button class="ghost" data-act="resend"' + (s.gmailReady ? "" : " disabled title=\\"Set up Gmail first\\"") + '>' + (u.invitedAt ? "Resend invite" : "Send invite") + '</button>' : "") +
        (self || locked ? "" : '<button class="ghost" data-act="toggle">' + (u.status === "disabled" ? "Enable" : "Disable") + '</button><button class="ghost danger" data-act="remove">Remove</button>') +
      '</div></td></tr>'
  }).join("")
  return '<div class="card"><h2>Add a user</h2>' + warn +
    '<form id="add" class="row"><input type="email" id="email" placeholder="name@okutobus.com" required aria-label="Email address"><select id="role" aria-label="Role">' + (isAdmin() ? '<option value="member">Member</option><option value="lead">Team lead</option><option value="admin">Admin</option>' : '<option value="member">Member</option>') + '</select>' +
    '<label class="check"><input type="checkbox" id="invite"' + (s.gmailReady ? " checked" : " disabled") + '> Send invite email</label><button class="primary">Add user</button></form></div>' +
    '<div class="card" style="padding:8px 12px"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th class="hide-sm">Last sign-in</th><th></th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="5" class="empty">No users yet. Add the first one above.</td></tr>') + '</tbody></table></div>'
}

function bindUsers() {
  const setup = document.getElementById("go-setup")
  if (setup) setup.onclick = (e) => { e.preventDefault(); state.tab = "setup"; render() }
  document.getElementById("add").onsubmit = async (event) => {
    event.preventDefault()
    const button = event.target.querySelector("button")
    button.disabled = true
    try {
      const result = await api("/okucode/api/users", { method: "POST", body: JSON.stringify({ email: document.getElementById("email").value, role: document.getElementById("role").value, invite: document.getElementById("invite").checked }) })
      await load()
      note(result.warning || (document.getElementById("invite") && result.user.invitedAt ? "Added and invite email sent to " + result.user.email : "Added " + result.user.email + ". They can now sign in with Google."), !result.warning)
    } catch (error) {
      note(error.message)
    } finally {
      button.disabled = false
    }
  }
  app.querySelectorAll("tr[data-email]").forEach((row) => {
    const email = row.dataset.email
    const path = "/okucode/api/users/" + encodeURIComponent(email)
    const act = async (fn, okText) => {
      try { await fn(); await load(); if (okText) note(okText, true) } catch (error) { await load().catch(() => {}); note(error.message) }
    }
    row.querySelectorAll("[data-act]").forEach((el) => {
      const kind = el.dataset.act
      if (kind === "role") el.onchange = () => act(() => api(path, { method: "PATCH", body: JSON.stringify({ role: el.value }) }), email + " is now " + ({ admin: "an admin", lead: "a team lead", member: "a member" })[el.value])
      if (kind === "resend") el.onclick = () => { el.disabled = true; act(() => api(path + "/resend", { method: "POST", body: "{}" }), "Invite email sent to " + email) }
      if (kind === "toggle") el.onclick = () => {
        const disabled = el.textContent === "Disable"
        act(() => api(path, { method: "PATCH", body: JSON.stringify({ disabled }) }), email + (disabled ? " can no longer sign in" : " can sign in again"))
      }
      if (kind === "remove") el.onclick = () => {
        if (el.dataset.sure !== "1") { el.dataset.sure = "1"; el.textContent = "Click again to remove"; return }
        act(() => api(path, { method: "DELETE" }), "Removed " + email)
      }
    })
  })
}

function policyView(p) {
  const modes = [["ask", "Ask every time", "File changes and commands wait for an OK."], ["auto-edit", "Auto-edit", "File changes go ahead; commands still ask."], ["full-auto", "Full-auto", "Changes and commands go ahead (trusted folders only)."]]
  return '<form id="policy"><div class="card"><h2>Team policy</h2><p class="sub">These settings apply to every chat on this OkuCode server, for every user.</p>' +
    '<div class="field"><span>Approval mode</span><select id="approvalMode"><option value=""' + (p.approvalMode ? "" : " selected") + ' disabled>Choose…</option>' + modes.map((m) => '<option value="' + m[0] + '"' + (p.approvalMode === m[0] ? " selected" : "") + '>' + m[1] + ' — ' + m[2] + '</option>').join("") + '</select></div>' +
    '<label class="check" style="margin-bottom:10px"><input type="checkbox" id="autoTest"' + (p.autoTest ? " checked" : "") + '> Run the tests after OkuCode changes code, and fix failures</label>' +
    '<label class="check"><input type="checkbox" id="routing"' + (p.routing ? " checked" : "") + '> Send the first short general question of a new chat to the small model' + (p.smallModel ? ' (<code>' + esc(p.smallModel) + '</code>)' : ' (no small model set up)') + '</label></div>' +
    '<div class="card"><h2>Team rules</h2><p class="sub">OkuCode follows these rules in every chat, on top of each project\\'s own OKUCODE.md. Write one rule per line.</p>' +
    '<textarea id="teamRules" placeholder="- Use TypeScript strict mode.&#10;- Never commit directly to main.&#10;- Write unit tests for new functions.">' + esc(p.teamRules) + '</textarea></div>' +
    '<button class="primary">Save policy</button></form>'
}

function bindPolicy() {
  document.getElementById("policy").onsubmit = async (event) => {
    event.preventDefault()
    const mode = document.getElementById("approvalMode").value
    try {
      await api("/okucode/api/policy", { method: "PUT", body: JSON.stringify({
        ...(mode ? { approvalMode: mode } : {}),
        autoTest: document.getElementById("autoTest").checked,
        routing: document.getElementById("routing").checked,
        teamRules: document.getElementById("teamRules").value,
      }) })
      await load()
      note("Policy saved. It applies to new messages in every chat.", true)
    } catch (error) {
      note(error.message)
    }
  }
}

function setupView(s) {
  return '<div class="card"><h2>Status</h2><div class="status"><span class="badge ' + (s.googleReady ? "active" : "invited") + '">Google sign-in: ' + (s.googleReady ? "ready" : "not set up") + '</span><span class="badge ' + (s.gmailReady ? "active" : "invited") + '">Invite emails: ' + (s.gmailReady ? "ready" : "not set up") + '</span></div></div>' +
  '<form id="setup">' +
  '<div class="card"><h2>OkuCode address</h2><div class="field"><span>Address people open</span><input id="publicUrl" placeholder="' + esc(s.suggestedUrl) + '" value="' + esc(s.publicUrl) + '"><small>Leave empty to use ' + esc(s.suggestedUrl) + '. On a laptop use <code>http://localhost:4096</code>; on the server use its https address.</small></div></div>' +
  '<div class="card"><h2>Google sign-in</h2><ol class="steps">' +
    '<li>Open <code>console.cloud.google.com</code> → APIs &amp; Services → <b>OAuth consent screen</b> and set it up (User type: Internal for company accounts).</li>' +
    '<li>Go to <b>Credentials</b> → Create credentials → <b>OAuth client ID</b> → Application type: <b>Web application</b>.</li>' +
    '<li>Under <b>Authorized redirect URIs</b> add: <code id="cb">' + esc(s.callbackUrl) + '</code></li>' +
    '<li>Copy the Client ID and Client secret here.</li></ol>' +
    '<div class="field"><span>Client ID</span><input id="googleClientId" value="' + esc(s.googleClientId) + '" placeholder="123…apps.googleusercontent.com" autocomplete="off"></div>' +
    '<div class="field"><span>Client secret</span><input id="googleClientSecret" type="password" placeholder="' + (s.googleSecretSaved ? "Saved — leave empty to keep it" : "GOCSPX-…") + '" autocomplete="new-password"></div></div>' +
  '<div class="card"><h2>Invite emails (Gmail)</h2><ol class="steps">' +
    '<li>Sign in to the Gmail account that will send invites (for example a company account).</li>' +
    '<li>Turn on 2-Step Verification, then open <code>myaccount.google.com/apppasswords</code> and create an app password named “OkuCode”.</li>' +
    '<li>Paste the 16-letter app password here (not your normal password).</li></ol>' +
    '<div class="field"><span>Gmail address</span><input id="gmailAddress" type="email" value="' + esc(s.gmailAddress) + '" placeholder="okucode@okutobus.com"></div>' +
    '<div class="field"><span>App password</span><input id="gmailAppPassword" type="password" placeholder="' + (s.gmailPasswordSaved ? "Saved — leave empty to keep it" : "abcd efgh ijkl mnop") + '" autocomplete="new-password"></div>' +
    '<div class="field"><span>Sender name</span><input id="fromName" value="' + esc(s.fromName) + '"></div></div>' +
  '<button class="primary">Save setup</button></form>'
}

function bindSetup() {
  document.getElementById("setup").onsubmit = async (event) => {
    event.preventDefault()
    const value = (id) => document.getElementById(id).value
    try {
      await api("/okucode/api/settings", { method: "PUT", body: JSON.stringify({ publicUrl: value("publicUrl"), googleClientId: value("googleClientId"), googleClientSecret: value("googleClientSecret"), gmailAddress: value("gmailAddress"), gmailAppPassword: value("gmailAppPassword"), fromName: value("fromName") }) })
      await load()
      note("Setup saved.", true)
    } catch (error) {
      note(error.message)
    }
  }
}

start()
</script>
</body>
</html>`
