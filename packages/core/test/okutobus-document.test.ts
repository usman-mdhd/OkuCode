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

describe("Okutobus built-in PDF", () => {
  test("writes a valid PDF without extra software", async () => {
    const { OkuPdf } = await import("@opencode/core/okutobus/pdf")
    const bytes = OkuPdf.pdf("# Hi\n\n- a\n- b\n\n| A | B |\n|---|---|\n| 1 | 2 |", "Report")
    const text = new TextDecoder("latin1").decode(bytes)
    expect(text.startsWith("%PDF-1.4")).toBe(true)
    expect(text).toContain("/BaseFont /Helvetica")
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true)
    expect(DocumentTool.render("a.pdf", "# Hi")).toBeInstanceOf(Uint8Array)
  })
})

describe("OkuDocument.merge and tables", () => {
  test("a section with an existing heading replaces it", () => {
    const base = "# Report\n\nIntro.\n\n## Next steps\n\nShip the Word plugin.\n\n## Team\n\nUsman."
    expect(OkuDocument.merge(base, "## Next steps\n\nWe will ship it this week.")).toBe(
      "# Report\n\nIntro.\n\n## Next steps\n\nWe will ship it this week.\n\n## Team\n\nUsman.\n",
    )
    expect(OkuDocument.merge(base, "## Budget\n\nSmall.")).toContain("## Team\n\nUsman.\n\n## Budget\n\nSmall.")
  })

  test("\\| stays inside a table cell", () => {
    const [table] = OkuDocument.parse("| Name | Role |\n| --- | --- |\n| Usman | Dev \\| Ops |")
    if (table?.type !== "table") throw new Error("expected a table")
    expect(table.rows[0]!.map((cell) => cell.map((part) => part.text).join(""))).toEqual(["Usman", "Dev | Ops"])
  })
})
