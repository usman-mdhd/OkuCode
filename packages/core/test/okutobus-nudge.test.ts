import { describe, expect, test } from "bun:test"
import { OkuNudge } from "@opencode/core/okutobus/nudge"

// Minimal message shapes; decide() only reads type, content parts and synthetic text.
const assistant = (text: string, tool = false) =>
  ({ type: "assistant", content: [{ type: "text", text }, ...(tool ? [{ type: "tool" }] : [])] }) as never
const user = (text = "add the python code to the document") => ({ type: "user", text }) as never
const used = (name: string) => ({ type: "assistant", content: [{ type: "tool", name }] }) as never
const synthetic = (text: string) => ({ type: "synthetic", text }) as never

describe("Okutobus nudge", () => {
  test("reminds once when the model only announced an action", () => {
    const said = assistant("Understood. I'll add the Python code to the document now.")
    expect(OkuNudge.decide([said, user()])).toBe(OkuNudge.TEXT)
    expect(OkuNudge.decide([said, synthetic(OkuNudge.TEXT), assistant("I'll add it."), user()])).toBeUndefined()
  })

  test("reminds when the model pasted the file content instead of saving it", () => {
    expect(OkuNudge.decide([assistant("Here is the document LLM.docx:\n```markdown\n# LLM\n```"), user()])).toBe(OkuNudge.TEXT)
  })

  test("leaves normal answers and real tool calls alone", () => {
    expect(OkuNudge.decide([assistant("React is a library and Angular is a framework."), user()])).toBeUndefined()
    expect(OkuNudge.decide([assistant("I'll run the tests.", true), user()])).toBeUndefined()
  })

  test("no reminder when a tool already did the work earlier in this turn", () => {
    expect(OkuNudge.decide([assistant("I have created a file named test2.py."), used("write"), user()])).toBeUndefined()
    expect(OkuNudge.decide([assistant("Understood. I'll list the files."), used("glob"), user()])).toBeUndefined()
    // Only reading is not doing: "I'll update it" after a read still gets the reminder.
    expect(OkuNudge.decide([assistant("I'll update the file now."), used("read"), user()])).toBe(OkuNudge.TEXT)
  })
  test("no reminder after a plain question, even when the answer ends with 'let me know' or talks about creating", () => {
    const answer = assistant(
      "Here is another example: a blog API for creating, updating and deleting posts.\n```json\n{\"id\": 1}\n```\nIf you need an example in a specific language, let me know!",
    )
    expect(OkuNudge.decide([answer, user("give me another example")])).toBeUndefined()
    expect(OkuNudge.decide([assistant("I'll create the report now."), user("what is a REST API?")])).toBeUndefined()
    expect(OkuNudge.decide([assistant("Sure, let me know!"), user("create report.docx")])).toBeUndefined()
  })

  test("still reminds after a request or a yes to an offer", () => {
    expect(OkuNudge.decide([assistant("Sure, I will now create the Word file."), user("make a word file about REST")])).toBe(OkuNudge.TEXT)
    expect(OkuNudge.decide([assistant("Okay, I'll save it as notes.docx."), user("yes")])).toBe(OkuNudge.TEXT)
  })
})
