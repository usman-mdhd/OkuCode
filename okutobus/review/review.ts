// OkuCode SRS FR-32: pull request review bot. `okucode review` reviews the changes on this branch with the team's
// model and prints the review; with --pr it posts it on the GitHub pull request (one comment, updated on each run).
//
//   okucode review                         review this branch against main (or --base <branch>)
//   okucode review --pr 12 --post          post the review on pull request 12 (needs GITHUB_TOKEN)
//   okucode review --fail-on high          exit 1 when the review finds a high-severity problem (for CI)
//
// The model comes from OkuCode's settings (the default model in ~/.config/opencode/opencode.json, e.g. the team
// gateway), or from --model / --url / --key, or OKUCODE_REVIEW_MODEL / OKUCODE_REVIEW_URL / OKUCODE_REVIEW_KEY.
// FR-55: okutobus/github-action runs this on every pull request.

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const MARKER = "<!-- okucode-review -->"
const MAX_DIFF = 60_000

export const SYSTEM = [
  "You are OkuCode, a careful senior code reviewer. Review the git diff of a pull request.",
  "Look for: bugs and wrong logic, security problems (injection, secrets in code, missing auth checks), crashes on",
  "empty or unexpected input, missing error handling, missing tests for new behaviour, and confusing code.",
  "Only comment on the changed lines and what they affect. Do not praise, do not repeat the diff, do not invent files.",
  "Answer in Markdown with exactly these sections:",
  "## Summary",
  "One or two sentences on what the change does.",
  "## Issues",
  "A numbered list. Each item: **high**, **medium** or **low**, then `file:line`, the problem, and the fix.",
  'Write "No issues found." when there are none.',
  "## Verdict",
  'Either "Looks good to merge" or "Changes needed".',
].join("\n")

type Options = {
  base?: string
  pr?: number
  post: boolean
  failOn?: "high" | "medium" | "low"
  model?: string
  url?: string
  key?: string
  api: string
  repo?: string
  dir: string
}

/** A problem to report to the person (the command prints it and exits 2). */
export class ReviewError extends Error {}
function fail(message: string): never {
  throw new ReviewError(message)
}

export function parseArgs(argv: string[], env = process.env): Options {
  const options: Options = {
    post: false,
    api: env.GITHUB_API_URL || "https://api.github.com",
    repo: env.GITHUB_REPOSITORY || undefined,
    dir: process.cwd(),
    base: env.GITHUB_BASE_REF || undefined,
    model: env.OKUCODE_REVIEW_MODEL || undefined,
    url: env.OKUCODE_REVIEW_URL || undefined,
    key: env.OKUCODE_REVIEW_KEY || undefined,
  }
  for (let index = 0; index < argv.length; index++) {
    const value = () => argv[++index] ?? fail(`${argv[index - 1]} needs a value`)
    switch (argv[index]) {
      case "--base":
        options.base = value()
        break
      case "--pr":
        options.pr = Number(value())
        break
      case "--post":
        options.post = true
        break
      case "--fail-on": {
        const level = value()
        if (level !== "high" && level !== "medium" && level !== "low") fail("--fail-on must be high, medium or low")
        options.failOn = level
        break
      }
      case "--model":
        options.model = value()
        break
      case "--url":
        options.url = value()
        break
      case "--key":
        options.key = value()
        break
      case "--api":
        options.api = value()
        break
      case "--repo":
        options.repo = value()
        break
      case "--dir":
        options.dir = path.resolve(value())
        break
      case "-h":
      case "--help":
        console.log(
          readFileSync(new URL(import.meta.url), "utf8")
            .split("\n")
            .slice(0, 10)
            .join("\n"),
        )
        process.exit(0)
      default:
        fail(`unknown option ${argv[index]}`)
    }
  }
  if (options.pr !== undefined && (!Number.isInteger(options.pr) || options.pr <= 0))
    fail("--pr must be a pull request number")
  return options
}

const git = (dir: string, ...args: string[]) => {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() }
}

/** The diff of this branch against its base (the merge base, so other people's new commits on main are left out). */
export function diff(dir: string, base?: string) {
  const candidates = base ? [`origin/${base}`, base] : ["origin/main", "main", "origin/master", "master"]
  const found = candidates.find((ref) => git(dir, "rev-parse", "--verify", "--quiet", ref).ok)
  if (!found) fail(`cannot find the base branch (${candidates.join(", ")}). Use --base <branch>.`)
  const result = git(dir, "diff", "--unified=3", "--no-color", `${found}...HEAD`)
  if (!result.ok) fail(`git diff failed: ${result.err}`)
  return { base: found, text: result.out }
}

/** The model to use: options first, then OkuCode's default model and its provider from opencode.json. */
export function model(options: Pick<Options, "model" | "url" | "key">, configFile = defaultConfig()) {
  if (options.url && options.model)
    return { url: options.url.replace(/\/+$/, ""), model: options.model, key: options.key }
  let config: any = {}
  try {
    config = JSON.parse(readFileSync(configFile, "utf8"))
  } catch {}
  const ref: string = options.model?.includes("/") ? options.model : (config.model ?? "")
  const slash = ref.indexOf("/")
  const providerID = slash > 0 ? ref.slice(0, slash) : ""
  const id = slash > 0 ? ref.slice(slash + 1) : options.model
  const provider = config.provider?.[providerID]
  const url = options.url ?? provider?.options?.baseURL
  if (!url || !id)
    fail("no model set up: pass --url <OpenAI-compatible address> --model <name>, or set OkuCode's default model")
  const key = options.key ?? provider?.options?.apiKey
  return { url: String(url).replace(/\/+$/, ""), model: id, key: typeof key === "string" ? key : undefined }
}

const defaultConfig = () =>
  path.join(
    process.env.OPENCODE_CONFIG_DIR ??
      path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode"),
    "opencode.json",
  )

export async function review(text: string, target: { url: string; model: string; key?: string }) {
  const trimmed = text.length > MAX_DIFF ? `${text.slice(0, MAX_DIFF)}\n\n[diff cut at ${MAX_DIFF} characters]` : text
  const response = await fetch(`${target.url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(target.key ? { authorization: `Bearer ${target.key}` } : {}) },
    body: JSON.stringify({
      model: target.model,
      temperature: 0.1,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Review this pull request diff:\n\n\`\`\`diff\n${trimmed}\n\`\`\`` },
      ],
    }),
    signal: AbortSignal.timeout(15 * 60_000),
  }).catch((error) =>
    fail(`cannot reach the model at ${target.url}: ${error instanceof Error ? error.message : error}`),
  )
  if (!response.ok) fail(`the model answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
  const raw = await response.text()
  // Some servers stream even when asked not to: join the chunks.
  if (raw.trimStart().startsWith("data:"))
    return raw
      .split("\n")
      .filter((line) => line.startsWith("data:") && !line.includes("[DONE]"))
      .map((line) => {
        try {
          return JSON.parse(line.slice(5)).choices?.[0]?.delta?.content ?? ""
        } catch {
          return ""
        }
      })
      .join("")
      .trim()
  return String(JSON.parse(raw).choices?.[0]?.message?.content ?? "").trim()
}

const LEVELS = { low: 1, medium: 2, high: 3 } as const
/** The most serious problem the review lists, or undefined when it found none. */
export function worst(text: string): keyof typeof LEVELS | undefined {
  const issues = text.split(/^##\s*Issues/im)[1]?.split(/^##\s/m)[0] ?? ""
  let top: keyof typeof LEVELS | undefined
  for (const match of issues.matchAll(/\*\*(high|medium|low)\*\*|\b(high|medium|low)\b\s*[:\-–]/gi)) {
    const level = (match[1] ?? match[2])!.toLowerCase() as keyof typeof LEVELS
    if (!top || LEVELS[level] > LEVELS[top]) top = level
  }
  return top
}

export function repository(dir: string, given?: string) {
  if (given) return given
  const remote = git(dir, "remote", "get-url", "origin").out
  const match = /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(remote)
  if (!match) fail("cannot tell the GitHub repository; pass --repo owner/name")
  return match[1]!
}

/** Posts the review on the pull request, or updates OkuCode's earlier comment there. */
export async function post(options: Options, body: string, token = process.env.GITHUB_TOKEN) {
  if (!options.pr) fail("--post needs --pr <number>")
  if (!token) fail("--post needs GITHUB_TOKEN")
  const repo = repository(options.dir, options.repo)
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
  }
  const base = `${options.api.replace(/\/+$/, "")}/repos/${repo}/issues`
  const list = await fetch(`${base}/${options.pr}/comments?per_page=100`, { headers })
  if (!list.ok) fail(`GitHub answered ${list.status} when reading the comments: ${(await list.text()).slice(0, 200)}`)
  const earlier = ((await list.json()) as { id: number; body?: string }[]).find((comment) =>
    comment.body?.includes(MARKER),
  )
  const text = `${MARKER}\n### OkuCode review\n\n${body}\n\n<sub>Reviewed by OkuCode. It can be wrong: check before you act on it.</sub>`
  const sent = earlier
    ? await fetch(`${base}/comments/${earlier.id}`, { method: "PATCH", headers, body: JSON.stringify({ body: text }) })
    : await fetch(`${base}/${options.pr}/comments`, { method: "POST", headers, body: JSON.stringify({ body: text }) })
  if (!sent.ok) fail(`GitHub answered ${sent.status} when posting: ${(await sent.text()).slice(0, 200)}`)
  return earlier ? "updated" : "posted"
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const changes = diff(options.dir, options.base)
    if (!changes.text) {
      console.log(`okucode review: no changes against ${changes.base}.`)
      process.exit(0)
    }
    const target = model(options)
    console.error(`okucode review: reviewing the changes against ${changes.base} with ${target.model}...`)
    const text = await review(changes.text, target)
    console.log(text)
    if (options.post)
      console.error(`okucode review: ${await post(options, text)} the review on pull request #${options.pr}.`)
    const top = worst(text)
    if (options.failOn && top && LEVELS[top] >= LEVELS[options.failOn]) {
      console.error(`okucode review: found a ${top}-severity issue (--fail-on ${options.failOn}).`)
      process.exit(1)
    }
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error
    console.error(`okucode review: ${error.message}`)
    process.exit(2)
  }
}
