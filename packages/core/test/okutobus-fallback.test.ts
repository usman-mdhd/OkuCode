import { describe, expect, test } from "bun:test"
import { OkuFallback } from "../src/okutobus/fallback.js"

describe("OkuCode model fallback chain (FR-47)", () => {
  test("switches right away when the model cannot be reached, after retries when it is busy", () => {
    expect(OkuFallback.when({ _tag: "Transport", message: "connect ECONNREFUSED" })).toBe("now")
    expect(OkuFallback.when({ _tag: "Authentication" })).toBe("now")
    expect(
      OkuFallback.when({
        _tag: "InvalidRequest",
        message: 'model "qwen2.5-coder:32b" not found, try pulling it first',
      }),
    ).toBe("now")
    expect(OkuFallback.when({ _tag: "RateLimit" })).toBe("after-retries")
    expect(OkuFallback.when({ _tag: "ProviderInternal" })).toBe("after-retries")
    // Not the model's fault: switching would not help.
    expect(OkuFallback.when({ _tag: "ContentPolicy" })).toBeUndefined()
    expect(OkuFallback.when({ _tag: "InvalidRequest", message: "messages: field required" })).toBeUndefined()
    expect(OkuFallback.when({ _tag: "InvalidProviderOutput" })).toBeUndefined()
  })

  test("picks the next model in the list and never one that already failed", () => {
    const list = ["ollama/qwen-14b", "ollama/qwen-7b", "gateway/okucode-main"]
    expect(OkuFallback.next("ollama/qwen-14b", new Set(), list)).toBe("ollama/qwen-7b")
    expect(OkuFallback.next("ollama/qwen-7b", new Set(["ollama/qwen-14b"]), list)).toBe("gateway/okucode-main")
    expect(
      OkuFallback.next("gateway/okucode-main", new Set(["ollama/qwen-14b", "ollama/qwen-7b"]), list),
    ).toBeUndefined()
    // A chat on a model that is not in the list starts at the top.
    expect(OkuFallback.next("mock/other", new Set(), list)).toBe("ollama/qwen-14b")
    expect(OkuFallback.next("ollama/qwen-14b", new Set(), [])).toBeUndefined()
  })

  test("tells the person what happened", () => {
    expect(OkuFallback.notice("ollama/qwen-14b", "ollama/qwen-7b", "Cannot connect to API: ECONNREFUSED")).toBe(
      "ollama/qwen-14b could not answer (Cannot connect to API: ECONNREFUSED). OkuCode switched this chat to ollama/qwen-7b and is trying again.",
    )
  })
})
