export * as OkuProtect from "./protect.js"

// Okutobus (OkuCode) safety rules from the SRS:
// - FR-27 protected paths: files the agent may never write or delete (.env, keys, .git internals, infra/prod).
// - FR-23 built-in deny rules: shell commands that are never run (sudo, rm -rf /, curl | sh, force push…).
// - FR-26 secret redaction: keys, tokens, passwords and connection strings are replaced with [REDACTED:kind]
//   in everything sent to a model, and a redacted placeholder can never be written back into a file.
// Extra protected paths can be added with OKUCODE_PROTECTED_PATHS (comma-separated, * wildcards).

import { Message } from "@opencode/ai"

const PROTECTED = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa*",
  "id_ed25519*",
  "id_ecdsa*",
  ".git/**",
  "infra/prod/**",
  ".ssh/**",
  ".aws/credentials",
  ".npmrc",
  ".pypirc",
]

// Example/template env files are meant to be shared, so they stay editable.
const ALLOWED = [".env.example", ".env.sample", ".env.template", ".env.dist"]

function patterns() {
  const extra = (process.env.OKUCODE_PROTECTED_PATHS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  return [...PROTECTED, ...extra]
}

function toRegExp(glob: string) {
  let source = ""
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!
    if (char === "*" && glob[index + 1] === "*") {
      source += ".*"
      index++
    } else if (char === "*") source += "[^/]*"
    else if (char === "?") source += "[^/]"
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${source}$`, "i")
}

/** The protected pattern a path matches, if any. Works with relative, absolute and file:// paths. */
export function protectedPath(resource: string) {
  const path = resource.replace(/^file:\/\//, "").replaceAll("\\", "/").replace(/\/+$/, "")
  const segments = path.split("/").filter(Boolean)
  const name = segments.at(-1) ?? ""
  if (ALLOWED.includes(name.toLowerCase())) return undefined
  for (const pattern of patterns()) {
    const regex = toRegExp(pattern)
    if (!pattern.includes("/")) {
      if (regex.test(name)) return pattern
      continue
    }
    // A pattern with folders matches at any depth: infra/prod/** also matches /repo/infra/prod/x.yaml.
    for (let start = 0; start < segments.length; start++)
      if (regex.test(segments.slice(start).join("/"))) return pattern
  }
  return undefined
}

const DENIED_COMMANDS: { pattern: RegExp; reason: string }[] = [
  { pattern: /(^|[\s;&|(])sudo\s/, reason: "sudo is not allowed" },
  { pattern: /\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r)[a-z]*\s+(\/|~|\$HOME|\*|\/\*)(\s|$)/i, reason: "deleting / or the home folder is not allowed" },
  { pattern: /\bmkfs(\.|\s)/, reason: "formatting disks is not allowed" },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;/, reason: "fork bombs are not allowed" },
  { pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, reason: "running downloaded scripts (curl | sh) is not allowed" },
  { pattern: /\bgit\s+push\b[^;&|]*\s(--force|-f)(\s|$)/, reason: "force push is not allowed" },
  { pattern: /\b(shutdown|reboot|halt)\b/, reason: "shutting down the computer is not allowed" },
  { pattern: /\bdd\b[^;&|]*\bof=\/dev\//, reason: "writing to disks is not allowed" },
]

const WRITES_TO = /(?:>>?|\btee(?:\s+-a)?|\brm(?:\s+-\w+)*|\bmv|\bcp(?:\s+-\w+)*\s+\S+|\bsed\s+-i\S*(?:\s+'[^']*'|\s+"[^"]*"|\s+\S+)?|\btruncate(?:\s+-\S+\s+\S+)*|\bchmod\s+\S+)\s+(["']?)([^\s"';&|<>]+)\1/g

/** Why a shell command must not run, if it breaks a rule. */
export function deniedCommand(command: string) {
  for (const rule of DENIED_COMMANDS) if (rule.pattern.test(command)) return rule.reason
  for (const match of command.matchAll(WRITES_TO)) {
    const target = match[2]
    const hit = target ? protectedPath(target) : undefined
    if (hit) return `${target} is a protected file (${hit}); OkuCode never changes it`
  }
  return undefined
}

/** Why a permission request must be refused no matter what the user's rules say, if it must. */
export function refusal(action: string, resources: ReadonlyArray<string>) {
  if (action === "edit") {
    for (const resource of resources) {
      const hit = protectedPath(resource)
      if (hit) return `${resource} is a protected file (${hit}). OkuCode never creates, changes or deletes it.`
    }
    return undefined
  }
  if (action === "shell" || action === "bash") {
    // Pipelines arrive as separate commands, so the joined form is checked too (curl … | sh).
    for (const command of [...resources, resources.join(" | ")]) {
      const reason = deniedCommand(command)
      if (reason) return `Command blocked: ${reason}.`
    }
  }
  return undefined
}

// ---- FR-26 secret redaction ----

const RULES: { kind: string; pattern: RegExp; group?: number }[] = [
  { kind: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "aws-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "google-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "google-secret", pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}/g },
  { kind: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "stripe-key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // postgres://user:PASSWORD@host
  { kind: "connection-string", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:([^\s@"']{3,})@/gi, group: 1 },
  // Server=…;Password=PASSWORD; (SQL Server, Oracle)
  { kind: "password", pattern: /\b(?:password|pwd)\s*=\s*([^;"'\s]{3,})/gi, group: 1 },
  // API_KEY = "value", "client_secret": "value", token: value
  {
    kind: "secret",
    pattern:
      /\b[\w.-]*(?:password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret)[\w.-]*["']?\s*[:=]\s*["']?([^\s"',;]{6,})/gi,
    group: 1,
  },
]

const PLACEHOLDER = /^(?:\[REDACTED:[\w-]+\]|\$\{?[\w.]+\}?|<[^>]+>|x{4,}|\*{3,}|changeme|your[_-].*|example.*|process\.env\..*|env\(.*|true|false|null|none|undefined)$/i

/** Replaces secrets in text with [REDACTED:kind]. */
export function redact(text: string) {
  if (!text) return text
  let out = text
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match: string, ...groups: unknown[]) => {
      if (rule.group === undefined) return `[REDACTED:${rule.kind}]`
      const value = groups[rule.group - 1]
      if (typeof value !== "string" || PLACEHOLDER.test(value) || value.startsWith("[REDACTED")) return match
      return match.replace(value, `[REDACTED:${rule.kind}]`)
    })
  }
  return out
}

/** True when text carries a redaction placeholder, which must never be written into a file. */
export const hasPlaceholder = (text: string) => /\[REDACTED:[\w-]+\]/.test(text)

function deep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T
  if (Array.isArray(value)) return value.map(deep) as T
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = deep(item)
    return out as T
  }
  return value
}

type Part = { type?: string; [key: string]: unknown }

function part(value: Part): Part {
  switch (value.type) {
    case "text":
    case "reasoning":
      return typeof value.text === "string" ? { ...value, text: redact(value.text) } : value
    case "tool-call":
      return { ...value, input: deep(value.input) }
    case "tool-result": {
      const result = value.result as { type?: string; value?: unknown } | undefined
      if (!result || typeof result !== "object") return value
      if (result.type === "content" && Array.isArray(result.value))
        return { ...value, result: { ...result, value: result.value.map((item: Part) => part(item)) } }
      return { ...value, result: { ...result, value: deep(result.value) } }
    }
    default:
      return value
  }
}

/** Redacts every message before it is sent to a model. */
export function messages(list: ReadonlyArray<Message>): Message[] {
  return list.map(
    (message) =>
      // SAFETY: part() keeps every part's type and only rewrites string values inside it.
      new Message({ ...message, content: message.content.map((item) => part(item as Part)) as Message["content"] }),
  )
}
