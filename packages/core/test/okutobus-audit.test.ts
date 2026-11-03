import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OkuAudit } from "@opencode/core/okutobus/audit"

let dir = ""
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "oku-audit-"))
  process.env.OKUCODE_AUDIT_DIR = dir
  OkuAudit.reset()
})
afterEach(() => {
  delete process.env.OKUCODE_AUDIT_DIR
  OkuAudit.reset()
})

const day = new Date("2026-11-03T10:00:00Z")

describe("Okutobus audit log (FR-60)", () => {
  test("records prompts, tool calls and file changes as a hash chain", () => {
    OkuAudit.record("prompt", { text: "fix the bug" }, { sessionID: "ses_1", directory: "/p" }, day)
    OkuAudit.record("tool", { tool: "edit", input: { path: "a.py" }, status: "completed" }, { sessionID: "ses_1" }, day)
    OkuAudit.record("file", OkuAudit.fileChange("/p/a.py", "changed", new TextEncoder().encode("x = 1\n")), {}, day)
    const lines = readFileSync(path.join(dir, "2026-11-03.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(lines.map((line) => [line.seq, line.kind])).toEqual([[1, "prompt"], [2, "tool"], [3, "file"]])
    expect(lines[1].prev).toBe(lines[0].hash)
    expect(lines[2].data.sha256).toHaveLength(64)
    expect(OkuAudit.verify(dir)).toMatchObject({ ok: true, entries: 3, files: 1 })
  })

  test("the chain continues across days and after a restart", () => {
    OkuAudit.record("prompt", { text: "one" }, {}, day)
    OkuAudit.reset()
    OkuAudit.record("prompt", { text: "two" }, {}, new Date("2026-11-04T09:00:00Z"))
    expect(OkuAudit.verify(dir)).toMatchObject({ ok: true, entries: 2, files: 2 })
  })

  test("finds a changed, removed or reordered entry", () => {
    for (const text of ["a", "b", "c"]) OkuAudit.record("prompt", { text }, {}, day)
    const file = path.join(dir, "2026-11-03.jsonl")
    const original = readFileSync(file, "utf8")
    writeFileSync(file, original.replace('"text":"b"', '"text":"B"'))
    expect(OkuAudit.verify(dir).problem).toEqual({ file: "2026-11-03.jsonl", line: 2, reason: "the entry was changed (its hash does not match)" })
    const [a, , c] = original.trim().split("\n")
    writeFileSync(file, `${a}\n${c}\n`)
    expect(OkuAudit.verify(dir).problem?.reason).toBe("an entry before this one was removed or changed")
  })

  test("redacts secrets and cuts long text", () => {
    const entry = OkuAudit.record("prompt", { text: `key sk-proj-${"a".repeat(40)} ${"x".repeat(5000)}` }, {}, day)!
    expect(String(entry.data.text)).not.toContain("sk-proj-aaaa")
    expect(String(entry.data.text)).toContain("more characters]")
  })

  test("deletes files older than the retention period", () => {
    OkuAudit.record("prompt", { text: "old" }, {}, new Date("2026-01-01T00:00:00Z"))
    OkuAudit.reset()
    OkuAudit.record("prompt", { text: "new" }, {}, day)
    expect(OkuAudit.files(dir)).toEqual(["2026-11-03.jsonl"])
    expect(OkuAudit.verify(dir).ok).toBe(true)
  })
})
