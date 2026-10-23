import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { OkuDocument } from "../src/okutobus/document"
import { OkuMentions } from "../src/okutobus/mentions"

describe("OkuMentions.parse", () => {
  test("reads @file and @file#L5-11", () => {
    expect(OkuMentions.parse("@calculator.py#L5-11 find bugs")).toEqual([{ file: "calculator.py", start: 5, end: 11 }])
    expect(OkuMentions.parse("explain @src/app.ts")).toEqual([{ file: "src/app.ts", start: undefined, end: undefined }])
    expect(OkuMentions.parse("look at @a.py#L3")).toEqual([{ file: "a.py", start: 3, end: 3 }])
  })

  test("reads plain file names and line ranges", () => {
    expect(OkuMentions.parse("Review the code in calculator.py and list the problems")).toEqual([
      { file: "calculator.py", start: undefined, end: undefined },
    ])
    expect(OkuMentions.parse("Read calculator.py lines 5-11, then find bugs")).toEqual([
      { file: "calculator.py", start: 5, end: 11 },
    ])
    expect(OkuMentions.parse("fix fact.py line 2.")).toEqual([{ file: "fact.py", start: 2, end: 2 }])
  })

  test("ignores version numbers", () => {
    expect(OkuMentions.parse("version 1.2 and 3.10")).toEqual([])
  })
})

describe("OkuMentions.attachments", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "oku-mentions-"))
  writeFileSync(path.join(dir, "calculator.py"), "a\nb\nc\n")
  mkdirSync(path.join(dir, "src"))
  writeFileSync(path.join(dir, "src", "app.ts"), "x")
  writeFileSync(path.join(dir, "big.txt"), "x".repeat(OkuMentions.MAX_BYTES + 1))
  writeFileSync(path.join(dir, "long.py"), "x = 1\n".repeat(OkuMentions.WHOLE_BYTES / 4))

  test("sends small files whole and points out the named lines", () => {
    const list = OkuMentions.attachments("@calculator.py#L2-3 and src/app.ts", dir)
    expect(list.map((item) => item.name)).toEqual(["calculator.py", path.join("src", "app.ts")])
    expect(new URL(list[0]!.uri).search).toBe("")
    expect(list[0]!.description).toBe("The whole file. The user is asking about lines 2-3.")
  })

  test("sends only the named lines of long files, with a warning", () => {
    const [item] = OkuMentions.attachments("long.py lines 5-11", dir)
    expect(item!.name).toBe("long.py (lines 5-11)")
    expect(new URL(item!.uri).searchParams.get("start")).toBe("5")
    expect(item!.description).toContain("never write the whole file")
  })

  test("sends Word files as Markdown", () => {
    writeFileSync(path.join(dir, "report.docx"), OkuDocument.docx("# Plan\n\nShip it."))
    const [item] = OkuMentions.attachments("fix the typos in report.docx", dir)
    expect(item!.name).toBe("report.docx")
    expect(Buffer.from(item!.uri.split(",")[1]!, "base64").toString()).toBe("# Plan\n\nShip it.\n")
    expect(item!.description).toContain("document tool")
  })

  test("skips missing, too big, outside and already attached files", () => {
    const attached = [pathToFileURL(path.join(dir, "calculator.py")).href]
    expect(OkuMentions.attachments("calculator.py missing.py big.txt @../../etc/hosts.txt", dir, attached)).toEqual([])
    expect(OkuMentions.attachments("e.g. see http://example.com/page or mail me@example.com", dir)).toEqual([])
  })
})
