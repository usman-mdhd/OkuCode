import { describe, expect, test } from "bun:test"
import { planReady } from "./plan-ready"

describe("planReady", () => {
  test("only a finished Plan-mode reply can be approved", () => {
    expect(planReady([{ type: "user" }, { type: "assistant", agent: "plan" }])).toBe(true)
    expect(planReady([{ type: "user" }, { type: "assistant", agent: "okucode" }])).toBe(false)
    expect(planReady([{ type: "assistant", agent: "plan" }, { type: "user" }])).toBe(false)
    expect(planReady([{ type: "user" }, { type: "assistant", agent: "plan" }, { type: "agent-switched" }])).toBe(true)
    expect(planReady([])).toBe(false)
  })
})
