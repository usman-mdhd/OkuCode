// Okutobus (OkuCode): team sign-in and the admin panel.
//
// - Google sign-in: only emails an admin added (or invited) can sign in. A successful sign-in sets the server's normal
//   session cookie (the same one pairing links use) plus an `okucode_user` cookie that says who is signed in.
// - Every request that relies on the session cookie must also carry the `okucode_user` cookie of an active user, so
//   disabling or removing someone signs them out at once. Password (Basic) access for the owner is unchanged.
// - Admin API under /okucode/api, admin page at /okucode/admin, invite emails through Gmail.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { Option } from "effect"
import { ServerAuth } from "@opencode/server/auth"
import { ADMIN_PAGE } from "./admin-page"
import { activeAdmins, isRole, normalize, validEmail, type ApiKey, type Role, type Settings, type Store, type User } from "./accounts-store"
import { send } from "./smtp"
import { readFileSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import nodePath from "node:path"
import { AuditChain } from "@opencode/util/audit-chain"
import { UsageLog } from "@opencode/util/usage-log"

export type Request = {
  method: string
  url: URL
  headers: Record<string, string | undefined>
  cookies: Record<string, string>
  body?: () => Promise<string>
}

export type Response = { status: number; headers?: Record<string, string>; cookies?: string[]; body?: string }

const USER_COOKIE = "okucode_user"
const STATE_COOKIE = "okucode_oauth"
const USER_TTL = ServerAuth.SESSION_TTL_SECONDS
const OWNER = "owner"

const GOOGLE = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
}
// FR-56: GitHub sign-in (OAuth app). The person's verified primary email must be one an admin added.
const GITHUB = {
  auth: "https://github.com/login/oauth/authorize",
  token: "https://github.com/login/oauth/access_token",
  user: "https://api.github.com/user",
  emails: "https://api.github.com/user/emails",
}
// FR-56: Microsoft sign-in (Microsoft Entra ID / Microsoft 365 work accounts, and personal Microsoft accounts with
// the "common" tenant). The account's email must be one an admin added.
const MICROSOFT = {
  auth: (tenant: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
  token: (tenant: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
  me: "https://graph.microsoft.com/v1.0/me",
}

const json = (status: number, value: unknown, cookies?: string[]): Response => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(value),
  cookies,
})
const redirect = (location: string, cookies?: string[]): Response => ({
  status: 302,
  headers: { location, "cache-control": "no-store" },
  cookies,
})

function cookie(name: string, value: string, maxAge: number, secure: boolean) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)

export function createAccounts(input: {
  store: Store
  password: string
  fetch?: typeof fetch
  sendMail?: typeof send
  now?: () => number
}) {
  const { store } = input
  const http = input.fetch ?? fetch
  const mail = input.sendMail ?? send
  const now = input.now ?? Date.now
  const auth: ServerAuth.Info = { password: Option.some(input.password), username: "opencode" }

  const sign = (payload: string) => createHmac("sha256", store.secret()).update(payload).digest("base64url")
  const same = (a: string, b: string) => {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    return left.length === right.length && timingSafeEqual(left, right)
  }

  function userToken(email: string) {
    const expires = String(Math.floor(now() / 1000) + USER_TTL)
    const id = Buffer.from(email).toString("base64url")
    return `${id}.${expires}.${sign(`${id}.${expires}`)}`
  }

  /** Who is signed in through the okucode_user cookie, if anyone (and still allowed). */
  function cookieUser(request: Request): (User & { owner?: boolean }) | undefined {
    const token = request.cookies[USER_COOKIE]
    if (!token) return
    const [id, expires, signature] = token.split(".")
    if (!id || !expires || !signature || !same(signature, sign(`${id}.${expires}`))) return
    if (Number(expires) * 1000 <= now()) return
    const email = Buffer.from(id, "base64url").toString()
    if (email === OWNER) return ownerUser()
    const user = store.get(email)
    return user && user.status === "active" ? user : undefined
  }

  function ownerUser(): User & { owner: true } {
    return { email: OWNER, name: "Owner", role: "admin", status: "active", addedAt: 0, owner: true }
  }

  function basicOwner(request: Request) {
    const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
    if (!match) return false
    const decoded = Buffer.from(match[1]!, "base64").toString()
    const separator = decoded.indexOf(":")
    return separator > 0 && decoded.slice(separator + 1) === input.password
  }

  // ---- API keys (FR-56) ----

  // FR-25: the Docker sandbox needs Docker running and the image built (okucode sandbox-image).
  type Sandbox = "auto" | "docker" | "on" | "off"
  const SANDBOXES: Sandbox[] = ["auto", "docker", "on", "off"]
  const dockerReady = (image: string) => {
    try {
      return spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", image], { timeout: 5_000 }).status === 0
    } catch {
      return false
    }
  }

  const KEY = /^Bearer\s+(oku_[A-Za-z0-9_-]{20,})$/i
  const keyHash = (key: string) => createHash("sha256").update(key).digest("hex")
  let lastUsedSaved = 0

  /** The person a "Authorization: Bearer oku_…" key belongs to, when the key and the person are valid. */
  function keyUser(request: Request): User | undefined {
    const match = KEY.exec(request.headers.authorization ?? "")
    if (!match) return undefined
    const hash = keyHash(match[1]!)
    const keys = store.keys()
    const key = keys.find((item) => same(item.hash, hash))
    if (!key) return undefined
    const user = key.email === OWNER ? ownerUser() : store.get(key.email)
    if (!user || user.status === "disabled") return undefined
    // Note when a key was last used, at most once a minute.
    if (now() - lastUsedSaved > 60_000 || !key.lastUsed) {
      lastUsedSaved = now()
      key.lastUsed = now()
      store.saveKeys(keys)
    }
    return user
  }

  function currentUser(request: Request) {
    return basicOwner(request) ? ownerUser() : (keyUser(request) ?? cookieUser(request))
  }

  const keyView = (key: ApiKey) => ({
    id: key.id,
    name: key.name,
    email: key.email,
    prefix: key.prefix,
    createdAt: key.createdAt,
    createdBy: key.createdBy,
    lastUsed: key.lastUsed,
  })

  function settings() {
    const value = store.settings()
    return value
  }

  function publicUrl(request: Request) {
    const configured = settings().publicUrl?.replace(/\/+$/, "")
    if (configured) return configured
    return `${request.url.protocol}//${request.headers.host ?? request.url.host}`
  }

  const secure = (request: Request) => publicUrl(request).startsWith("https:")
  const googleReady = (value: Settings = settings()) => !!(value.google?.clientId && value.google?.clientSecret)
  const githubReady = (value: Settings = settings()) => !!(value.github?.clientId && value.github?.clientSecret)
  const microsoftReady = (value: Settings = settings()) => !!(value.microsoft?.clientId && value.microsoft?.clientSecret)
  const microsoftTenant = (value: Settings = settings()) => value.microsoft?.tenant?.trim() || "common"
  const gmailReady = (value: Settings = settings()) => !!(value.gmail?.address && value.gmail?.appPassword)

  function signInCookies(request: Request, email: string) {
    const session = ServerAuth.issueSession(auth, now())!
    return [
      cookie(ServerAuth.sessionCookieName(request.headers.host), session, USER_TTL, secure(request)),
      cookie(USER_COOKIE, userToken(email), USER_TTL, secure(request)),
    ]
  }

  function signOutCookies(request: Request) {
    return [
      cookie(ServerAuth.sessionCookieName(request.headers.host), "", 0, secure(request)),
      cookie(USER_COOKIE, "", 0, secure(request)),
    ]
  }

  // Changes must come from this page (not another site) and be JSON.
  function sameOrigin(request: Request) {
    const origin = request.headers.origin
    if (origin && URL.parse(origin)?.host !== request.headers.host) return false
    return (request.headers["content-type"] ?? "").includes("application/json")
  }

  async function body<T>(request: Request): Promise<T> {
    try {
      return JSON.parse((await request.body?.()) || "{}") as T
    } catch {
      return {} as T
    }
  }

  function publicView(user: User) {
    return {
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      status: user.status,
      addedAt: user.addedAt,
      addedBy: user.addedBy,
      invitedAt: user.invitedAt,
      lastLogin: user.lastLogin,
    }
  }

  async function sendInvite(request: Request, user: User, by: string) {
    const config = settings()
    if (!gmailReady(config)) throw new Error("Set up Gmail in the Setup tab to send invite emails.")
    const link = publicUrl(request)
    const inviter = by === OWNER ? "The OkuCode admin" : by
    const providers = [
      googleReady(config) ? "Google" : undefined,
      githubReady(config) ? "GitHub" : undefined,
      microsoftReady(config) ? "Microsoft" : undefined,
    ].filter((item): item is string => !!item)
    if (providers.length === 0) providers.push("Google")
    const how = providers.length > 1 ? `${providers.slice(0, -1).join(", ")} or ${providers.at(-1)}` : providers[0]!
    const text = [
      `Hi,`,
      ``,
      `${inviter} invited you to OkuCode, the Okutobus AI coding assistant.`,
      ``,
      `Open ${link} and choose ${providers.map((item) => `"Continue with ${item}"`).join(" or ")} using this email address (${user.email}).`,
      ``,
      `OkuCode`,
    ].join("\n")
    const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2328;background:#f6f7f9;padding:24px">
<div style="max-width:480px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
<h2 style="margin:0 0 12px;font-size:20px">You're invited to OkuCode</h2>
<p style="line-height:1.5">${escapeHtml(inviter)} invited you to <b>OkuCode</b>, the Okutobus AI coding assistant.</p>
<p style="line-height:1.5">Sign in with your ${how} account <b>${escapeHtml(user.email)}</b>.</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">Open OkuCode</a></p>
<p style="color:#6b7280;font-size:12px">If the button doesn't work, open ${escapeHtml(link)}</p>
</div></body></html>`
    await mail({
      host: config.smtp?.host ?? "smtp.gmail.com",
      port: config.smtp?.port ?? 465,
      insecure: config.smtp?.insecure,
      user: config.gmail!.address!,
      pass: config.gmail!.appPassword!.replace(/\s+/g, ""),
      from: config.gmail!.address!,
      fromName: config.gmail!.fromName || "OkuCode",
      to: user.email,
      subject: "You're invited to OkuCode",
      text,
      html,
    })
    store.update(user.email, (item) => {
      item.invitedAt = now()
    })
  }

  // ---- Google sign-in ----

  function googleStart(request: Request): Response {
    const config = settings()
    if (!googleReady(config)) return redirect("/?okucode_error=google_not_set_up")
    // Google sends the user back to one fixed address, so start from it (cookies are per host).
    const base = publicUrl(request)
    const here = `${request.url.protocol}//${request.headers.host ?? request.url.host}`
    if (URL.parse(base)?.host !== URL.parse(here)?.host) return redirect(`${base}/okucode/auth/google`)
    const state = randomBytes(16).toString("base64url")
    const url = new URL(config.googleEndpoints?.auth ?? GOOGLE.auth)
    url.searchParams.set("client_id", config.google!.clientId!)
    url.searchParams.set("redirect_uri", `${base}/okucode/auth/google/callback`)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", "openid email profile")
    url.searchParams.set("state", state)
    url.searchParams.set("prompt", "select_account")
    return redirect(url.href, [cookie(STATE_COOKIE, `${state}.${sign(state)}`, 600, secure(request))])
  }

  async function googleCallback(request: Request): Promise<Response> {
    const fail = (code: string, extra?: string) =>
      redirect(`/?okucode_error=${code}${extra ? `&email=${encodeURIComponent(extra)}` : ""}`, [
        cookie(STATE_COOKIE, "", 0, secure(request)),
      ])
    const config = settings()
    if (!googleReady(config)) return fail("google_not_set_up")
    const state = request.url.searchParams.get("state") ?? ""
    const [saved, signature] = (request.cookies[STATE_COOKIE] ?? "").split(".")
    if (!state || !saved || !signature || saved !== state || !same(signature, sign(saved))) return fail("try_again")
    const code = request.url.searchParams.get("code")
    if (!code) return fail("cancelled")
    try {
      const token = await http(config.googleEndpoints?.token ?? GOOGLE.token, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.google!.clientId!,
          client_secret: config.google!.clientSecret!,
          redirect_uri: `${publicUrl(request)}/okucode/auth/google/callback`,
          grant_type: "authorization_code",
        }),
      })
      if (!token.ok) return fail("google_failed")
      const { access_token } = (await token.json()) as { access_token?: string }
      if (!access_token) return fail("google_failed")
      const info = await http(config.googleEndpoints?.userinfo ?? GOOGLE.userinfo, {
        headers: { authorization: `Bearer ${access_token}` },
      })
      if (!info.ok) return fail("google_failed")
      const profile = (await info.json()) as { email?: string; email_verified?: boolean; name?: string; picture?: string }
      if (!profile.email || profile.email_verified === false) return fail("google_failed")
      const email = normalize(profile.email)
      const user = store.get(email)
      if (!user) return fail("not_invited", email)
      if (user.status === "disabled") return fail("disabled", email)
      store.update(email, (item) => {
        item.status = "active"
        item.name = profile.name ?? item.name
        item.picture = profile.picture ?? item.picture
        item.lastLogin = now()
      })
      return redirect("/", [...signInCookies(request, email), cookie(STATE_COOKIE, "", 0, secure(request))])
    } catch {
      return fail("google_failed")
    }
  }

  // ---- GitHub sign-in (FR-56) ----

  function githubStart(request: Request): Response {
    const config = settings()
    if (!githubReady(config)) return redirect("/?okucode_error=github_not_set_up")
    const base = publicUrl(request)
    const here = `${request.url.protocol}//${request.headers.host ?? request.url.host}`
    if (URL.parse(base)?.host !== URL.parse(here)?.host) return redirect(`${base}/okucode/auth/github`)
    const state = randomBytes(16).toString("base64url")
    const url = new URL(config.githubEndpoints?.auth ?? GITHUB.auth)
    url.searchParams.set("client_id", config.github!.clientId!)
    url.searchParams.set("redirect_uri", `${base}/okucode/auth/github/callback`)
    url.searchParams.set("scope", "read:user user:email")
    url.searchParams.set("state", state)
    url.searchParams.set("allow_signup", "false")
    return redirect(url.href, [cookie(STATE_COOKIE, `${state}.${sign(state)}`, 600, secure(request))])
  }

  async function githubCallback(request: Request): Promise<Response> {
    const fail = (code: string, extra?: string) =>
      redirect(`/?okucode_error=${code}${extra ? `&email=${encodeURIComponent(extra)}` : ""}`, [
        cookie(STATE_COOKIE, "", 0, secure(request)),
      ])
    const config = settings()
    if (!githubReady(config)) return fail("github_not_set_up")
    const state = request.url.searchParams.get("state") ?? ""
    const [saved, signature] = (request.cookies[STATE_COOKIE] ?? "").split(".")
    if (!state || !saved || !signature || saved !== state || !same(signature, sign(saved))) return fail("try_again")
    const code = request.url.searchParams.get("code")
    if (!code) return fail("cancelled")
    try {
      const token = await http(config.githubEndpoints?.token ?? GITHUB.token, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          code,
          client_id: config.github!.clientId!,
          client_secret: config.github!.clientSecret!,
          redirect_uri: `${publicUrl(request)}/okucode/auth/github/callback`,
        }),
      })
      if (!token.ok) return fail("github_failed")
      const { access_token } = (await token.json()) as { access_token?: string }
      if (!access_token) return fail("github_failed")
      const headers = {
        authorization: `Bearer ${access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "OkuCode",
      }
      const emails = await http(config.githubEndpoints?.emails ?? GITHUB.emails, { headers })
      if (!emails.ok) return fail("github_failed")
      const list = (await emails.json()) as { email?: string; primary?: boolean; verified?: boolean }[]
      const verified = list.filter((item) => item.email && item.verified)
      // The primary email first, then any other verified email an admin added.
      const candidates = [...verified.filter((item) => item.primary), ...verified.filter((item) => !item.primary)].map(
        (item) => normalize(item.email!),
      )
      if (candidates.length === 0) return fail("github_failed")
      const email = candidates.find((item) => store.get(item)) ?? candidates[0]!
      const user = store.get(email)
      if (!user) return fail("not_invited", email)
      if (user.status === "disabled") return fail("disabled", email)
      type Profile = { name?: string; login?: string; avatar_url?: string }
      const profile: Profile = await http(config.githubEndpoints?.user ?? GITHUB.user, { headers })
        .then((response) => (response.ok ? (response.json() as Promise<Profile>) : {}))
        .catch(() => ({}))
      store.update(email, (item) => {
        item.status = "active"
        item.name = profile.name ?? profile.login ?? item.name
        item.picture = profile.avatar_url ?? item.picture
        item.lastLogin = now()
      })
      return redirect("/", [...signInCookies(request, email), cookie(STATE_COOKIE, "", 0, secure(request))])
    } catch {
      return fail("github_failed")
    }
  }

  // ---- Microsoft sign-in (FR-56) ----

  function microsoftStart(request: Request): Response {
    const config = settings()
    if (!microsoftReady(config)) return redirect("/?okucode_error=microsoft_not_set_up")
    const base = publicUrl(request)
    const here = `${request.url.protocol}//${request.headers.host ?? request.url.host}`
    if (URL.parse(base)?.host !== URL.parse(here)?.host) return redirect(`${base}/okucode/auth/microsoft`)
    const state = randomBytes(16).toString("base64url")
    const url = new URL(config.microsoftEndpoints?.auth ?? MICROSOFT.auth(microsoftTenant(config)))
    url.searchParams.set("client_id", config.microsoft!.clientId!)
    url.searchParams.set("redirect_uri", `${base}/okucode/auth/microsoft/callback`)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("response_mode", "query")
    url.searchParams.set("scope", "openid email profile User.Read")
    url.searchParams.set("state", state)
    url.searchParams.set("prompt", "select_account")
    return redirect(url.href, [cookie(STATE_COOKIE, `${state}.${sign(state)}`, 600, secure(request))])
  }

  async function microsoftCallback(request: Request): Promise<Response> {
    const fail = (code: string, extra?: string) =>
      redirect(`/?okucode_error=${code}${extra ? `&email=${encodeURIComponent(extra)}` : ""}`, [
        cookie(STATE_COOKIE, "", 0, secure(request)),
      ])
    const config = settings()
    if (!microsoftReady(config)) return fail("microsoft_not_set_up")
    const state = request.url.searchParams.get("state") ?? ""
    const [saved, signature] = (request.cookies[STATE_COOKIE] ?? "").split(".")
    if (!state || !saved || !signature || saved !== state || !same(signature, sign(saved))) return fail("try_again")
    const code = request.url.searchParams.get("code")
    if (!code) return fail("cancelled")
    try {
      const token = await http(config.microsoftEndpoints?.token ?? MICROSOFT.token(microsoftTenant(config)), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.microsoft!.clientId!,
          client_secret: config.microsoft!.clientSecret!,
          redirect_uri: `${publicUrl(request)}/okucode/auth/microsoft/callback`,
          grant_type: "authorization_code",
          scope: "openid email profile User.Read",
        }),
      })
      if (!token.ok) return fail("microsoft_failed")
      const { access_token } = (await token.json()) as { access_token?: string }
      if (!access_token) return fail("microsoft_failed")
      const me = await http(config.microsoftEndpoints?.me ?? MICROSOFT.me, {
        headers: { authorization: `Bearer ${access_token}` },
      })
      if (!me.ok) return fail("microsoft_failed")
      const profile = (await me.json()) as { mail?: string | null; userPrincipalName?: string; displayName?: string }
      // Work accounts: "mail"; accounts without a mailbox: the sign-in name, when it is an email address.
      const candidates = [profile.mail, profile.userPrincipalName]
        .filter((item): item is string => !!item && validEmail(item) && !item.includes("#EXT#"))
        .map(normalize)
      if (candidates.length === 0) return fail("microsoft_failed")
      const email = candidates.find((item) => store.get(item)) ?? candidates[0]!
      const user = store.get(email)
      if (!user) return fail("not_invited", email)
      if (user.status === "disabled") return fail("disabled", email)
      store.update(email, (item) => {
        item.status = "active"
        item.name = profile.displayName ?? item.name
        item.lastLogin = now()
      })
      return redirect("/", [...signInCookies(request, email), cookie(STATE_COOKIE, "", 0, secure(request))])
    } catch {
      return fail("microsoft_failed")
    }
  }

  // ---- admin API ----

  async function admin(request: Request, me: User, path: string): Promise<Response> {
    const by = me.email
    // FR-57: leads manage members and the team policy; admins manage everything.
    const isAdmin = me.role === "admin"
    const adminOnly = () => json(403, { error: "Only admins can do this." })
    if (path === "/okucode/api/users" && request.method === "GET")
      return json(200, { users: store.list().map(publicView), me: by })

    // FR-22: approval mode (Ask every time / Auto-edit / Full-auto), used by every chat on this server.
    if (path === "/okucode/api/approval" && request.method === "GET")
      return json(200, { mode: settings().approvalMode ?? null })

    // FR-57: the team policy that applies to every chat on this server.
    if (path === "/okucode/api/policy" && request.method === "GET") {
      const value = settings()
      return json(200, {
        approvalMode: value.approvalMode ?? null,
        autoTest: value.autoTest !== false,
        routing: value.routing === true,
        smallModel: value.smallModel ?? null,
        teamRules: store.teamRules(),
        sandbox: SANDBOXES.includes(value.sandbox as Sandbox) ? value.sandbox : "auto",
        sandboxImage: value.sandboxImage || "okucode-sandbox",
        dockerReady: dockerReady(value.sandboxImage || "okucode-sandbox"),
      })
    }

    // Skills switched off in Settings → Extensions → Skills.
    if (path === "/okucode/api/skills" && request.method === "GET")
      return json(200, { disabled: settings().disabledSkills ?? [] })

    // FR-56: API keys. Admins see and make keys for anyone; team leads for themselves and members.
    if (path === "/okucode/api/keys" && request.method === "GET") {
      const visible = store.keys().filter((key) => isAdmin || key.email === by || store.get(key.email)?.role === "member")
      return json(200, { keys: visible.map(keyView) })
    }

    // FR-60: the audit log. Admins see whether the hash chain is intact and download a day's log.
    if (path === "/okucode/api/audit" && request.method === "GET") {
      if (!isAdmin) return adminOnly()
      const value = settings()
      const dir = AuditChain.directory()
      return json(200, {
        enabled: value.audit !== false,
        retentionDays: typeof value.auditRetentionDays === "number" ? value.auditRetentionDays : 90,
        folder: dir,
        check: AuditChain.verify(dir),
        days: AuditChain.files(dir)
          .slice(-30)
          .reverse()
          .map((name) => {
            let bytes = 0
            try {
              bytes = statSync(nodePath.join(dir, name)).size
            } catch {}
            return { date: name.slice(0, 10), bytes }
          }),
      })
    }
    if (path === "/okucode/api/audit/download" && request.method === "GET") {
      if (!isAdmin) return adminOnly()
      const date = request.url.searchParams.get("date") ?? ""
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { error: "Give a date like 2026-11-03." })
      try {
        return {
          status: 200,
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "content-disposition": `attachment; filename="okucode-audit-${date}.jsonl"`,
            "cache-control": "no-store",
          },
          body: readFileSync(nodePath.join(AuditChain.directory(), `${date}.jsonl`), "utf8"),
        }
      } catch {
        return json(404, { error: "No audit log for that day." })
      }
    }

    // FR-58: usage per person, model and day (admins and team leads).
    if (path === "/okucode/api/usage" && request.method === "GET") {
      const days = Math.min(Math.max(Number(request.url.searchParams.get("days")) || 30, 1), 366)
      const from = new Date(Date.now() - days * 86_400_000).toISOString()
      const configured = settings().usagePrice ?? {}
      const price = {
        input: typeof configured.input === "number" ? configured.input : UsageLog.DEFAULT_PRICE.input,
        output: typeof configured.output === "number" ? configured.output : UsageLog.DEFAULT_PRICE.output,
        cacheRead: typeof configured.cacheRead === "number" ? configured.cacheRead : UsageLog.DEFAULT_PRICE.cacheRead,
      }
      return json(200, {
        days,
        price,
        enabled: settings().usage !== false,
        ...UsageLog.summarize(UsageLog.read(from), store.sessionUsers(), price),
      })
    }

    if (path === "/okucode/api/settings" && request.method === "GET") {
      if (!isAdmin) return adminOnly()
      const value = settings()
      return json(200, {
        publicUrl: value.publicUrl ?? "",
        suggestedUrl: publicUrl(request),
        callbackUrl: `${publicUrl(request)}/okucode/auth/google/callback`,
        googleClientId: value.google?.clientId ?? "",
        googleSecretSaved: !!value.google?.clientSecret,
        gmailAddress: value.gmail?.address ?? "",
        gmailPasswordSaved: !!value.gmail?.appPassword,
        fromName: value.gmail?.fromName ?? "OkuCode",
        googleReady: googleReady(value),
        githubClientId: value.github?.clientId ?? "",
        githubSecretSaved: !!value.github?.clientSecret,
        githubCallbackUrl: `${publicUrl(request)}/okucode/auth/github/callback`,
        githubReady: githubReady(value),
        microsoftClientId: value.microsoft?.clientId ?? "",
        microsoftSecretSaved: !!value.microsoft?.clientSecret,
        microsoftTenant: value.microsoft?.tenant ?? "",
        microsoftCallbackUrl: `${publicUrl(request)}/okucode/auth/microsoft/callback`,
        microsoftReady: microsoftReady(value),
        gmailReady: gmailReady(value),
      })
    }

    if (!sameOrigin(request)) return json(403, { error: "Request blocked." })

    if (path === "/okucode/api/approval" && request.method === "PUT") {
      const next = await body<{ mode?: string }>(request)
      if (next.mode !== "ask" && next.mode !== "auto-edit" && next.mode !== "full-auto")
        return json(400, { error: "Mode must be ask, auto-edit or full-auto." })
      store.saveSettings({ ...settings(), approvalMode: next.mode })
      return json(200, { mode: next.mode })
    }

    if (path === "/okucode/api/skills" && request.method === "PUT") {
      const next = await body<{ name?: unknown; enabled?: unknown }>(request)
      if (typeof next.name !== "string" || !next.name.trim() || next.name.length > 200 || typeof next.enabled !== "boolean")
        return json(400, { error: "Send a skill name and enabled: true or false." })
      const value = settings()
      const name = next.name.trim()
      const off = new Set(value.disabledSkills ?? [])
      if (next.enabled) off.delete(name)
      else off.add(name)
      value.disabledSkills = [...off].sort()
      store.saveSettings(value)
      return json(200, { disabled: value.disabledSkills })
    }

    if (path === "/okucode/api/keys" && request.method === "POST") {
      const next = await body<{ name?: unknown; email?: unknown }>(request)
      const name = typeof next.name === "string" ? next.name.trim().slice(0, 80) : ""
      if (!name) return json(400, { error: "Give the key a name, like \"CI script\"." })
      const email = typeof next.email === "string" && next.email.trim() ? normalize(next.email) : by
      const owner = email === OWNER ? ownerUser() : store.get(email)
      if (!owner) return json(400, { error: "Add this person first." })
      if (!isAdmin && email !== by && owner.role !== "member") return json(403, { error: "Team leads can make keys only for themselves and members." })
      const secret = `oku_${randomBytes(24).toString("base64url")}`
      const key: ApiKey = {
        id: randomUUID(),
        name,
        email,
        prefix: secret.slice(0, 10),
        hash: keyHash(secret),
        createdAt: now(),
        createdBy: by,
      }
      store.saveKeys([...store.keys(), key])
      return json(200, { key: keyView(key), secret })
    }
    if (path.startsWith("/okucode/api/keys/") && request.method === "DELETE") {
      const id = decodeURIComponent(path.slice("/okucode/api/keys/".length))
      const keys = store.keys()
      const key = keys.find((item) => item.id === id)
      if (!key) return json(404, { error: "No such key." })
      if (!isAdmin && key.email !== by && store.get(key.email)?.role !== "member")
        return json(403, { error: "Team leads can remove keys only of themselves and members." })
      store.saveKeys(keys.filter((item) => item.id !== id))
      return json(200, { ok: true })
    }

    if (path === "/okucode/api/audit" && request.method === "PUT") {
      if (!isAdmin) return adminOnly()
      const next = await body<{ enabled?: unknown; retentionDays?: unknown }>(request)
      const value = settings()
      if (typeof next.enabled === "boolean") value.audit = next.enabled
      if (next.retentionDays !== undefined) {
        if (typeof next.retentionDays !== "number" || !Number.isInteger(next.retentionDays) || next.retentionDays < 0 || next.retentionDays > 3650)
          return json(400, { error: "Days to keep must be a whole number from 0 (keep everything) to 3650." })
        value.auditRetentionDays = next.retentionDays
      }
      store.saveSettings(value)
      return json(200, { ok: true })
    }

    if (path === "/okucode/api/policy" && request.method === "PUT") {
      const next = await body<{ approvalMode?: string; autoTest?: boolean; routing?: boolean; teamRules?: string; sandbox?: string }>(request)
      const value = settings()
      if (next.approvalMode !== undefined) {
        if (next.approvalMode !== "ask" && next.approvalMode !== "auto-edit" && next.approvalMode !== "full-auto")
          return json(400, { error: "Approval mode must be ask, auto-edit or full-auto." })
        value.approvalMode = next.approvalMode
      }
      if (typeof next.autoTest === "boolean") value.autoTest = next.autoTest
      if (typeof next.routing === "boolean") value.routing = next.routing
      if (next.sandbox !== undefined) {
        if (!SANDBOXES.includes(next.sandbox as Sandbox)) return json(400, { error: "Sandbox must be auto, docker, on or off." })
        value.sandbox = next.sandbox
      }
      if (typeof next.teamRules === "string") {
        if (next.teamRules.length > 20000) return json(400, { error: "Team rules are too long (20,000 characters at most)." })
        store.saveTeamRules(next.teamRules)
      }
      store.saveSettings(value)
      return json(200, { ok: true })
    }

    if (path === "/okucode/api/settings" && request.method === "PUT") {
      if (!isAdmin) return adminOnly()
      const next = await body<{
        publicUrl?: string
        googleClientId?: string
        googleClientSecret?: string
        githubClientId?: string
        githubClientSecret?: string
        microsoftClientId?: string
        microsoftClientSecret?: string
        microsoftTenant?: string
        gmailAddress?: string
        gmailAppPassword?: string
        fromName?: string
      }>(request)
      const value = settings()
      const url = (next.publicUrl ?? "").trim().replace(/\/+$/, "")
      if (url && !/^https?:\/\/[^/\s]+$/.test(url))
        return json(400, { error: "OkuCode address must look like http://localhost:4096 or https://okucode.example.com" })
      value.publicUrl = url || undefined
      value.google = {
        clientId: (next.googleClientId ?? "").trim() || undefined,
        clientSecret: (next.googleClientSecret ?? "").trim() || value.google?.clientSecret,
      }
      if (next.microsoftClientId !== undefined || next.microsoftClientSecret !== undefined || next.microsoftTenant !== undefined)
        value.microsoft = {
          clientId: (next.microsoftClientId ?? "").trim() || undefined,
          clientSecret: (next.microsoftClientSecret ?? "").trim() || value.microsoft?.clientSecret,
          tenant: (next.microsoftTenant ?? "").trim() || undefined,
        }
      if (next.githubClientId !== undefined || next.githubClientSecret !== undefined)
        value.github = {
          clientId: (next.githubClientId ?? "").trim() || undefined,
          clientSecret: (next.githubClientSecret ?? "").trim() || value.github?.clientSecret,
        }
      value.gmail = {
        address: (next.gmailAddress ?? "").trim() || undefined,
        appPassword: (next.gmailAppPassword ?? "").replace(/\s+/g, "") || value.gmail?.appPassword,
        fromName: (next.fromName ?? "").trim() || undefined,
      }
      store.saveSettings(value)
      return json(200, { ok: true })
    }

    if (path === "/okucode/api/users" && request.method === "POST") {
      const next = await body<{ email?: string; role?: Role; invite?: boolean }>(request)
      const role: Role = isRole(next.role) ? next.role : "member"
      if (!isAdmin && role !== "member") return json(403, { error: "Team leads can only add members." })
      let user: User
      try {
        user = store.add({ email: next.email ?? "", role, by, invited: false })
      } catch (error) {
        return json(400, { error: (error as Error).message })
      }
      if (next.invite) {
        try {
          await sendInvite(request, user, by)
        } catch (error) {
          return json(200, { user: publicView(store.get(user.email)!), warning: `Added, but the invite email failed: ${(error as Error).message}` })
        }
      }
      return json(200, { user: publicView(store.get(user.email)!) })
    }

    const match = /^\/okucode\/api\/users\/([^/]+)(\/resend)?$/.exec(path)
    if (match) {
      const email = normalize(decodeURIComponent(match[1]!))
      const target = store.get(email)
      if (!target) return json(404, { error: "User not found." })
      if (!isAdmin && target.role !== "member") return json(403, { error: "Team leads can only manage members." })
      if (match[2] && request.method === "POST") {
        try {
          await sendInvite(request, target, by)
          return json(200, { user: publicView(store.get(email)!) })
        } catch (error) {
          return json(400, { error: (error as Error).message })
        }
      }
      if (request.method === "DELETE") {
        if (email === by) return json(400, { error: "You can't remove yourself." })
        try {
          store.remove(email)
          return json(200, { ok: true })
        } catch (error) {
          return json(400, { error: (error as Error).message })
        }
      }
      if (request.method === "PATCH") {
        const next = await body<{ role?: Role; disabled?: boolean }>(request)
        if (next.role !== undefined && !isRole(next.role)) return json(400, { error: "Role must be admin, lead or member." })
        if (!isAdmin && next.role !== undefined && next.role !== target.role)
          return json(403, { error: "Only admins can change roles." })
        try {
          const user = store.update(email, (item, all) => {
            const others = activeAdmins(all).filter((admin) => admin.email !== item.email)
            if (next.role && next.role !== item.role) {
              if (item.role === "admin" && others.length === 0) throw new Error("There must be at least one admin.")
              item.role = next.role
            }
            if (next.disabled !== undefined) {
              if (email === by) throw new Error("You can't disable yourself.")
              if (next.disabled && item.role === "admin" && others.length === 0)
                throw new Error("There must be at least one active admin.")
              item.status = next.disabled ? "disabled" : item.lastLogin ? "active" : "invited"
            }
          })
          return json(200, { user: publicView(user) })
        } catch (error) {
          return json(400, { error: (error as Error).message })
        }
      }
    }
    return json(404, { error: "Not found." })
  }

  return {
    /** Handles /okucode/* requests; returns undefined for everything else. */
    async handle(request: Request): Promise<Response | undefined> {
      const path = request.url.pathname
      if (!path.startsWith("/okucode/")) return undefined

      if (path === "/okucode/auth/config")
        return json(200, {
          google: googleReady(),
          github: githubReady(),
          microsoft: microsoftReady(),
          accounts: store.enabled() || googleReady() || githubReady() || microsoftReady(),
        })
      if (path === "/okucode/auth/google" && request.method === "GET") return googleStart(request)
      if (path === "/okucode/auth/google/callback" && request.method === "GET") return googleCallback(request)
      if (path === "/okucode/auth/github" && request.method === "GET") return githubStart(request)
      if (path === "/okucode/auth/github/callback" && request.method === "GET") return githubCallback(request)
      if (path === "/okucode/auth/microsoft" && request.method === "GET") return microsoftStart(request)
      if (path === "/okucode/auth/microsoft/callback" && request.method === "GET") return microsoftCallback(request)
      if (path === "/okucode/auth/logout" && request.method === "POST") return json(200, { ok: true }, signOutCookies(request))
      if (path === "/okucode/auth/password" && request.method === "POST") {
        if (!sameOrigin(request)) return json(403, { error: "Request blocked." })
        const { password } = await body<{ password?: string }>(request)
        if (!password || !same(password, input.password)) return json(401, { error: "Wrong password." })
        return json(200, { ok: true }, signInCookies(request, OWNER))
      }
      if (path === "/okucode/me") {
        const me = currentUser(request)
        return me ? json(200, { ...publicView(me), owner: me.email === OWNER }) : json(401, { error: "Not signed in." })
      }
      // FR-57: team admin lives in the web app (Settings → Team). The old address goes there.
      if ((path === "/okucode/admin" || path === "/okucode/admin/") && request.url.searchParams.get("classic") !== "1")
        return redirect("/settings?tab=team")
      if (path === "/okucode/admin" || path === "/okucode/admin/")
        return {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy":
              "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'",
          },
          body: ADMIN_PAGE,
        }
      if (path.startsWith("/okucode/api/")) {
        const me = currentUser(request)
        if (!me) return json(401, { error: "Not signed in." })
        if (me.role !== "admin" && me.role !== "lead") return json(403, { error: "Only admins and team leads can do this." })
        return admin(request, me, path)
      }
      return json(404, { error: "Not found." })
    },

    /**
     * FR-56: for "Authorization: Bearer oku_…" requests to the OkuCode API, the server's own credentials for that
     * request (a session for the server password) so the API accepts it, or a 401 for a key that is not valid.
     * undefined for every other request.
     */
    apiKeyAuth(request: Request): { authorization: string; email: string } | Response | undefined {
      if (!/^Bearer\s+oku_/i.test(request.headers.authorization ?? "")) return undefined
      const user = keyUser(request)
      if (!user) return json(401, { _tag: "UnauthorizedError", message: "This API key is not valid or was removed." })
      const session = ServerAuth.issueSession(auth, now())!
      return { authorization: `Basic ${Buffer.from(`opencode:${session}`).toString("base64")}`, email: user.email }
    },

    /**
     * For API requests of a signed-in person (valid sign-in cookie, no password or key): the server's credentials for
     * this request, with a fresh session and a fresh session cookie. The person's sign-in cookie is what counts, so a
     * stale session cookie (an older server password, another OkuCode on this computer) cannot leave the page half
     * loaded: signed in, but every request refused.
     */
    cookieAuth(request: Request): { authorization: string; cookies: string[] } | undefined {
      const path = request.url.pathname
      if (!(path === "/api" || path.startsWith("/api/") || path === "/openapi.json")) return undefined
      if (request.headers.authorization || request.url.searchParams.get("auth_token")) return undefined
      if (!cookieUser(request)) return undefined
      const name = ServerAuth.sessionCookieName(request.headers.host)
      const current = request.cookies[name]
      if (current && ServerAuth.verifySession(current, auth, now())) return undefined
      const session = ServerAuth.issueSession(auth, now())
      if (!session) return undefined
      return {
        authorization: `Basic ${Buffer.from(`opencode:${session}`).toString("base64")}`,
        cookies: [cookie(name, session, USER_TTL, secure(request))],
      }
    },

    /**
     * For all other requests: a request that relies on the session cookie (no password) must belong to a user that is
     * still allowed. Returns a 401 response to stop it, or undefined to let it through.
     */
    gate(request: Request): Response | undefined {
      const path = request.url.pathname
      // FR-58: remember who sends each chat, for usage per person.
      const prompt = request.method === "POST" ? path.match(/^\/api\/session\/([^/]+)\/prompt$/) : null
      if (prompt) {
        const user = keyUser(request) ?? cookieUser(request)
        if (user) {
          try {
            store.noteSession(decodeURIComponent(prompt[1]!), user.email)
          } catch {}
        }
      }
      // Only the API is checked; the page itself loads and then shows the sign-in screen.
      if (!(path === "/api" || path.startsWith("/api/") || path.startsWith("/auth/") || path === "/openapi.json")) return undefined
      const session = request.cookies[ServerAuth.sessionCookieName(request.headers.host)]
      if (!session) return undefined
      if (request.headers.authorization || request.url.searchParams.get("auth_token")) return undefined
      if (cookieUser(request)) return undefined
      // Pairing links (opencode pair) also use the session cookie; they keep working until accounts are set up.
      if (!store.enabled() && !request.cookies[USER_COOKIE]) return undefined
      return { ...json(401, { _tag: "UnauthorizedError", message: "Signed out" }), cookies: signOutCookies(request) }
    },
  }
}

export type Accounts = ReturnType<typeof createAccounts>
