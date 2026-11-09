export * as OkuFallback from "./fallback.js"

// Okutobus (OkuCode) SRS FR-47: model fallback chain.
//
// okucode.json "fallbackModels": ["ollama/qwen2.5-coder-7b-16k", "gateway/okucode-main"]
//
// When the chat's model cannot answer — Ollama or the server is not running, the model is missing, the key is wrong,
// or it keeps failing after the normal retries (busy, rate limit, server error, timeout) — OkuCode switches that chat
// to the next model in the list that is set up, says so in the chat, and sends the same request again. A model that
// already failed in this answer is not tried again. New chats still start on the default model.

import { readFileSync } from "node:fs"
import { OkuApproval } from "./approval.js"

export function chain(): string[] {
  try {
    const value = (JSON.parse(readFileSync(OkuApproval.settingsFile(), "utf8")) as { fallbackModels?: unknown })
      .fallbackModels
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is string => typeof item === "string" && /^[^/\s]+\/\S+$/.test(item.trim()))
      .map((item) => item.trim())
  } catch {
    return []
  }
}

type Reason = { readonly _tag: string; readonly message?: string }

/** Failures where waiting and retrying the same model will not help: switch right away. */
const NOW = new Set(["Transport", "NoRoute", "Authentication", "UnknownProvider"])
/** Failures that may pass: switch only after the normal retries are used up. */
const AFTER_RETRIES = new Set(["RateLimit", "QuotaExceeded", "ProviderInternal", "Timeout"])

const MISSING_MODEL =
  /\bmodel\b[^\n]{0,80}\b(?:not\s+found|does\s+not\s+exist|not\s+available|unknown|no\s+such)\b|\bnot\s+found\b[^.\n]{0,40}\bmodel\b/i

/** "now", "after-retries" or undefined (do not fall back: content policy, bad output, context too long, cancelled). */
export function when(reason: Reason): "now" | "after-retries" | undefined {
  if (NOW.has(reason._tag)) return "now"
  if (AFTER_RETRIES.has(reason._tag)) return "after-retries"
  if (reason._tag === "InvalidRequest" && MISSING_MODEL.test(reason.message ?? "")) return "now"
  return undefined
}

/** The next model to try after `current`, skipping models that already failed. */
export function next(current: string, failed: ReadonlySet<string>, list = chain()): string | undefined {
  const at = list.indexOf(current)
  const ordered = at === -1 ? list : [...list.slice(at + 1), ...list.slice(0, at)]
  return ordered.find((model) => model !== current && !failed.has(model))
}

export const ref = (model: { readonly providerID: string; readonly id: string }) => `${model.providerID}/${model.id}`

export function notice(from: string, to: string, problem: string) {
  return `${from} could not answer (${problem.replace(/\s+/g, " ").trim().slice(0, 160)}). OkuCode switched this chat to ${to} and is trying again.`
}
