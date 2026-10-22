import { describe, expect, test } from "bun:test"
import { OkuDocument } from "@opencode/core/okutobus/document"
import { DocumentTool } from "@opencode/core/tool/plugin/document"

describe("Okutobus document files", () => {
  test("parses headings, lists, tables and code", () => {
    const blocks = OkuDocument.parse("# Title\n\nSome **bold** text.\n\n- a\n- b\n\n1. one\n2. two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\nx = 1\n```")
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "list", "list", "table", "code"])
    expect(OkuDocument.inline("a **b** *c* `d`")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", code: true },
    ])
  })

  test("builds a .docx zip with the Word parts", () => {
    const bytes = OkuDocument.docx("# Hello\n\nWorld & <friends>", "Report")
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain("word/document.xml")
    expect(text).toContain("World &amp; &lt;friends&gt;")
    expect(text).toContain('w:val="Title"')
  })

  test("picks the format from the file extension", () => {
    expect(typeof DocumentTool.render("a.html", "# Hi")).toBe("string")
    expect(DocumentTool.render("a.docx", "# Hi")).toBeInstanceOf(Uint8Array)
    expect(DocumentTool.render("a.md", "Hi", "T")).toBe("# T\n\nHi")
    expect(() => DocumentTool.render("a.xyz", "Hi")).toThrow(/Unsupported/)
  })
})
