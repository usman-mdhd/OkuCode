import { describe, expect, test } from "bun:test"
import { OkuRouting } from "@opencode/core/okutobus/routing"

const user = (text: string) => ({ type: "user", text }) as never
const assistant = (tool = false) =>
  ({ type: "assistant", content: [{ type: "text", text: "ok" }, ...(tool ? [{ type: "tool", name: "read" }] : [])] }) as never
const on = { smallModel: "ollama/qwen2.5-coder:3b" }

describe("Okutobus routing (FR-46)", () => {
  test("reads the small model", () => {
    expect(OkuRouting.smallModel("ollama/qwen2.5-coder:3b")).toEqual({ providerID: "ollama", id: "qwen2.5-coder:3b" })
    expect(OkuRouting.smallModel("qwen")).toBeUndefined()
    expect(OkuRouting.smallModel(undefined)).toBeUndefined()
  })

  test("short general questions are simple", () => {
    for (const text of ["What is a REST API?", "hi", "explain recursion", "difference between let and const?", "Thanks!", '"What is a REST API?"'])
      expect(OkuRouting.simple(text)).toBe(true)
  })

  test("work and questions about the project stay on the main model", () => {
    for (const text of [
      "create hello.py",
      "fix the bug in calc.py",
      "what is the tech stack of this project?",
      "how does src/app.ts work?",
      "run the tests",
      "what does @calc.py do?",
      "The login page is broken",
      "how do I sort a list\nin python",
    ])
      expect(OkuRouting.simple(text)).toBe(false)
  })

  test("the small model answers until a tool runs", () => {
    expect(OkuRouting.useSmall([user("What is a REST API?")], on)).toBe(true)
    expect(OkuRouting.useSmall([assistant(), user("What is a REST API?")], on)).toBe(true)
    expect(OkuRouting.useSmall([assistant(true), user("What is a REST API?")], on)).toBe(false)
    expect(OkuRouting.useSmall([user("What is a REST API?")], { ...on, routing: false })).toBe(false)
    expect(OkuRouting.useSmall([user("What is a REST API?")], {})).toBe(false)
    expect(OkuRouting.useSmall([user("create hello.py")], on)).toBe(false)
  })
})
