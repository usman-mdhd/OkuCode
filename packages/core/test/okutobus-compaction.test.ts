import { describe, expect, test } from "bun:test"
import { headingName } from "@opencode/core/session/compaction"

describe("Okutobus compaction (FR-05)", () => {
  test("summary headings count however a small model marks them up", () => {
    for (const line of ["## Objective", "**Objective**", "Objective:", "**Objective:**", "### objective", "  ## Objective  "])
      expect(headingName(line)).toBe("objective")
    expect(headingName("## Work State")).toBe("work state")
    expect(headingName("We talked about testing.")).not.toBe("objective")
  })
})
