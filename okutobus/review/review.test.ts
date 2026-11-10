import { describe, expect, test } from "bun:test"
import { model, parseArgs, worst } from "./review.ts"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

describe("okucode review (FR-32)", () => {
  test("finds the most serious issue in the review", () => {
    const review =
      "## Summary\nx\n\n## Issues\n1. **low** `a.py:1` name\n2. **high** `a.py:4` crash\n\n## Verdict\nChanges needed"
    expect(worst(review)).toBe("high")
    expect(worst("## Issues\nNo issues found.\n\n## Verdict\nLooks good to merge")).toBeUndefined()
    // "high" in the summary is not an issue.
    expect(worst("## Summary\nHandles high load.\n\n## Issues\n1. **medium** `b.ts:2` no test\n")).toBe("medium")
  })

  test("reads options and GitHub Actions variables", () => {
    const options = parseArgs(["--pr", "12", "--post", "--fail-on", "high"], {
      GITHUB_BASE_REF: "develop",
      GITHUB_REPOSITORY: "o/r",
    })
    expect(options).toMatchObject({ pr: 12, post: true, failOn: "high", base: "develop", repo: "o/r" })
  })

  test("uses OkuCode's default model and its provider when no model is given", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "oku-review-")), "opencode.json")
    writeFileSync(
      file,
      JSON.stringify({
        model: "gateway/okucode-main",
        provider: { gateway: { options: { baseURL: "https://gw.example.com/v1/", apiKey: "sk-test" } } },
      }),
    )
    expect(model({}, file)).toEqual({ url: "https://gw.example.com/v1", model: "okucode-main", key: "sk-test" })
    expect(model({ url: "http://x/v1", model: "m" }, file)).toEqual({ url: "http://x/v1", model: "m", key: undefined })
  })
})
