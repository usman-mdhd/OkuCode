import { describe, expect, test } from "bun:test"
import { LLMEvent } from "@opencode/ai"
import { Effect, Stream } from "effect"
import { TextToolCalls } from "@opencode/core/okutobus/text-tool-calls"

const tools = new Set(["shell", "read", "edit"])
const finish = () => LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } })

function textEvents(id: string, chunks: string[]): LLMEvent[] {
  return [
    LLMEvent.textStart({ id }),
    ...chunks.map((text) => LLMEvent.textDelta({ id, text })),
    LLMEvent.textEnd({ id }),
  ]
}

const run = (events: LLMEvent[], offered: ReadonlySet<string> = tools) =>
  Effect.runPromise(Stream.runCollect(TextToolCalls.apply(Stream.fromIterable(events), offered))).then((chunk) =>
    Array.from(chunk),
  )

const calls = (events: LLMEvent[]) =>
  events.flatMap((event) => (event.type === "tool-call" ? [{ name: event.name, input: event.input }] : []))
const text = (events: LLMEvent[]) => events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("")

describe("Okutobus TextToolCalls (FR-48)", () => {
  test("turns a bare JSON tool call into a real tool call", async () => {
    const out = await run([
      ...textEvents("t1", ['{"name": "shell", ', '"arguments": {"command": "python3 -m unittest"}}']),
      finish(),
    ])
    expect(calls(out)).toEqual([{ name: "shell", input: { command: "python3 -m unittest" } }])
    expect(text(out)).toBe("")
    expect(out.at(-1)?.type).toBe("step-finish")
  })

  test("handles <tool_call> tags, code fences, string arguments and trailing commas", async () => {
    const tagged = await run([
      ...textEvents("t1", ['<tool_call>\n{"name": "read", "arguments": "{\\"path\\": \\"a.py\\"}"}\n</tool_call>']),
      finish(),
    ])
    expect(calls(tagged)).toEqual([{ name: "read", input: { path: "a.py" } }])
    const fenced = await run([
      ...textEvents("t1", ['```json\n{"function": {"name": "edit", "arguments": {"path": "a.py",}}}\n```']),
      finish(),
    ])
    expect(calls(fenced)).toEqual([{ name: "edit", input: { path: "a.py" } }])
  })

  test("keeps normal text streaming untouched", async () => {
    const out = await run([...textEvents("t1", ["Hello! ", "How can I help?"]), finish()])
    expect(calls(out)).toEqual([])
    expect(text(out)).toBe("Hello! How can I help?")
    expect(out.map((event) => event.type)).toEqual(["text-start", "text-delta", "text-delta", "text-end", "step-finish"])
  })

  test("runs a call that follows explanatory text, and keeps the text", async () => {
    const out = await run([
      ...textEvents("t1", ["Let me run the tests.\n", '{"name": "shell", "arguments": {"command": "ls"}}']),
      finish(),
    ])
    expect(text(out)).toContain("Let me run the tests.")
    expect(calls(out)).toEqual([{ name: "shell", input: { command: "ls" } }])
  })

  test("ignores JSON that does not name an offered tool", async () => {
    const unknown = await run([...textEvents("t1", ['{"name": "delete_everything", "arguments": {}}']), finish()])
    expect(calls(unknown)).toEqual([])
    expect(text(unknown)).toBe('{"name": "delete_everything", "arguments": {}}')
    const plain = await run([...textEvents("t1", ['{"answer": 20}']), finish()])
    expect(text(plain)).toBe('{"answer": 20}')
  })

  test("leaves native tool calls alone", async () => {
    const native = LLMEvent.toolCall({ id: "c1", name: "shell", input: { command: "ls" } })
    const out = await run([native, ...textEvents("t1", ['{"name": "read", "arguments": {"path": "x"}}']), finish()])
    expect(calls(out)).toEqual([{ name: "shell", input: { command: "ls" } }])
  })

  test("does nothing when no tools are offered", async () => {
    const out = await run([...textEvents("t1", ['{"name": "shell", "arguments": {}}']), finish()], new Set())
    expect(calls(out)).toEqual([])
  })

  test("flushes held text if the stream ends without text-end", async () => {
    const out = await run([LLMEvent.textStart({ id: "t1" }), LLMEvent.textDelta({ id: "t1", text: '{"half": ' })])
    expect(text(out)).toBe('{"half": ')
  })

  test("shows the answer inside a made-up tool call as normal text", async () => {
    const markdown = await run([
      ...textEvents("t1", ['{ "name": "markdown", "arguments": { "content": "| A | B |\\n|---|---|\\n| 1 | 2 |" } }']),
      finish(),
    ])
    expect(calls(markdown)).toEqual([])
    expect(text(markdown)).toBe("| A | B |\n|---|---|\n| 1 | 2 |")
    const ask = await run([
      ...textEvents("t1", [
        '{"name": "ask", "arguments": {"questions": [{"header": "LLM", "question": "LLM stands for Large Language Model."}]}}',
      ]),
      finish(),
    ])
    expect(text(ask)).toBe("LLM stands for Large Language Model.")
    const fenced = await run([...textEvents("t1", ['```json\n{"name": "reply", "arguments": {"text": "Hi"}}\n```']), finish()])
    expect(text(fenced)).toBe("Hi")
  })

  test("keeps JSON with extra text, or a real offered tool, untouched by unwrapping", async () => {
    expect(TextToolCalls.unwrap('{"name": "markdown", "arguments": {"content": "x"}} and more', tools)).toBeUndefined()
    expect(TextToolCalls.unwrap('{"name": "read", "arguments": {"path": "x"}}', tools)).toBeUndefined()
  })

  test("runs a one-line command the model said it would run but only showed", async () => {
    const out = await run([
      ...textEvents("t1", [
        "To list the files in this project, I will use the `shell` tool to run a command. Here is the command:\n\n```\nls -la\n```\n\nThe output will list all files.",
      ]),
      finish(),
    ])
    expect(calls(out)).toEqual([{ name: "shell", input: { command: "ls -la" } }])
    expect(text(out)).toContain("I will use the `shell` tool")
  })

  test("does not run example commands without a clear intent, or with several blocks", () => {
    expect(TextToolCalls.describedCommand("You can list files with:\n```bash\nls -la\n```", tools)).toBeUndefined()
    expect(
      TextToolCalls.describedCommand("I will run these commands:\n```\nls\n```\nand\n```\npwd\n```", tools),
    ).toBeUndefined()
    expect(TextToolCalls.describedCommand("I will run this command:\n```python\nprint(1)\n```", tools)).toBeUndefined()
    expect(TextToolCalls.describedCommand("I will run this command:\n```\nrm <file>\n```", tools)).toBeUndefined()
    expect(TextToolCalls.describedCommand("I will run this command:\n```sh\n$ python3 -m unittest\n```", tools)).toBe(
      "python3 -m unittest",
    )
  })

  test("hides a JSON call that follows explanatory text, and runs it", async () => {
    const out = await run([
      ...textEvents("t1", [
        "To read the file, I will use the read tool.\n",
        '{"name": "read", ',
        '"arguments": {"path": "a.py"}}',
      ]),
      finish(),
    ])
    expect(calls(out)).toEqual([{ name: "read", input: { path: "a.py" } }])
    expect(text(out)).toBe("To read the file, I will use the read tool.\n")
  })

  test("still streams normal text and code blocks, and keeps JSON that is not a call", async () => {
    const streamed = await run([...textEvents("t1", ["Line one\n", "```python\nprint(1)\n```\n", "Done"]), finish()])
    expect(text(streamed)).toBe("Line one\n```python\nprint(1)\n```\nDone")
    expect(streamed.filter((event) => event.type === "text-delta").length).toBeGreaterThan(1)
    const example = await run([...textEvents("t1", ["Example config:\n", '{"port": 8080}']), finish()])
    expect(calls(example)).toEqual([])
    expect(text(example)).toBe('Example config:\n{"port": 8080}')
  })
})
