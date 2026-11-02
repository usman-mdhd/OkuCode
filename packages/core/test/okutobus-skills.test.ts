import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OkuSkills } from "@opencode/core/okutobus/skills"

const file = (value: unknown) => {
  const target = path.join(mkdtempSync(path.join(tmpdir(), "oku-skills-")), "okucode.json")
  writeFileSync(target, JSON.stringify(value))
  return target
}

describe("Okutobus skill switches", () => {
  test("reads the switched-off skills", () => {
    expect([...OkuSkills.disabled(file({ disabledSkills: ["docx", 3, "pdf"] }))]).toEqual(["docx", "pdf"])
    expect(OkuSkills.disabled(file({})).size).toBe(0)
    expect(OkuSkills.disabled(path.join(tmpdir(), "missing-okucode.json")).size).toBe(0)
  })

  test("a skill is off by its id or its name", () => {
    const off = new Set(["docx"])
    expect(OkuSkills.enabled({ id: "docx", name: "Word" }, off)).toBe(false)
    expect(OkuSkills.enabled({ id: "skills/word", name: "docx" }, off)).toBe(false)
    expect(OkuSkills.enabled({ id: "pdf", name: "pdf" }, off)).toBe(true)
  })
})
