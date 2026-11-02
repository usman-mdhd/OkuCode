import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OkuRepoMap } from "@opencode/core/okutobus/repo-map"

function project(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "oku-map-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    writeFileSync(path.join(dir, name), text)
  }
  return dir
}

const sample = {
  "app/auth.py":
    "from app.db import Database\n\nclass AuthService:\n    def login(self, email: str, password: str) -> bool:\n        return Database().find_user(email) is not None\n\n    def reset_password(self, email: str) -> str:\n        def helper():\n            pass\n        return 'x'\n",
  "app/db.py": "class Database:\n    def find_user(self, email: str):\n        return None\n",
  "web/api.ts":
    "export interface User { id: number }\nexport function getUser(id: number): User { return { id } }\nexport const add = (a: number, b: number) => a + b\nexport class Client {\n  fetch(url: string): Promise<string> { return Promise.resolve(url) }\n}\n",
  "node_modules/x/index.js": "function hidden() {}\n",
  "README.md": "# not code\n",
}

describe("Okutobus repository map (FR-18)", () => {
  test("outlines classes, functions and methods with signatures, skipping local functions", async () => {
    const files = await OkuRepoMap.build(project(sample))
    expect(files.map((file) => file.path).sort()).toEqual(["app/auth.py", "app/db.py", "web/api.ts"])
    const auth = files.find((file) => file.path === "app/auth.py")!
    expect(auth.entries.map((entry) => [entry.depth, entry.signature])).toEqual([
      [0, "class AuthService"],
      [1, "def login(self, email: str, password: str) -> bool"],
      [1, "def reset_password(self, email: str) -> str"],
    ])
    const api = files.find((file) => file.path === "web/api.ts")!
    expect(api.entries.map((entry) => entry.name)).toEqual(["User", "getUser", "add", "Client", "fetch"])
  })

  test("ranks used files first and query matches above them", async () => {
    const files = await OkuRepoMap.build(project(sample))
    expect(OkuRepoMap.rank(files)[0]!.path).toBe("app/db.py")
    expect(OkuRepoMap.rank(files, "client fetch")[0]!.path).toBe("web/api.ts")
    const map = await OkuRepoMap.long(project(sample), "password reset")
    expect(map.split("\n")[0]).toBe("app/auth.py")
    expect(map).toContain("def reset_password(self, email: str) -> str  (line 7)")
  })

  test("stays within the budget and skips folders without code", async () => {
    const files = await OkuRepoMap.build(project(sample))
    expect(OkuRepoMap.render(OkuRepoMap.rank(files), 60).length).toBeLessThanOrEqual(60 + 40)
    expect(await OkuRepoMap.short(project({ "notes.md": "hi", "a.py": "def f():\n  pass\n" }))).toBeUndefined()
    expect(await OkuRepoMap.short(project(sample))).toContain("class AuthService")
  })
  test("finds the files that match a request, by path words and content", async () => {
    const dir = project({
      ...sample,
      "app/settings/approval_mode.py": "def current_mode():\n    return 'ask'\n",
      "app/restart.py": "def restart():\n    pass\n",
    })
    spawnSync("git", ["init", "-q"], { cwd: dir })
    spawnSync("git", ["add", "."], { cwd: dir })
    expect(OkuRepoMap.search(dir, "where is the approval mode logic?")[0]).toBe("app/settings/approval_mode.py")
    expect(OkuRepoMap.search(dir, "where is the password reset code?")).toContain("app/auth.py")
    // Clear matches only: "rest" is not "restart", and general questions add nothing.
    expect(await OkuRepoMap.relevant(dir, "what is a REST API?")).toBeUndefined()
    expect(await OkuRepoMap.relevant(dir, "hi")).toBeUndefined()
    const found = await OkuRepoMap.relevant(dir, "where is the approval mode logic?")
    expect(found?.split("\n")[0]).toBe("app/settings/approval_mode.py")
    expect(found).toContain("def current_mode()  (line 1)")
  })
})
