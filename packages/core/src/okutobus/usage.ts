export * as OkuUsage from "./usage.js"

// Okutobus (OkuCode) SRS FR-58: one usage line per model call (see @opencode/util/usage-log).
// "usage": false in okucode.json stops recording.

import { readFileSync } from "node:fs"
import { UsageLog } from "@opencode/util/usage-log"
import { OkuApproval } from "./approval.js"

export const enabled = () => {
  try {
    return (JSON.parse(readFileSync(OkuApproval.settingsFile(), "utf8")) as { usage?: unknown }).usage !== false
  } catch {
    return true
  }
}

type Tokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } }

export function record(input: {
  sessionID: string
  directory?: string
  provider: string
  model: string
  tokens: Tokens
  cost: number
  ms: number
}) {
  if (!enabled()) return
  UsageLog.record({
    time: new Date().toISOString(),
    sessionID: input.sessionID,
    ...(input.directory ? { directory: input.directory } : {}),
    provider: input.provider,
    model: input.model,
    input: input.tokens.input,
    output: input.tokens.output,
    reasoning: input.tokens.reasoning,
    cacheRead: input.tokens.cache.read,
    cacheWrite: input.tokens.cache.write,
    cost: Number(input.cost) || 0,
    ms: Math.max(0, Math.round(input.ms)),
  })
}
