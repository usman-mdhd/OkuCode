import { describe, expect, test } from "bun:test"
import { unfenceTables } from "./markdown-unfence-tables"

describe("Okutobus unfenceTables", () => {
  test("removes a plain fence around a Markdown table", () => {
    const text = "Here:\n\n```\nReact vs Angular\n\n| Feature | React |\n|---|---|\n| Type | Library |\n```\n\nDone."
    expect(unfenceTables(text)).toBe("Here:\n\n\nReact vs Angular\n\n| Feature | React |\n|---|---|\n| Type | Library |\n\n\nDone.")
  })

  test("also handles ```markdown fences and long separators", () => {
    const text = "```markdown\n| A | B |\n|-------------|:----:|\n| 1 | 2 |\n```"
    expect(unfenceTables(text)).toBe("\n| A | B |\n|-------------|:----:|\n| 1 | 2 |\n")
  })

  test("keeps real code blocks and unclosed fences unchanged", () => {
    const code = "```python\nprint('| a | b |')\n# |---|---|\n```"
    expect(unfenceTables(code)).toBe(code)
    const plain = "```\nls -la | grep x\n```"
    expect(unfenceTables(plain)).toBe(plain)
    const streaming = "```\n| A | B |\n|---|---|\n| 1 | 2"
    expect(unfenceTables(streaming)).toBe(streaming)
  })
})
