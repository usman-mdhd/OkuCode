import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OkuMemory } from "../src/okutobus/memory"

const dir = () => mkdtempSync(path.join(tmpdir(), "oku-memory-"))

describe("OkuCode # memory shortcut", () => {
  test("only a single '# rule' line is a rule", () => {
    expect(OkuMemory.rule("# always use tabs")).toBe("always use tabs")
    expect(OkuMemory.rule("  #   reply in English  ")).toBe("reply in English")
    expect(OkuMemory.rule("## Heading")).toBeUndefined()
    expect(OkuMemory.rule("#hashtag")).toBeUndefined()
    expect(OkuMemory.rule("# title\nmore text")).toBeUndefined()
    expect(OkuMemory.rule("fix the # in line 3")).toBeUndefined()
  })

  test("creates OKUCODE.md, appends rules once, and the model only confirms", () => {
    const d = dir()
    const text = OkuMemory.handle("# always use tabs", d)!
    OkuMemory.handle("# always use tabs", d)
    OkuMemory.handle("# write tests with bun", d)
    const content = readFileSync(path.join(d, "OKUCODE.md"), "utf8")
    expect(content).toContain("# OkuCode memory")
    expect(content.match(/- always use tabs/g)).toHaveLength(1)
    expect(content).toContain("- write tests with bun\n")
    expect(text.startsWith("# always use tabs\n\n(OkuCode saved this rule")).toBe(true)
    expect(text).toContain("OKUCODE.md")
    expect(OkuMemory.handle("explain this code", d)).toBeUndefined()
  })

  test("uses an existing AGENTS.md when there is no OKUCODE.md", () => {
    const d = dir()
    writeFileSync(path.join(d, "AGENTS.md"), "Project rules")
    OkuMemory.handle("# no semicolons", d)
    expect(readFileSync(path.join(d, "AGENTS.md"), "utf8")).toBe("Project rules\n- no semicolons\n")
  })
})
