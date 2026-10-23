import { describe, expect, test } from "bun:test"
import { OkuDocument } from "../src/okutobus/document"
import { OkuDocxRead } from "../src/okutobus/docx-read"

describe("OkuDocxRead.markdown", () => {
  test("reads back a document made by OkuCode", () => {
    const source = [
      "# Report",
      "",
      "Some **bold** and *italic* text.",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n")
    const md = OkuDocxRead.markdown(OkuDocument.docx(source, "Title"))
    expect(md).toContain("# Title")
    expect(md).toContain("# Report")
    expect(md).toContain("Some **bold** and *italic* text.")
    expect(md).toContain("- one\n- two")
    expect(md).toContain("1. first\n2. second")
    expect(md).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |")
  })

  test("rejects files that are not .docx", () => {
    expect(() => OkuDocxRead.markdown(new TextEncoder().encode("hello"))).toThrow()
  })
})
