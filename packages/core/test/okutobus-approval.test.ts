import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OkuApproval } from "../src/okutobus/approval"

describe("OkuCode approval modes (FR-22)", () => {
  test("ask every time: edits and commands ask unless the user chose Always", () => {
    expect(OkuApproval.apply("allow", "edit", "ask", false)).toBe("ask")
    expect(OkuApproval.apply("allow", "shell", "ask", false)).toBe("ask")
    expect(OkuApproval.apply("ask", "edit", "ask", true)).toBe("allow")
  })

  test("auto-edit: edits go ahead, commands ask", () => {
    expect(OkuApproval.apply("ask", "edit", "auto-edit", false)).toBe("allow")
    expect(OkuApproval.apply("allow", "shell", "auto-edit", false)).toBe("ask")
  })

  test("full-auto: edits and commands go ahead", () => {
    expect(OkuApproval.apply("ask", "edit", "full-auto", false)).toBe("allow")
    expect(OkuApproval.apply("ask", "shell", "full-auto", false)).toBe("allow")
  })

  test("other actions and no mode keep OpenCode's own answer", () => {
    expect(OkuApproval.apply("ask", "read", "full-auto", false)).toBe("ask")
    expect(OkuApproval.apply("ask", "edit", undefined, false)).toBe("ask")
  })

  test("reads the mode from okucode.json; missing or unknown means not chosen", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oku-approval-"))
    const file = path.join(dir, "okucode.json")
    expect(OkuApproval.mode(file)).toBeUndefined()
    writeFileSync(file, JSON.stringify({ approvalMode: "full-auto", google: {} }))
    expect(OkuApproval.mode(file)).toBe("full-auto")
    writeFileSync(file, JSON.stringify({ approvalMode: "yolo" }))
    // A changed file is re-read (mtime may be equal within the same millisecond, so force a different one).
    const later = new Date(Date.now() + 5000)
    require("node:fs").utimesSync(file, later, later)
    expect(OkuApproval.mode(file)).toBeUndefined()
  })
})
