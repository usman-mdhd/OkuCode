import { describe, expect, test } from "bun:test"
import { OkuNudge } from "@opencode/core/okutobus/nudge"

// Minimal message shapes; decide() only reads type, content parts and synthetic text.
const assistant = (text: string, tool = false) =>
  ({ type: "assistant", content: [{ type: "text", text }, ...(tool ? [{ type: "tool" }] : [])] }) as never
const user = () => ({ type: "user", text: "hi" }) as never
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
})
