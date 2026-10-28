import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { hunkPatch, stageFile, stageHunk } from "../../src/util/okucode-stage"

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "oku-stage-"))
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" }).stdout
  git("init", "-q")
  git("config", "user.email", "t@t.t")
  git("config", "user.name", "T")
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
  writeFileSync(path.join(dir, "a.txt"), lines.join("\n") + "\n")
  git("add", "-A")
  git("commit", "-q", "-m", "first")
  // Two changes far apart -> two hunks.
  lines[1] = "line 2 CHANGED"
  lines[37] = "line 38 CHANGED"
  writeFileSync(path.join(dir, "a.txt"), lines.join("\n") + "\n")
  return { dir, git }
}

describe("OkuCode staging from the diff viewer (FR-29)", () => {
  test("stages only the selected hunk, and can unstage it again", () => {
    const { dir, git } = repo()
    const patch = git("diff", "--patch", "--no-ext-diff", "--no-renames", "--unified=3", "HEAD")
    expect(patch.match(/^@@/gm)).toHaveLength(2)
    expect(hunkPatch(patch, 1)).toContain("line 38 CHANGED")
    expect(hunkPatch(patch, 1)).not.toContain("line 2 CHANGED")

    const staged = stageHunk(dir, "a.txt", patch, 1)
    expect(staged).toEqual({ ok: true, message: "Staged change 2 in a.txt" })
    const cached = git("diff", "--cached")
    expect(cached).toContain("+line 38 CHANGED")
    expect(cached).not.toContain("+line 2 CHANGED")
    expect(git("diff")).toContain("+line 2 CHANGED")

    expect(stageHunk(dir, "a.txt", patch, 1).ok).toBe(false)
    expect(stageHunk(dir, "a.txt", patch, 1, true).ok).toBe(true)
    expect(git("diff", "--cached")).toBe("")
  })

  test("stages and unstages a whole file", () => {
    const { dir, git } = repo()
    expect(stageFile(dir, "a.txt").ok).toBe(true)
    expect(git("diff", "--cached")).toContain("line 2 CHANGED")
    expect(stageFile(dir, "a.txt", true).ok).toBe(true)
    expect(git("diff", "--cached")).toBe("")
  })

  test("explains a missing selection", () => {
    expect(stageHunk("/tmp", "a.txt", "", 3).ok).toBe(false)
  })
})
