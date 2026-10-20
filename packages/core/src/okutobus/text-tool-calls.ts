export * as TextToolCalls from "./text-tool-calls.js"

// Okutobus (OkuCode) — SRS FR-48: robust tool-call parsing for open-weight models.
//
// Small local models (e.g. Qwen2.5-Coder 7B via Ollama) often write a tool call as plain text
// instead of a native tool call, for example
//   {"name": "shell", "arguments": {"command": "python3 -m unittest"}}
//   <tool_call>{"name": "read", "arguments": {...}}</tool_call>
//   ```json {"name": ...} ```
// The agent loop then shows the JSON and never runs the tool. This transform sits on the model
// event stream of every provider and turns such text into real tool calls — only when the model
// made no native tool call in that step and the text names a tool that was actually offered.

import { LLMEvent } from "@opencode/ai"
import { Stream } from "effect"

type Event = LLMEvent
type TextState = { start?: Event; text: string; mode: "undecided" | "buffer" | "pass" }
export type ParsedCall = { readonly name: string; readonly input: Record<string, unknown> }

const MAYBE_CALL = ["{", "[", "<tool_call", "<function", "```"]

/** Names of the top-level tools offered to the model in this request. */
export function offeredTools(tools: ReadonlyArray<{ readonly type: string; readonly name: string }> | undefined) {
  const names = new Set<string>()
  for (const tool of tools ?? []) if (tool.type === "tool") names.add(tool.name)
  return names
}

/** Applies the transform to a model event stream. */
export function apply<E, R>(stream: Stream.Stream<Event, E, R>, tools: ReadonlySet<string>): Stream.Stream<Event, E, R> {
  if (tools.size === 0) return stream
  const state = make(tools)
  return Stream.concat(
    stream.pipe(Stream.flatMap((event) => Stream.fromIterable(state.handle(event)))),
    Stream.suspend(() => Stream.fromIterable(state.flush())),
  )
}

/** Stateful event rewriter: feed events to `handle`, then call `flush` once at the end. */
export function make(tools: ReadonlySet<string>) {
  const texts = new Map<string, TextState>()
  let native = false
  let converted = 0

  const callEvents = (text: string): Event[] => {
    if (native) return []
    return parse(text, tools).map((call) => {
      converted++
      return LLMEvent.toolCall({
        id: `call_okc_${Date.now().toString(36)}_${converted}`,
        name: call.name,
        input: call.input,
      })
    })
  }

  const textEvents = (id: string, state: TextState): Event[] => {
    const out: Event[] = []
    if (state.start) out.push(state.start)
    if (state.text) out.push(LLMEvent.textDelta({ id, text: state.text }))
    state.start = undefined
    return out
  }

  const finishText = (id: string, end?: Event): Event[] => {
    const state = texts.get(id)
    texts.delete(id)
    if (!state) return end ? [end] : []
    if (state.mode === "pass") return [...(end ? [end] : []), ...callEvents(state.text)]
    // Held back because it looked like a call from the start: replace it with the call if it parses.
    const calls = callEvents(state.text)
    if (calls.length > 0) return calls
    return [...textEvents(id, state), end ?? LLMEvent.textEnd({ id })]
  }

  const handle = (event: Event): Event[] => {
    switch (event.type) {
      case "tool-call":
      case "tool-input-start":
        native = true
        return [event]
      case "text-start":
        texts.set(event.id, { start: event, text: "", mode: "undecided" })
        return []
      case "text-delta": {
        const state = texts.get(event.id)
        if (!state) return [event]
        state.text += event.text
        if (state.mode === "pass") return [event]
        if (state.mode === "buffer") return []
        const head = state.text.trimStart()
        if (head.length === 0) return []
        // Starts like a call: hold until the text ends. Could still become one ("<tool"): keep waiting.
        if (MAYBE_CALL.some((prefix) => head.startsWith(prefix))) {
          state.mode = "buffer"
          return []
        }
        if (MAYBE_CALL.some((prefix) => prefix.startsWith(head))) return []
        state.mode = "pass"
        return textEvents(event.id, state)
      }
      case "text-end":
        return finishText(event.id, event)
      case "step-finish":
      case "finish":
        return [...[...texts.keys()].flatMap((id) => finishText(id)), event]
      default:
        return [event]
    }
  }

  const flush = (): Event[] => [...texts.keys()].flatMap((id) => finishText(id))

  return { handle, flush, converted: () => converted }
}

/** Finds tool calls written as JSON in model text. Only names in `tools` are accepted. */
export function parse(text: string, tools: ReadonlySet<string>): ParsedCall[] {
  if (!text.includes("{")) return []
  const calls: ParsedCall[] = []
  for (const blob of jsonValues(text)) {
    const value = parseJson(blob)
    for (const item of Array.isArray(value) ? value : [value]) {
      const call = toCall(item, tools)
      if (call) calls.push(call)
    }
  }
  return calls
}

function toCall(item: unknown, tools: ReadonlySet<string>): ParsedCall | undefined {
  if (!isRecord(item)) return undefined
  const fn = isRecord(item.function) ? item.function : item
  const name = typeof fn.name === "string" ? fn.name : typeof fn.tool === "string" ? fn.tool : undefined
  if (!name || !tools.has(name)) return undefined
  const raw = fn.arguments ?? fn.parameters ?? fn.args ?? fn.input ?? {}
  const input = typeof raw === "string" ? parseJson(raw) : raw
  if (!isRecord(input)) return undefined
  return { name, input }
}

/** Top-level `{...}` and `[...]` substrings, aware of JSON strings and escapes. */
function* jsonValues(text: string): Generator<string> {
  let depth = 0
  let start = -1
  let open = ""
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (depth > 0 && ch === '"') inString = true
    else if (depth === 0 && (ch === "{" || ch === "[")) {
      depth = 1
      start = i
      open = ch
    } else if (depth > 0 && ch === open) depth++
    else if (depth > 0 && ((open === "{" && ch === "}") || (open === "[" && ch === "]"))) {
      depth--
      if (depth === 0) yield text.slice(start, i + 1)
    }
  }
}

function parseJson(text: string): unknown {
  for (const candidate of [text, text.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next repair
    }
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
