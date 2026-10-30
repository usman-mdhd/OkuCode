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
  const fetcher = (async (url: string | URL) => {
    const href = String(url)
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
  return { store, accounts, call, request, cookies, sent, google }
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
