import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OkuLsp } from "../src/okutobus/lsp.js"

const has = (command: string) => spawnSync("which", [command]).status === 0

afterAll(() => OkuLsp.stopAll())

describe("OkuCode code errors after edits (FR-17)", () => {
  test("syntax errors without a language server", () => {
    expect(OkuLsp.syntax("a.json", '{"a": 1,}')[0]?.message).toBeTruthy()
    expect(OkuLsp.syntax("a.json", '{"a": 1}')).toEqual([])
    const ts = OkuLsp.syntax("a.ts", "const x: number = \nfunction (")
    expect(ts.length).toBeGreaterThan(0)
    expect(ts[0]!.range.start.line).toBeGreaterThanOrEqual(0)
    expect(OkuLsp.syntax("a.ts", "export const x: number = 1\n")).toEqual([])
    if (has("python3")) {
      expect(OkuLsp.syntax("a.py", "def f(:\n    pass\n")[0]?.range.start.line).toBe(0)
      expect(OkuLsp.syntax("a.py", "def f():\n    pass\n")).toEqual([])
    }
  })

  test("report tells the model what to fix", () => {
    const text = OkuLsp.report([
      {
        range: { start: { line: 3, character: 4 }, end: { line: 3, character: 8 } },
        message: "Cannot find name 'totl'.",
        severity: 1,
      },
    ])
    expect(text).toContain("line 4:5: Cannot find name 'totl'.")
    expect(OkuLsp.report([])).toBe("")
  })

  test.skipIf(!has("pyright-langserver"))(
    "type errors from the Python language server",
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "oku-lsp-py-"))
      const file = path.join(dir, "calc.py")
      writeFileSync(file, "def total(items: list[int]) -> int:\n    return sum(items)\n\nprint(totl([1, 2]))\n")
      const found = await OkuLsp.check(file, dir, 30_000)
      expect(found.some((item) => /totl/.test(item.message))).toBe(true)
      writeFileSync(file, "def total(items: list[int]) -> int:\n    return sum(items)\n\nprint(total([1, 2]))\n")
      expect(await OkuLsp.check(file, dir, 30_000)).toEqual([])
    },
    70_000,
  )

  test.skipIf(!has("typescript-language-server"))(
    "type errors from the TypeScript language server",
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "oku-lsp-ts-"))
      const file = path.join(dir, "index.ts")
      writeFileSync(file, "const count: number = 'three'\nexport { count }\n")
      const found = await OkuLsp.check(file, dir, 30_000)
      expect(found.some((item) => /not assignable/.test(item.message))).toBe(true)
    },
    70_000,
  )
})
