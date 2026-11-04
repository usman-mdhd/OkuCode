import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createAccounts, type Request } from "../src/okutobus/accounts"
import { Store } from "../src/okutobus/accounts-store"
import { message } from "../src/okutobus/smtp"

const PASSWORD = "server-pass"

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "oku-accounts-"))
  const store = new Store({ data: path.join(dir, "data"), config: path.join(dir, "config") })
  const sent: { to: string; subject: string; text: string }[] = []
  const google = { email: "new@okutobus.com", verified: true }
  const microsoft = { me: { mail: "New@Okutobus.com", userPrincipalName: "new_okutobus.com#EXT#@tenant.onmicrosoft.com", displayName: "New Person" } as Record<string, unknown> }
  const github = {
    emails: [
      { email: "personal@gmail.com", primary: true, verified: true },
      { email: "New@Okutobus.com", primary: false, verified: true },
      { email: "unverified@okutobus.com", primary: false, verified: false },
    ],
  }
  const fetcher = (async (url: string | URL) => {
    const href = String(url)
    if (href.includes("login.microsoftonline.com") && href.endsWith("/token")) return new Response(JSON.stringify({ access_token: "ms" }))
    if (href === "https://graph.microsoft.com/v1.0/me") return new Response(JSON.stringify(microsoft.me))
    if (href.includes("github") && href.includes("access_token")) return new Response(JSON.stringify({ access_token: "gh" }))
    if (href.includes("github") && href.endsWith("/user/emails"))
      return new Response(JSON.stringify(github.emails))
    if (href.includes("github") && href.endsWith("/user")) return new Response(JSON.stringify({ login: "usman-dev", name: "Usman", avatar_url: "https://avatars/x.png" }))
    if (href.includes("token")) return new Response(JSON.stringify({ access_token: "tok" }))
    if (href.includes("userinfo"))
      return new Response(JSON.stringify({ email: google.email, email_verified: google.verified, name: "New Person" }))
    return new Response("", { status: 404 })
  }) as typeof fetch
  const accounts = createAccounts({
    store,
    password: PASSWORD,
    fetch: fetcher,
    sendMail: async (mail) => {
      sent.push({ to: mail.to, subject: mail.subject, text: mail.text })
    },
  })
  const cookies: Record<string, string> = {}
  const request = (method: string, url: string, init: { body?: unknown; basic?: boolean; noCookies?: boolean } = {}): Request => ({
    method,
    url: new URL(url, "http://localhost:4096"),
    headers: {
      host: "localhost:4096",
      origin: "http://localhost:4096",
      "content-type": "application/json",
      authorization: init.basic ? `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}` : undefined,
    },
    cookies: init.noCookies ? {} : { ...cookies },
    body: async () => (init.body === undefined ? "" : JSON.stringify(init.body)),
  })
  const keep = (set?: string[]) => {
    for (const line of set ?? []) {
      const [pair] = line.split(";")
      const [name, ...rest] = pair!.split("=")
      const value = rest.join("=")
      if (value) cookies[name!] = value
      else delete cookies[name!]
    }
  }
  const call = async (method: string, url: string, init: { body?: unknown; basic?: boolean } = {}) => {
    const response = (await accounts.handle(request(method, url, init)))!
    keep(response.cookies)
    return { ...response, data: response.body ? JSON.parse(response.body.startsWith("<") ? "{}" : response.body) : undefined }
  }
  return { store, accounts, call, request, cookies, sent, google, github, microsoft }
}

async function googleSignIn(t: ReturnType<typeof setup>) {
  t.store.saveSettings({ google: { clientId: "id", clientSecret: "secret" } })
  const start = await t.call("GET", "/okucode/auth/google")
  expect(start.status).toBe(302)
  const location = new URL(start.headers!.location!)
  expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:4096/okucode/auth/google/callback")
  return t.call("GET", `/okucode/auth/google/callback?code=abc&state=${location.searchParams.get("state")}`)
}

describe("OkuCode accounts", () => {
  test("only added emails can sign in with Google", async () => {
    const t = setup()
    const refused = await googleSignIn(t)
    expect(refused.headers!.location).toBe("/?okucode_error=not_invited&email=new%40okutobus.com")

    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    const added = await t.call("POST", "/okucode/api/users", { body: { email: "New@Okutobus.com", role: "member" } })
    expect(added.data.user).toMatchObject({ email: "new@okutobus.com", status: "invited", role: "member" })

    const ok = await googleSignIn(t)
    expect(ok.headers!.location).toBe("/")
    expect(ok.cookies!.some((c) => c.startsWith("opencode_session_4096="))).toBe(true)
    const me = await t.call("GET", "/okucode/me")
    expect(me.data).toMatchObject({ email: "new@okutobus.com", name: "New Person", role: "member", status: "active" })
    expect(t.accounts.gate(t.request("GET", "/api/session"))).toBeUndefined()
  })

  test("members cannot use the admin API; admins manage users", async () => {
    const t = setup()
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    await t.call("POST", "/okucode/api/users", { body: { email: "new@okutobus.com" } })
    await t.call("POST", "/okucode/api/users", { body: { email: "boss@okutobus.com", role: "admin" } })
    await googleSignIn(t)
    expect((await t.call("GET", "/okucode/api/users")).status).toBe(403)

    t.google.email = "boss@okutobus.com"
    await googleSignIn(t)
    const list = await t.call("GET", "/okucode/api/users")
    expect(list.data.users.map((u: { email: string }) => u.email)).toEqual(["boss@okutobus.com", "new@okutobus.com"])
    const promoted = await t.call("PATCH", "/okucode/api/users/new%40okutobus.com", { body: { role: "admin" } })
    expect(promoted.data.user.role).toBe("admin")
    expect((await t.call("PATCH", "/okucode/api/users/boss%40okutobus.com", { body: { disabled: true } })).data.error).toBe(
      "You can't disable yourself.",
    )
  })

  test("disabling a user signs them out at once", async () => {
    const t = setup()
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    await t.call("POST", "/okucode/api/users", { body: { email: "new@okutobus.com" } })
    await googleSignIn(t)
    const memberCookies = { ...t.cookies }
    t.store.update("new@okutobus.com", (user) => {
      user.status = "disabled"
    })
    const blocked = t.accounts.gate({ ...t.request("GET", "/api/session"), cookies: memberCookies })
    expect(blocked?.status).toBe(401)
    expect(t.accounts.gate({ ...t.request("GET", "/"), cookies: memberCookies })).toBeUndefined()
    expect(t.accounts.gate({ ...t.request("GET", "/api/session", { basic: true }), cookies: memberCookies })).toBeUndefined()
    const again = await googleSignIn(t)
    expect(again.headers!.location).toBe("/?okucode_error=disabled&email=new%40okutobus.com")
  })

  test("the last admin cannot be removed or demoted", async () => {
    const t = setup()
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    await t.call("POST", "/okucode/api/users", { body: { email: "boss@okutobus.com", role: "admin" } })
    expect((await t.call("PATCH", "/okucode/api/users/boss%40okutobus.com", { body: { role: "member" } })).data.error).toBe(
      "There must be at least one admin.",
    )
    expect((await t.call("DELETE", "/okucode/api/users/boss%40okutobus.com")).data.error).toBe("You can't remove the last admin.")
  })

  test("invites are emailed through Gmail settings", async () => {
    const t = setup()
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    const noGmail = await t.call("POST", "/okucode/api/users", { body: { email: "a@okutobus.com", invite: true } })
    expect(noGmail.data.warning).toContain("Set up Gmail")
    await t.call("PUT", "/okucode/api/settings", {
      body: { gmailAddress: "okucode@okutobus.com", gmailAppPassword: "abcd efgh ijkl mnop", publicUrl: "https://okucode.okutobus.com" },
    })
    const settings = await t.call("GET", "/okucode/api/settings")
    expect(settings.data).toMatchObject({ gmailReady: true, gmailPasswordSaved: true, callbackUrl: "https://okucode.okutobus.com/okucode/auth/google/callback" })
    expect(JSON.stringify(settings.data)).not.toContain("abcdefgh")
    const invited = await t.call("POST", "/okucode/api/users", { body: { email: "b@okutobus.com", invite: true } })
    expect(invited.data.user.invitedAt).toBeGreaterThan(0)
    expect(t.sent[0]).toMatchObject({ to: "b@okutobus.com", subject: "You're invited to OkuCode" })
    expect(t.sent[0]!.text).toContain("https://okucode.okutobus.com")
  })

  test("other sites and wrong passwords are refused", async () => {
    const t = setup()
    expect((await t.call("POST", "/okucode/auth/password", { body: { password: "nope" } })).status).toBe(401)
    expect((await t.call("GET", "/okucode/api/users")).status).toBe(401)
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    const forged = await t.accounts.handle({
      ...t.request("POST", "/okucode/api/users", { body: { email: "x@y.com" } }),
      headers: { host: "localhost:4096", origin: "https://evil.example", "content-type": "application/json" },
    })
    expect(forged?.status).toBe(403)
    const state = await t.call("GET", "/okucode/auth/google/callback?code=abc&state=forged")
    expect(state.headers!.location).toContain("okucode_error")
  })

  test("admins set the approval mode; it is kept with the other settings", async () => {
    const t = setup()
    expect((await t.call("GET", "/okucode/api/approval")).status).toBe(401)
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    expect((await t.call("GET", "/okucode/api/approval")).data).toEqual({ mode: null })
    t.store.saveSettings({ google: { clientId: "id", clientSecret: "secret" } })
    expect((await t.call("PUT", "/okucode/api/approval", { body: { mode: "nope" } })).status).toBe(400)
    expect((await t.call("PUT", "/okucode/api/approval", { body: { mode: "auto-edit" } })).data).toEqual({ mode: "auto-edit" })
    expect(t.store.settings()).toMatchObject({ approvalMode: "auto-edit", google: { clientId: "id" } })
    await t.call("POST", "/okucode/api/users", { body: { email: "new@okutobus.com" } })
    await googleSignIn(t)
    expect((await t.call("PUT", "/okucode/api/approval", { body: { mode: "full-auto" } })).status).toBe(403)
  })

  test("team leads manage members and the policy, not admins or setup (FR-57)", async () => {
    const t = setup()
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    await t.call("POST", "/okucode/api/users", { body: { email: "boss@okutobus.com", role: "admin" } })
    await t.call("POST", "/okucode/api/users", { body: { email: "dev@okutobus.com" } })
    const lead = await t.call("POST", "/okucode/api/users", { body: { email: "new@okutobus.com", role: "lead" } })
    expect(lead.data.user.role).toBe("lead")
    await googleSignIn(t)
    t.store.saveSettings({ ...t.store.settings(), smallModel: "ollama/qwen2.5-coder:3b" })

    // Members: yes. Admins, leads, roles and the sign-in setup: no.
    expect((await t.call("GET", "/okucode/api/users")).status).toBe(200)
    expect((await t.call("POST", "/okucode/api/users", { body: { email: "x@okutobus.com" } })).data.user.role).toBe("member")
    expect((await t.call("POST", "/okucode/api/users", { body: { email: "y@okutobus.com", role: "admin" } })).status).toBe(403)
    expect((await t.call("PATCH", "/okucode/api/users/dev%40okutobus.com", { body: { disabled: true } })).data.user.status).toBe("disabled")
    expect((await t.call("PATCH", "/okucode/api/users/dev%40okutobus.com", { body: { role: "admin" } })).status).toBe(403)
    expect((await t.call("PATCH", "/okucode/api/users/boss%40okutobus.com", { body: { disabled: true } })).status).toBe(403)
    expect((await t.call("DELETE", "/okucode/api/users/boss%40okutobus.com")).status).toBe(403)
    expect((await t.call("DELETE", "/okucode/api/users/dev%40okutobus.com")).status).toBe(200)
    expect((await t.call("GET", "/okucode/api/settings")).status).toBe(403)
    expect((await t.call("PUT", "/okucode/api/settings", { body: {} })).status).toBe(403)

    // The policy applies to every chat: approval mode, auto-test, routing and team rules.
    expect((await t.call("GET", "/okucode/api/policy")).data).toEqual({
      approvalMode: null, autoTest: true, routing: false, smallModel: "ollama/qwen2.5-coder:3b", teamRules: "",
    })
    expect((await t.call("PUT", "/okucode/api/policy", { body: { approvalMode: "yolo" } })).status).toBe(400)
    const saved = await t.call("PUT", "/okucode/api/policy", {
      body: { approvalMode: "auto-edit", autoTest: false, routing: false, teamRules: "- Never commit to main.\r\n" },
    })
    expect(saved.status).toBe(200)
    expect(t.store.settings()).toMatchObject({ approvalMode: "auto-edit", autoTest: false, routing: false, google: { clientId: "id" } })
    expect(t.store.teamRules()).toBe("- Never commit to main.\n")
    await t.call("PUT", "/okucode/api/policy", { body: { teamRules: "  " } })
    expect(t.store.teamRules()).toBe("")

    // Members still cannot change the policy.
    t.google.email = "x@okutobus.com"
    await googleSignIn(t)
    expect((await t.call("PUT", "/okucode/api/policy", { body: { autoTest: true } })).status).toBe(403)
  })

  test("admins switch skills on and off; members cannot", async () => {
    const t = setup()
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    expect((await t.call("GET", "/okucode/api/skills")).data).toEqual({ disabled: [] })
    expect((await t.call("PUT", "/okucode/api/skills", { body: { name: "pdf", enabled: false } })).data).toEqual({ disabled: ["pdf"] })
    await t.call("PUT", "/okucode/api/skills", { body: { name: "docx", enabled: false } })
    expect((await t.call("PUT", "/okucode/api/skills", { body: { name: "pdf", enabled: true } })).data).toEqual({ disabled: ["docx"] })
    expect(t.store.settings().disabledSkills).toEqual(["docx"])
    expect((await t.call("PUT", "/okucode/api/skills", { body: { name: "", enabled: false } })).status).toBe(400)

    await t.call("POST", "/okucode/api/users", { body: { email: "new@okutobus.com" } })
    t.store.saveSettings({ ...t.store.settings(), google: { clientId: "id", clientSecret: "secret" } })
    await googleSignIn(t)
    expect((await t.call("PUT", "/okucode/api/skills", { body: { name: "docx", enabled: true } })).status).toBe(403)
  })

  test("admins see, check and download the audit log; members cannot (FR-60)", async () => {
    const t = setup()
    const auditDir = mkdtempSync(path.join(tmpdir(), "oku-audit-api-"))
    process.env.OKUCODE_AUDIT_DIR = auditDir
    try {
      const { AuditChain } = await import("@opencode/util/audit-chain")
      const base = { seq: 1, time: "2026-11-03T10:00:00.000Z", kind: "prompt" as const, user: "me", data: { text: "hi" }, prev: AuditChain.GENESIS }
      const entry = { ...base, hash: AuditChain.hashOf(base) }
      const { writeFileSync } = await import("node:fs")
      writeFileSync(path.join(auditDir, "2026-11-03.jsonl"), JSON.stringify(entry) + "\n")

      await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
      const view = await t.call("GET", "/okucode/api/audit")
      expect(view.data).toMatchObject({ enabled: true, retentionDays: 90, check: { ok: true, entries: 1 }, days: [{ date: "2026-11-03" }] })
      const file = await t.call("GET", "/okucode/api/audit/download?date=2026-11-03")
      expect(file.headers?.["content-disposition"]).toContain("okucode-audit-2026-11-03.jsonl")
      expect((await t.call("GET", "/okucode/api/audit/download?date=../x")).status).toBe(400)
      expect((await t.call("PUT", "/okucode/api/audit", { body: { retentionDays: 30 } })).status).toBe(200)
      expect(t.store.settings().auditRetentionDays).toBe(30)
      expect((await t.call("PUT", "/okucode/api/audit", { body: { retentionDays: -1 } })).status).toBe(400)

      // A changed entry shows up in the check.
      writeFileSync(path.join(auditDir, "2026-11-03.jsonl"), JSON.stringify({ ...entry, data: { text: "changed" } }) + "\n")
      expect((await t.call("GET", "/okucode/api/audit")).data.check).toMatchObject({ ok: false, problem: { line: 1 } })

      await t.call("POST", "/okucode/api/users", { body: { email: "new@okutobus.com", role: "lead" } })
      t.store.saveSettings({ ...t.store.settings(), google: { clientId: "id", clientSecret: "secret" } })
      await googleSignIn(t)
      expect((await t.call("GET", "/okucode/api/audit")).status).toBe(403)
    } finally {
      delete process.env.OKUCODE_AUDIT_DIR
    }
  })

  test("usage per person: prompts by signed-in people are counted for them (FR-58)", async () => {
    const t = setup()
    const usageDir = mkdtempSync(path.join(tmpdir(), "oku-usage-api-"))
    process.env.OKUCODE_USAGE_DIR = usageDir
    try {
      const { UsageLog } = await import("@opencode/util/usage-log")
      const now = new Date().toISOString()
      const base = { time: now, provider: "ollama", model: "qwen", input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, ms: 60_000 }
      UsageLog.record({ ...base, sessionID: "ses_1" }, usageDir)
      UsageLog.record({ ...base, sessionID: "ses_2" }, usageDir)

      await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
      await t.call("POST", "/okucode/api/users", { body: { email: "new@okutobus.com", role: "lead" } })
      t.store.saveSettings({ ...t.store.settings(), google: { clientId: "id", clientSecret: "secret" } })
      await googleSignIn(t)
      // The lead sends a message in ses_1: that chat is now counted for them.
      expect(t.accounts.gate(t.request("POST", "/api/session/ses_1/prompt"))).toBeUndefined()
      const usage = await t.call("GET", "/okucode/api/usage?days=7")
      expect(usage.status).toBe(200)
      expect(usage.data.total).toMatchObject({ calls: 2, input: 200, output: 100 })
      expect(usage.data.byUser.map((row: { user: string }) => row.user).sort()).toEqual(["new@okutobus.com", "owner"])
    } finally {
      delete process.env.OKUCODE_USAGE_DIR
    }
  })

  test("API keys: made once, used as the person, limited for leads, removed or stopped when disabled (FR-56)", async () => {
    const t = setup()
    const bearer = (method: string, url: string, key: string): Request => {
      const base = t.request(method, url, { noCookies: true })
      return { ...base, headers: { ...base.headers, authorization: `Bearer ${key}` } }
    }
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    await t.call("POST", "/okucode/api/users", { body: { email: "boss@okutobus.com", role: "admin" } })
    await t.call("POST", "/okucode/api/users", { body: { email: "dev@okutobus.com" } })
    await t.call("POST", "/okucode/api/users", { body: { email: "new@okutobus.com", role: "lead" } })
    expect((await t.call("POST", "/okucode/api/keys", { body: { name: " " } })).status).toBe(400)
    expect((await t.call("POST", "/okucode/api/keys", { body: { name: "x", email: "nobody@okutobus.com" } })).status).toBe(400)

    // An admin makes a key for a member: the secret comes back once, only its hash is stored.
    const made = await t.call("POST", "/okucode/api/keys", { body: { name: "CI script", email: "Dev@Okutobus.com" } })
    expect(made.status).toBe(200)
    const secret = made.data.secret as string
    expect(secret).toMatch(/^oku_[A-Za-z0-9_-]{32}$/)
    expect(made.data.key).toMatchObject({ name: "CI script", email: "dev@okutobus.com", prefix: secret.slice(0, 10) })
    expect(made.data.key.hash).toBeUndefined()
    expect(JSON.stringify(t.store.keys())).not.toContain(secret)

    // The key works as that person, for OkuCode's own API and for the server API.
    const me = (await t.accounts.handle(bearer("GET", "/okucode/me", secret)))!
    expect(JSON.parse(me.body!)).toMatchObject({ email: "dev@okutobus.com", role: "member" })
    const auth = t.accounts.apiKeyAuth(bearer("GET", "/api/session", secret))
    expect(auth).toMatchObject({ email: "dev@okutobus.com" })
    expect((auth as { authorization: string }).authorization).toMatch(/^Basic /)
    expect(t.store.keys()[0]!.lastUsed).toBeNumber()
    expect(t.accounts.apiKeyAuth(t.request("GET", "/api/session"))).toBeUndefined()
    const wrong = t.accounts.apiKeyAuth(bearer("GET", "/api/session", "oku_" + "x".repeat(32)))
    expect((wrong as Response).status).toBe(401)

    // A lead sees and makes keys for themselves and members, not for admins.
    await googleSignIn(t)
    expect((await t.call("POST", "/okucode/api/keys", { body: { name: "boss", email: "boss@okutobus.com" } })).status).toBe(403)
    const own = await t.call("POST", "/okucode/api/keys", { body: { name: "My laptop" } })
    expect(own.data.key.email).toBe("new@okutobus.com")
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    await t.call("POST", "/okucode/api/keys", { body: { name: "Boss key", email: "boss@okutobus.com" } })
    await googleSignIn(t)
    const seen = (await t.call("GET", "/okucode/api/keys")).data.keys.map((key: { name: string }) => key.name).sort()
    expect(seen).toEqual(["CI script", "My laptop"])

    // Disabling the person stops their key; removing the key stops it for good.
    await t.call("PATCH", "/okucode/api/users/dev%40okutobus.com", { body: { disabled: true } })
    expect((t.accounts.apiKeyAuth(bearer("GET", "/api/session", secret)) as Response).status).toBe(401)
    await t.call("PATCH", "/okucode/api/users/dev%40okutobus.com", { body: { disabled: false } })
    expect(t.accounts.apiKeyAuth(bearer("GET", "/api/session", secret))).toMatchObject({ email: "dev@okutobus.com" })
    expect((await t.call("DELETE", `/okucode/api/keys/${made.data.key.id}`)).status).toBe(200)
    expect((t.accounts.apiKeyAuth(bearer("GET", "/api/session", secret)) as Response).status).toBe(401)
  })

  test("GitHub sign-in: a verified GitHub email an admin added can sign in (FR-56)", async () => {
    const t = setup()
    const signIn = async () => {
      const start = await t.call("GET", "/okucode/auth/github")
      expect(start.status).toBe(302)
      const location = new URL(start.headers!.location!)
      expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize")
      expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:4096/okucode/auth/github/callback")
      return t.call("GET", `/okucode/auth/github/callback?code=abc&state=${location.searchParams.get("state")}`)
    }
    expect((await t.call("GET", "/okucode/auth/github")).headers!.location).toBe("/?okucode_error=github_not_set_up")
    t.store.saveSettings({ github: { clientId: "gh-id", clientSecret: "gh-secret" } })
    expect((await t.call("GET", "/okucode/auth/config")).data).toMatchObject({ github: true, google: false })

    // Not added yet: refused with the primary email.
    expect((await signIn()).headers!.location).toBe("/?okucode_error=not_invited&email=personal%40gmail.com")

    // Added under the work email (a verified, non-primary GitHub email): signed in.
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    await t.call("POST", "/okucode/api/users", { body: { email: "new@okutobus.com", role: "member" } })
    const ok = await signIn()
    expect(ok.headers!.location).toBe("/")
    expect(t.store.get("new@okutobus.com")).toMatchObject({ status: "active", name: "Usman", picture: "https://avatars/x.png" })
    expect((await t.call("GET", "/okucode/me")).data).toMatchObject({ email: "new@okutobus.com", role: "member" })

    // An unverified email never counts.
    t.github.emails = [{ email: "unverified@okutobus.com", primary: true, verified: false }]
    expect((await signIn()).headers!.location).toBe("/?okucode_error=github_failed")
  })

  test("Microsoft sign-in: the account's email must be one an admin added (FR-56)", async () => {
    const t = setup()
    const signIn = async () => {
      const start = await t.call("GET", "/okucode/auth/microsoft")
      const location = new URL(start.headers!.location!)
      return { location, done: await t.call("GET", `/okucode/auth/microsoft/callback?code=abc&state=${location.searchParams.get("state")}`) }
    }
    expect((await t.call("GET", "/okucode/auth/microsoft")).headers!.location).toBe("/?okucode_error=microsoft_not_set_up")
    t.store.saveSettings({ microsoft: { clientId: "ms-id", clientSecret: "ms-secret" } })
    expect((await t.call("GET", "/okucode/auth/config")).data).toMatchObject({ microsoft: true })

    const first = await signIn()
    expect(first.location.origin + first.location.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")
    expect(first.location.searchParams.get("redirect_uri")).toBe("http://localhost:4096/okucode/auth/microsoft/callback")
    expect(first.done.headers!.location).toBe("/?okucode_error=not_invited&email=new%40okutobus.com")

    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    await t.call("POST", "/okucode/api/users", { body: { email: "new@okutobus.com" } })
    t.store.saveSettings({ ...t.store.settings(), microsoft: { clientId: "ms-id", clientSecret: "ms-secret", tenant: "okutobus-tenant" } })
    const second = await signIn()
    expect(second.location.pathname).toBe("/okutobus-tenant/oauth2/v2.0/authorize")
    expect(second.done.headers!.location).toBe("/")
    expect(t.store.get("new@okutobus.com")).toMatchObject({ status: "active", name: "New Person" })

    // No usable email (guest sign-in name only): refused.
    t.microsoft.me = { mail: null, userPrincipalName: "x_gmail.com#EXT#@tenant.onmicrosoft.com" }
    expect((await signIn()).done.headers!.location).toBe("/?okucode_error=microsoft_failed")
  })

  test("admins save GitHub sign-in settings without losing Google's", async () => {
    const t = setup()
    t.store.saveSettings({ google: { clientId: "g", clientSecret: "gs" } })
    await t.call("POST", "/okucode/auth/password", { body: { password: PASSWORD } })
    await t.call("PUT", "/okucode/api/settings", { body: { googleClientId: "g", githubClientId: "gh", githubClientSecret: "ghs" } })
    expect(t.store.settings()).toMatchObject({ google: { clientId: "g", clientSecret: "gs" }, github: { clientId: "gh", clientSecret: "ghs" } })
    const view = (await t.call("GET", "/okucode/api/settings")).data
    expect(view).toMatchObject({ githubClientId: "gh", githubSecretSaved: true, githubReady: true, githubCallbackUrl: "http://localhost:4096/okucode/auth/github/callback" })
  })

  test("email message is valid MIME", () => {
    const body = message({
      host: "", port: 0, user: "", pass: "", from: "a@b.com", fromName: "OkuCode", to: "c@d.com",
      subject: "Hello", text: "Hi there", html: "<p>Hi</p>",
    }, "B")
    expect(body).toContain('Content-Type: multipart/alternative; boundary="B"')
    expect(body).toContain(Buffer.from("Hi there").toString("base64"))
    expect(body.endsWith("--B--\r\n")).toBe(true)
  })
})
