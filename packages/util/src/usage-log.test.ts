import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { UsageLog } from "./usage-log"

const call = (over: Partial<UsageLog.Entry>): UsageLog.Entry => ({
  time: "2026-11-04T10:00:00.000Z",
  sessionID: "ses_a",
  provider: "ollama",
  model: "qwen2.5-coder-14b-16k",
  input: 1000,
  output: 500,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  ms: 1_800_000,
  ...over,
})

describe("OkuCode usage log (FR-58)", () => {
  test("records model calls by month and reads them back from a date", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oku-usage-"))
    UsageLog.record(call({ time: "2026-10-31T23:00:00.000Z" }), dir)
    UsageLog.record(call({}), dir)
    expect(UsageLog.read("2026-11-01T00:00:00.000Z", dir)).toHaveLength(1)
    expect(UsageLog.read("2026-10-01T00:00:00.000Z", dir)).toHaveLength(2)
  })

  test("sums tokens, GPU time and cost per person, model and day", () => {
    const summary = UsageLog.summarize(
      [
        call({}),
        call({ sessionID: "ses_b", provider: "anthropic", model: "claude", cost: 0.25, ms: 5000 }),
        call({ time: "2026-11-03T09:00:00.000Z", output: 2000 }),
      ],
      { ses_a: "usman@okutobus.com" },
    )
    expect(summary.total).toMatchObject({ calls: 3, input: 3000, output: 3000, cost: 0.25 })
    // Local calls (no API cost) count as GPU time: 2 × 30 minutes.
    expect(summary.total.gpuHours).toBeCloseTo(1)
    // 3000 in × $3 + 3000 out × $15 per million.
    expect(summary.total.equivalent).toBeCloseTo(0.054)
    expect(summary.byUser.map((row) => [row.user, row.totals.calls])).toEqual([
      ["usman@okutobus.com", 2],
      ["owner", 1],
    ])
    expect(summary.byModel[0]!.model).toBe("ollama/qwen2.5-coder-14b-16k")
    expect(summary.byDay.map((row) => row.day)).toEqual(["2026-11-04", "2026-11-03"])
  })
})
