export * as UsageLog from "./usage-log.js"

// Okutobus (OkuCode) SRS FR-58: usage and cost metering per user, team and model.
//
// Core writes one JSON line per model call to <data>/usage/YYYY-MM.jsonl: the model, tokens in and out, the API cost
// (0 for local models) and how long the model worked. The web server joins these with who sent each chat
// (sessions.json, written when a signed-in person sends a message) and sums them per person, model and day:
//   tokens          input, output, cached
//   GPU hours       time local models (no API cost, e.g. Ollama on the L4) spent answering
//   API cost        what paid API models actually cost
//   equivalent cost what the same tokens would cost on a paid API (price per million tokens, okucode.json
//                   "usagePrice": { "input": 3, "output": 15, "cacheRead": 0.3 }; default: Claude Sonnet list price)
// "usage": false in okucode.json stops recording.

import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { Global } from "./global.js"

export type Entry = {
  readonly time: string
  readonly sessionID: string
  readonly directory?: string
  readonly provider: string
  readonly model: string
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
  /** API cost in USD (0 for local models). */
  readonly cost: number
  /** Milliseconds the model spent on this call. */
  readonly ms: number
}

export type Price = { readonly input: number; readonly output: number; readonly cacheRead: number }
/** Claude Sonnet list price per million tokens, the default for "what this would cost on an API". */
export const DEFAULT_PRICE: Price = { input: 3, output: 15, cacheRead: 0.3 }

export const directory = () => process.env.OKUCODE_USAGE_DIR ?? path.join(Global.Path.data, "usage")
const FILE = /^\d{4}-\d{2}\.jsonl$/

/** Appends one model call. Never throws. */
export function record(entry: Entry, dir = directory()) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    appendFileSync(path.join(dir, `${entry.time.slice(0, 7)}.jsonl`), `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  } catch {
    // Metering must never break a chat.
  }
}

/** Model calls from `from` (ISO time) on. */
export function read(from: string, dir = directory()): Entry[] {
  let names: string[]
  try {
    names = readdirSync(dir).filter((name) => FILE.test(name) && name.slice(0, 7) >= from.slice(0, 7))
  } catch {
    return []
  }
  const out: Entry[] = []
  for (const name of names.sort()) {
    for (const line of readFileSync(path.join(dir, name), "utf8").split("\n")) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as Entry
        if (entry.time >= from) out.push(entry)
      } catch {}
    }
  }
  return out
}

export type Totals = {
  calls: number
  input: number
  output: number
  cached: number
  cost: number
  gpuHours: number
  equivalent: number
}

const empty = (): Totals => ({ calls: 0, input: 0, output: 0, cached: 0, cost: 0, gpuHours: 0, equivalent: 0 })

/** Equivalent API cost of an entry in USD. */
export const equivalent = (entry: Entry, price: Price = DEFAULT_PRICE) =>
  ((entry.input + entry.cacheWrite) * price.input + (entry.output + entry.reasoning) * price.output + entry.cacheRead * price.cacheRead) /
  1_000_000

function add(totals: Totals, entry: Entry, price: Price) {
  totals.calls++
  totals.input += entry.input + entry.cacheWrite
  totals.output += entry.output + entry.reasoning
  totals.cached += entry.cacheRead
  totals.cost += entry.cost
  // A model with no API cost runs on our own hardware: its time is GPU time.
  if (!entry.cost) totals.gpuHours += entry.ms / 3_600_000
  totals.equivalent += equivalent(entry, price)
}

export type Summary = {
  readonly total: Totals
  readonly byUser: { user: string; totals: Totals }[]
  readonly byModel: { model: string; totals: Totals }[]
  readonly byDay: { day: string; totals: Totals }[]
}

/** Sums per person (via `users`: session ID → email), model and day. Biggest first; days newest first. */
export function summarize(entries: readonly Entry[], users: Readonly<Record<string, string>>, price: Price = DEFAULT_PRICE): Summary {
  const total = empty()
  const byUser = new Map<string, Totals>()
  const byModel = new Map<string, Totals>()
  const byDay = new Map<string, Totals>()
  const bucket = (map: Map<string, Totals>, key: string) => {
    let value = map.get(key)
    if (!value) map.set(key, (value = empty()))
    return value
  }
  for (const entry of entries) {
    add(total, entry, price)
    add(bucket(byUser, users[entry.sessionID] ?? "owner"), entry, price)
    add(bucket(byModel, `${entry.provider}/${entry.model}`), entry, price)
    add(bucket(byDay, entry.time.slice(0, 10)), entry, price)
  }
  const sorted = <K extends string>(map: Map<string, Totals>, key: K) =>
    [...map.entries()]
      .sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output))
      .map(([name, totals]) => ({ [key]: name, totals }) as { [P in K]: string } & { totals: Totals })
  return {
    total,
    byUser: sorted(byUser, "user"),
    byModel: sorted(byModel, "model"),
    byDay: sorted(byDay, "day").sort((a, b) => b.day.localeCompare(a.day)),
  }
}
