export * as OkuTestLoop from "./test-loop.js"

// Okutobus (OkuCode) SRS FR-21: test feedback loop. When the model finishes a reply after changing code, OkuCode
// checks the project's tests. If they were not run after the last change, it asks the model to run them (through the
// normal shell tool, so the approval mode still applies). If they failed, it asks the model to fix the code and run
// them again. It stops when the tests pass, when the user declines the command, or after MAX_ROUNDS reminders.
// Turn it off with "autoTest": false in <config>/okucode.json; set "testCommand" there to override detection.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import type { SessionMessage } from "../session/message.js"
import { OkuApproval } from "./approval.js"

export const MARK = "[OkuCode tests]"
export const MAX_ROUNDS = 3

const CODE =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|cs|rb|php|swift|c|cc|cpp|h|hpp|scala|dart|vue|svelte|sql|sh)$/i
const EDIT_TOOLS = new Set(["write", "edit", "patch"])
const SHELL_TOOLS = new Set(["shell", "bash"])
// Letters-only boundaries so "python test_calc.py" and "npm run test:unit" count as test runs.
// Installing a test tool ("pip install pytest") is not a test run.
const INSTALL = /\b(?:pip3?|uv|npm|pnpm|yarn|bun|brew|apt(?:-get)?|cargo|gem|go)\s+(?:install|add|i|get)\b/i
const TEST_RUN = /(?:^|[^a-z])(?:tests?|pytest|jest|vitest|mocha|unittest|rspec|phpunit)(?:[^a-z]|$)/i

function settings(): { autoTest?: unknown; testCommand?: unknown } {
  try {
    return JSON.parse(readFileSync(OkuApproval.settingsFile(), "utf8"))
  } catch {
    return {}
  }
}

const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}

const hasPythonTests = (directory: string) => {
  if (["pytest.ini", "conftest.py", "tox.ini"].some((name) => existsSync(path.join(directory, name)))) return true
  if (existsSync(path.join(directory, "tests")) || existsSync(path.join(directory, "test"))) return true
  try {
    return readdirSync(directory).some((name) => /^test_.*\.py$|_test\.py$/.test(name))
  } catch {
    return false
  }
}

/** The command that runs this project's tests, or undefined when none is found. */
export function command(directory: string, configured = settings().testCommand): string | undefined {
  if (typeof configured === "string" && configured.trim()) return configured.trim()
  const pkg = readJson(path.join(directory, "package.json"))
  const script = pkg?.scripts?.test
  if (typeof script === "string" && script.trim() && !/no test specified/i.test(script)) {
    if (existsSync(path.join(directory, "bun.lock")) || existsSync(path.join(directory, "bun.lockb"))) return "bun run test"
    if (existsSync(path.join(directory, "pnpm-lock.yaml"))) return "pnpm test"
    if (existsSync(path.join(directory, "yarn.lock"))) return "yarn test"
    return "npm test"
  }
  if (existsSync(path.join(directory, "go.mod"))) return "go test ./..."
  if (existsSync(path.join(directory, "Cargo.toml"))) return "cargo test"
  if (hasPythonTests(directory)) return "python3 -m pytest -q"
  return undefined
}

type Event = { kind: "edit" } | { kind: "test"; status: "passed" | "failed" | "declined" }

/** The tool events of the current turn (since the last user message), oldest first. */
function events(messages: readonly SessionMessage.Info[]) {
  const turn: SessionMessage.Info[] = []
  for (const message of messages) {
    if (message.type === "user") break
    turn.push(message)
  }
  turn.reverse()
  const result: Event[] = []
  let rounds = 0
  for (const message of turn) {
    if (message.type === "synthetic" && message.text.startsWith(MARK)) rounds++
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || part.state.status === "streaming") continue
      const input = part.state.input
      if (EDIT_TOOLS.has(part.name)) {
        const file = String(input.path ?? input.filePath ?? "")
        if (part.name === "patch" || CODE.test(file)) result.push({ kind: "edit" })
        continue
      }
      if (!SHELL_TOOLS.has(part.name) || !TEST_RUN.test(String(input.command ?? "")) || INSTALL.test(String(input.command ?? ""))) continue
      if (part.state.status === "running") continue
      if (part.state.status === "error" && part.state.metadata?.exit === undefined) {
        result.push({ kind: "test", status: "declined" })
        continue
      }
      const exit = part.state.metadata?.exit
      result.push({ kind: "test", status: exit === 0 ? "passed" : "failed" })
    }
  }
  return { events: result, rounds }
}

/** The message to send to the model, or undefined. `messages` are the newest first. */
export function decide(messages: readonly SessionMessage.Info[], directory: string): string | undefined {
  if (settings().autoTest === false) return undefined
  const latest = messages[0]
  if (!latest || latest.type !== "assistant") return undefined
  const { events: list, rounds } = events(messages)
  const lastEdit = list.findLastIndex((event) => event.kind === "edit")
  if (lastEdit === -1 || rounds >= MAX_ROUNDS) return undefined
  const run = command(directory)
  if (!run) return undefined
  const after = list.slice(lastEdit + 1).filter((event) => event.kind === "test")
  const last = after.at(-1)
  if (!last)
    return `${MARK} You changed code. Run the project's tests now with the shell tool: \`${run}\`. If any test fails, fix the code and run the tests again.`
  if (last.status === "failed")
    return `${MARK} The tests failed. Read the errors in the test output above, fix the code (not the tests, unless the test itself is wrong), then run \`${run}\` again.`
  return undefined
}
