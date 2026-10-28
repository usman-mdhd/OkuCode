import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OkuTestLoop } from "@opencode/core/okutobus/test-loop"

// Minimal message shapes, newest first like the runner passes them.
const tool = (name: string, input: Record<string, unknown>, state: Record<string, unknown> = {}) =>
  ({ type: "tool", name, state: { status: "completed", input, ...state } }) as const
const assistant = (...content: unknown[]) => ({ type: "assistant", content: [{ type: "text", text: "ok" }, ...content] }) as never
const user = () => ({ type: "user", text: "fix the bug" }) as never
const synthetic = (text: string) => ({ type: "synthetic", text }) as never
const edit = tool("edit", { path: "src/math.py" })
const ran = (exit: number) => tool("shell", { command: "python3 -m pytest -q" }, { metadata: { exit } })

let dir: string
let configDir: string
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "oku-tests-"))
  configDir = mkdtempSync(path.join(tmpdir(), "oku-config-"))
  process.env.OPENCODE_CONFIG_DIR = configDir
  writeFileSync(path.join(dir, "test_math.py"), "def test_add(): assert 1 + 1 == 2\n")
})
afterAll(() => {
  delete process.env.OPENCODE_CONFIG_DIR
  rmSync(dir, { recursive: true, force: true })
  rmSync(configDir, { recursive: true, force: true })
})

describe("Okutobus test loop (FR-21)", () => {
  test("finds the test command", () => {
    expect(OkuTestLoop.command(dir, undefined)).toBe("python3 -m pytest -q")
    expect(OkuTestLoop.command(dir, "make check")).toBe("make check")
    const js = mkdtempSync(path.join(tmpdir(), "oku-js-"))
    writeFileSync(path.join(js, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }))
    expect(OkuTestLoop.command(js, undefined)).toBe("npm test")
    writeFileSync(path.join(js, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified"' } }))
    expect(OkuTestLoop.command(js, undefined)).toBeUndefined()
    rmSync(js, { recursive: true, force: true })
  })

  test("asks to run the tests after a code change", () => {
    const text = OkuTestLoop.decide([assistant(edit), user()], dir)
    expect(text).toContain(OkuTestLoop.MARK)
    expect(text).toContain("python3 -m pytest -q")
  })

  test("asks to fix the code when the tests failed, and stops when they pass", () => {
    expect(OkuTestLoop.decide([assistant(ran(1)), assistant(edit), user()], dir)).toContain("tests failed")
    expect(OkuTestLoop.decide([assistant(ran(0)), assistant(edit), user()], dir)).toBeUndefined()
    // Installing pytest is not a test run: the failed run still needs a fix and a new run.
    const install = tool("shell", { command: "python3 -m pip install pytest" }, { metadata: { exit: 0 } })
    expect(OkuTestLoop.decide([assistant(install), assistant(ran(1)), assistant(edit), user()], dir)).toContain("tests failed")
    // A new change after a passing run needs another run.
    expect(OkuTestLoop.decide([assistant(edit), assistant(ran(0)), assistant(edit), user()], dir)).toContain("Run")
  })

  test("leaves answers without code changes, declined commands and long loops alone", () => {
    expect(OkuTestLoop.decide([assistant(), user()], dir)).toBeUndefined()
    expect(OkuTestLoop.decide([assistant(tool("write", { path: "notes.md" })), user()], dir)).toBeUndefined()
    const declined = tool("shell", { command: "python3 -m pytest -q" }, { status: "error" })
    expect(OkuTestLoop.decide([assistant(declined), assistant(edit), user()], dir)).toBeUndefined()
    const reminder = synthetic(`${OkuTestLoop.MARK} again`)
    const loop = [assistant(ran(1)), reminder, assistant(edit), reminder, assistant(edit), reminder, assistant(edit), user()]
    expect(OkuTestLoop.decide(loop, dir)).toBeUndefined()
  })

  test("can be turned off in okucode.json", () => {
    writeFileSync(path.join(configDir, "okucode.json"), JSON.stringify({ autoTest: false }))
    expect(OkuTestLoop.decide([assistant(edit), user()], dir)).toBeUndefined()
    rmSync(path.join(configDir, "okucode.json"))
  })
})
