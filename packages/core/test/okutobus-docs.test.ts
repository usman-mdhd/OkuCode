import { describe, expect, test } from "bun:test"
import { OkuDocs } from "@opencode/core/okutobus/docs"

const user = (text: string) => ({ type: "user", text }) as never
const assistant = (text: string) => ({ type: "assistant", content: [{ type: "text", text }] }) as never

describe("Okutobus document tool only when a file is asked for", () => {
  test("asks for a file", () => {
    expect(OkuDocs.fileRequested([user("make a word file of the last example")])).toBe(true)
    expect(OkuDocs.fileRequested([user("what is a REST API?"), assistant("..."), user("save it as a PDF")])).toBe(true)
  })

  test("questions and examples do not", () => {
    expect(OkuDocs.fileRequested([user("make a pdf"), assistant("Done."), user("give me another example")])).toBe(false)
    expect(OkuDocs.fileRequested([user("can you give an example of that?")])).toBe(false)
    expect(OkuDocs.fileRequested([])).toBe(false)
  })

  test("yes to an offer of a file", () => {
    expect(OkuDocs.fileRequested([user("explain REST"), assistant("Shall I put this in a Word file?"), user("yes please")])).toBe(true)
    expect(OkuDocs.fileRequested([user("explain REST"), assistant("Want another example?"), user("yes")])).toBe(false)
  })
})
