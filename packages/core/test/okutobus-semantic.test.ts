import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { OkuSemantic } from "../src/okutobus/semantic.js"

// A stand-in embedding model: one dimension per topic, so "login secret" lands near the password code.
const TOPICS = [
  ["password", "login", "secret", "credential", "hash", "verify"],
  ["email", "mail", "invite", "smtp", "send"],
  ["multiply", "add", "sum", "number", "math"],
]
const vector = (text: string) => {
  const words = text.toLowerCase().split(/[^a-z]+/)
  return TOPICS.map((topic) => words.filter((word) => topic.includes(word)).length + 0.01)
}

let server: ReturnType<typeof Bun.serve>
let calls = 0
const config = () => ({ model: "fake-embed", url: `http://127.0.0.1:${server.port}/v1` })

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const body = (await request.json()) as { model: string; input: string[] }
      calls += body.input.length
      if (body.model === "missing")
        return new Response('{"error":"model \\"missing\\" not found, try pulling it first"}', { status: 404 })
      return Response.json({ data: body.input.map((text, index) => ({ index, embedding: vector(text) })) })
    },
  })
})
afterAll(() => server.stop(true))

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), "oku-semantic-"))
  mkdirSync(path.join(dir, "app"))
  writeFileSync(
    path.join(dir, "app", "auth.py"),
    "import hashlib\n\ndef check_password(user, given):\n    return hashlib.sha256(given.encode()).hexdigest() == user.hash\n",
  )
  writeFileSync(path.join(dir, "app", "mail.py"), "def send_invite(to):\n    smtp.send(to, 'You are invited')\n")
  writeFileSync(path.join(dir, "app", "calc.py"), "def multiply(a, b):\n    return a * b\n")
  return dir
}

describe("OkuCode semantic search (FR-19)", () => {
  test("cuts files into one piece per function", () => {
    const list = OkuSemantic.pieces("a.py", "import x\n\ndef one():\n    pass\n\ndef two():\n    pass", [
      { line: 3, name: "one" },
      { line: 6, name: "two" },
    ])
    expect(list.map((piece) => [piece.title, piece.start, piece.end])).toEqual([
      ["a.py", 1, 2],
      ["one", 3, 5],
      ["two", 6, 7],
    ])
  })

  test("finds code by meaning and only embeds changed files again", async () => {
    const dir = project()
    const hits = await OkuSemantic.search(dir, "where is the login secret checked", 3, config())
    expect(hits[0]!.file).toBe("app/auth.py")
    expect(OkuSemantic.render(dir, hits.slice(0, 1))).toContain("def check_password")

    const before = calls
    await OkuSemantic.search(dir, "who sends the invite email", 3, config())
    expect(calls - before).toBe(1) // only the question; the files were already in the index

    writeFileSync(
      path.join(dir, "app", "calc.py"),
      "def multiply(a, b):\n    return a * b\n\ndef add(a, b):\n    return a + b\n",
    )
    const changed = calls
    const math = await OkuSemantic.search(dir, "add two numbers", 3, config())
    expect(math[0]!.file).toBe("app/calc.py")
    expect(calls - changed).toBeLessThan(5) // calc.py again (two pieces) and the question
  })

  test("explains a missing embedding model", async () => {
    await expect(OkuSemantic.search(project(), "anything", 3, { ...config(), model: "missing" })).rejects.toThrow(
      "ollama pull missing",
    )
  })
})
