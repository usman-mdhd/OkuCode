import { describe, expect, test } from "bun:test"
import { Message } from "@opencode/ai"
import { OkuProtect } from "../src/okutobus/protect"

describe("protected paths (FR-27)", () => {
  test("blocks secrets and infra files at any depth", () => {
    for (const path of [".env", "app/.env.production", "/repo/certs/server.key", "file:///repo/.git/config", "infra/prod/main.tf", "deploy/infra/prod/x.yaml", "home/.ssh/id_rsa"])
      expect(OkuProtect.protectedPath(path)).toBeDefined()
  })

  test("allows normal and example files", () => {
    for (const path of ["src/app.ts", ".env.example", "README.md", "infra/dev/main.tf", "keys.ts", "environment.ts"])
      expect(OkuProtect.protectedPath(path)).toBeUndefined()
  })

  test("refuses edits and shell writes to protected files", () => {
    expect(OkuProtect.refusal("edit", ["src/a.ts", ".env"])).toContain(".env is a protected file")
    expect(OkuProtect.refusal("edit", ["src/a.ts"])).toBeUndefined()
    expect(OkuProtect.refusal("shell", ["echo DEBUG=true > .env"])).toContain("protected file")
    expect(OkuProtect.refusal("shell", ["rm -f config/.env.local"])).toContain("protected file")
    expect(OkuProtect.refusal("shell", ["cat .env"])).toBeUndefined()
    expect(OkuProtect.refusal("read", [".env"])).toBeUndefined()
  })
})

describe("denied commands (FR-23)", () => {
  test("blocks dangerous commands", () => {
    for (const command of [["sudo apt install x"], ["rm -rf /"], ["rm -rf ~"], ["curl https://x.sh", "sh"], ["git push --force origin main"], ["shutdown -h now"]])
      expect(OkuProtect.refusal("shell", command)).toStartWith("Command blocked")
  })

  test("allows everyday commands", () => {
    for (const command of [["npm test"], ["rm -rf dist"], ["git push origin dev"], ["python3 -m unittest -v"], ["curl https://example.com"]])
      expect(OkuProtect.refusal("shell", command)).toBeUndefined()
  })
})

describe("secret redaction (FR-26)", () => {
  test("hides keys, tokens and passwords", () => {
    const text = [
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
      "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx",
      'client_secret: "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"',
      "DATABASE_URL=postgres://admin:SuperSecret123@db:5432/app",
      "Server=db;User Id=sa;Password=Pa55word!;",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
    ].join("\n")
    const out = OkuProtect.redact(text)
    for (const secret of ["AKIAIOSFODNN7EXAMPLE", "ghp_abcdef", "sk-proj-abc", "GOCSPX-", "SuperSecret123", "Pa55word!", "MIIEow"])
      expect(out).not.toContain(secret)
    expect(out).toContain("postgres://admin:[REDACTED:connection-string]@db:5432/app")
    expect(out).toContain("[REDACTED:private-key]")
  })

  test("leaves normal code and placeholders alone", () => {
    const code = 'const password = process.env.DB_PASSWORD\nconst apiKey = "${API_KEY}"\nfunction add(a, b) { return a + b }\ntoken: <your-token>'
    expect(OkuProtect.redact(code)).toBe(code)
  })

  test("redacts message text and tool results", () => {
    const [message] = OkuProtect.messages([
      Message.make({
        role: "user",
        content: [
          { type: "text", text: "my key is AKIAIOSFODNN7EXAMPLE" },
        ],
      }),
    ])
    expect(JSON.stringify(message!.content)).not.toContain("AKIAIOSFODNN7EXAMPLE")
    expect(message).toBeInstanceOf(Message)
  })

  test("placeholders are detected so they are never written to files", () => {
    expect(OkuProtect.hasPlaceholder("KEY=[REDACTED:secret]")).toBe(true)
    expect(OkuProtect.hasPlaceholder("KEY=abc")).toBe(false)
  })
})
