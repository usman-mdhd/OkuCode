import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OkuCommit } from "../src/okutobus/commit"

const repo = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "oku-commit-"))
  const run = (...args: string[]) => spawnSync("git", args, { cwd: dir })
  run("init", "-q")
  run("config", "user.email", "t@t.t")
  run("config", "user.name", "T")
  return { dir, run }
}

describe("OkuCode /commit (FR-30)", () => {
  test("outside a repository it tells the user to run git init", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oku-norepo-"))
    expect(OkuCommit.changes(dir).type).toBe("not-a-repo")
    expect(OkuCommit.prompt(dir, "")).toContain("git init")
  })

  test("a clean repository has nothing to commit", () => {
    const { dir, run } = repo()
    writeFileSync(path.join(dir, "a.txt"), "a\n")
    run("add", "-A")
    run("commit", "-q", "-m", "first")
    expect(OkuCommit.changes(dir).type).toBe("clean")
    expect(OkuCommit.prompt(dir, "")).toContain("no changes to commit")
  })

  test("changed and new files are shown to the model with one git commit step", () => {
    const { dir, run } = repo()
    writeFileSync(path.join(dir, "a.txt"), "a\n")
    run("add", "-A")
    run("commit", "-q", "-m", "first")
    writeFileSync(path.join(dir, "a.txt"), "a\nb\n")
    writeFileSync(path.join(dir, "new.py"), "print(1)\n")
    const text = OkuCommit.prompt(dir, "mention the ticket OKU-12")
    expect(text).toContain("M a.txt")
    expect(text).toContain("?? new.py")
    expect(text).toContain("+b")
    expect(text).toContain("new file: new.py\nprint(1)")
    expect(text).toContain("OKU-12")
    expect(text).toContain('git add -A && git commit -m "<summary line>"')
  })

  test("works in a repository without any commits yet", () => {
    const { dir } = repo()
    writeFileSync(path.join(dir, "first.py"), "x = 1\n")
    const found = OkuCommit.changes(dir)
    expect(found.type).toBe("changes")
  })
})
