// Okutobus (OkuCode) SRS FR-59: monthly budgets per person, built on the usage log (FR-58).
//
// okucode.json "budget": { "unit": "tokens" | "usd", "default": 2000000, "people": { "a@okutobus.com": 5000000 } }
//   unit     "tokens" counts tokens in + out; "usd" counts what the tokens would cost on a paid API ("Same on an API"
//            in Settings → Team → Usage) plus any real API cost
//   default  the monthly limit for everyone (0 or missing = no limit)
//   people   a different limit for some people (0 = no limit for that person)
// At 80% the person sees a warning above the message box. At 100% new messages are refused until the 1st of next
// month (UTC) or until an admin raises the limit. The owner (server password) never has a limit.

import { UsageLog } from "@opencode/util/usage-log"

export type Unit = "tokens" | "usd"
export type Config = { unit?: Unit; default?: number; people?: Record<string, number> }
export type View = {
  unit: Unit
  /** null: no limit. */
  limit: number | null
  used: number
  /** 0..1+, 0 when there is no limit. */
  share: number
  warning: boolean
  exceeded: boolean
  /** The first day of next month, YYYY-MM-DD (UTC). */
  resetsOn: string
}

export const WARN_AT = 0.8

export const unitOf = (config: Config | undefined): Unit => (config?.unit === "usd" ? "usd" : "tokens")

/** The person's monthly limit, or null for none. */
export function limitFor(config: Config | undefined, email: string): number | null {
  const own = config?.people?.[email]
  const value = typeof own === "number" ? own : config?.default
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

export function nextMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
}

export function amount(entry: UsageLog.Entry, unit: Unit, price: UsageLog.Price) {
  if (unit === "tokens") return entry.input + entry.output + entry.reasoning + entry.cacheWrite
  return UsageLog.equivalent(entry, price) + (Number(entry.cost) || 0)
}

/** What each person used this month, in the budget's unit. */
export function usedByPerson(
  entries: readonly UsageLog.Entry[],
  sessionUsers: Readonly<Record<string, string>>,
  unit: Unit,
  price: UsageLog.Price,
) {
  const used: Record<string, number> = {}
  for (const entry of entries) {
    const email = sessionUsers[entry.sessionID]
    if (!email) continue
    used[email] = (used[email] ?? 0) + amount(entry, unit, price)
  }
  return used
}

export function view(config: Config | undefined, email: string, used: number, now = new Date()): View {
  const limit = limitFor(config, email)
  const share = limit ? used / limit : 0
  return {
    unit: unitOf(config),
    limit,
    used,
    share,
    warning: !!limit && share >= WARN_AT && share < 1,
    exceeded: !!limit && share >= 1,
    resetsOn: nextMonth(now),
  }
}

export function format(value: number, unit: Unit) {
  if (unit === "usd") return `$${value < 10 ? value.toFixed(2) : Math.round(value).toLocaleString("en-US")}`
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M tokens`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k tokens`
      : `${value} tokens`
}

/** Checks a budget sent from Settings → Team. Returns the cleaned budget or an error message. */
export function parse(input: unknown, validEmail: (email: string) => boolean): Config | string {
  if (!input || typeof input !== "object") return "Send a budget."
  const value = input as { unit?: unknown; default?: unknown; people?: unknown }
  if (value.unit !== undefined && value.unit !== "tokens" && value.unit !== "usd")
    return 'Unit must be "tokens" or "usd".'
  const number = (item: unknown) => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1e12
  if (value.default !== undefined && value.default !== null && !number(value.default))
    return "The monthly limit must be a number, 0 or more (0 = no limit)."
  const people: Record<string, number> = {}
  if (value.people !== undefined && value.people !== null) {
    if (typeof value.people !== "object" || Array.isArray(value.people)) return "People must be a list of email: limit."
    for (const [email, limit] of Object.entries(value.people as Record<string, unknown>)) {
      const clean = email.trim().toLowerCase()
      if (!validEmail(clean)) return `Not an email address: ${email}`
      if (limit === null || limit === undefined || limit === "") continue
      if (!number(limit)) return `The limit for ${clean} must be a number, 0 or more (0 = no limit).`
      people[clean] = limit as number
    }
  }
  return {
    unit: value.unit === "usd" ? "usd" : "tokens",
    ...(typeof value.default === "number" && value.default > 0 ? { default: value.default } : {}),
    ...(Object.keys(people).length ? { people } : {}),
  }
}

export * as OkuBudget from "./budget"
