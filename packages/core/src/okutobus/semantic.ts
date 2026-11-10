export * as OkuSemantic from "./semantic.js"

// Okutobus (OkuCode) SRS FR-19: semantic code search — find code by what it does ("where do we check passwords?"),
// not only by the words in it.
//
// The project's source files are cut into pieces (one per function or class, from the repository map's outlines,
// or blocks of lines), and each piece is turned into an embedding by a local embedding model. A question is embedded
// the same way and the closest pieces are returned with file and line numbers. Nothing leaves the computer.
//
// okucode.json "semanticSearch": { "model": "nomic-embed-text", "url": "http://localhost:11434/v1" }
//   (the defaults: Ollama on this computer; `ollama pull nomic-embed-text` once). false turns it off.
// The index is kept in <data>/semantic/<project>.json and only changed files are embedded again.

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Global } from "@opencode/util/global"
import { OkuApproval } from "./approval.js"
import { OkuRepoMap } from "./repo-map.js"

export type Settings = { readonly model: string; readonly url: string; readonly key?: string }

const DEFAULTS: Settings = { model: "nomic-embed-text", url: "http://localhost:11434/v1" }
const MAX_FILES = 1500
const MAX_FILE_BYTES = 200 * 1024
const PIECE_LINES = 60
const PIECE_CHARS = 2400
const BATCH = 32

export function settings(): Settings | undefined {
  try {
    const value = (JSON.parse(readFileSync(OkuApproval.settingsFile(), "utf8")) as { semanticSearch?: unknown })
      .semanticSearch
    if (value === false) return undefined
    if (!value || typeof value !== "object") return DEFAULTS
    const item = value as { model?: unknown; url?: unknown; key?: unknown }
    return {
      model: typeof item.model === "string" && item.model ? item.model : DEFAULTS.model,
      url: typeof item.url === "string" && item.url ? item.url.replace(/\/+$/, "") : DEFAULTS.url,
      ...(typeof item.key === "string" && item.key ? { key: item.key } : {}),
    }
  } catch {
    return DEFAULTS
  }
}

export type Piece = {
  readonly file: string
  readonly start: number
  readonly end: number
  readonly title: string
  readonly text: string
}

/** Cuts a file into pieces: one per top-level function or class (from the outline), otherwise blocks of lines. */
export function pieces(
  file: string,
  content: string,
  starts: ReadonlyArray<{ line: number; name: string }> = [],
): Piece[] {
  const lines = content.split("\n")
  const out: Piece[] = []
  const add = (start: number, end: number, title: string) => {
    for (let from = start; from <= end; from += PIECE_LINES) {
      const to = Math.min(end, from + PIECE_LINES - 1)
      const text = lines
        .slice(from - 1, to)
        .join("\n")
        .slice(0, PIECE_CHARS)
      if (text.trim()) out.push({ file, start: from, end: to, title, text })
    }
  }
  const sorted = [...starts]
    .filter((item) => item.line >= 1 && item.line <= lines.length)
    .sort((a, b) => a.line - b.line)
  if (!sorted.length) {
    add(1, lines.length, file)
    return out
  }
  if (sorted[0]!.line > 1) add(1, sorted[0]!.line - 1, file)
  sorted.forEach((item, index) => add(item.line, (sorted[index + 1]?.line ?? lines.length + 1) - 1, item.name))
  return out
}

export function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>) {
  let dot = 0
  let left = 0
  let right = 0
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    dot += a[index]! * b[index]!
    left += a[index]! * a[index]!
    right += b[index]! * b[index]!
  }
  return left && right ? dot / Math.sqrt(left * right) : 0
}

export class EmbeddingError extends Error {}

/** Embeds texts with the OpenAI-compatible /embeddings endpoint (Ollama, vLLM, LiteLLM, OpenAI). */
export async function embed(texts: string[], config: Settings, prefix = ""): Promise<number[][]> {
  const out: number[][] = []
  for (let index = 0; index < texts.length; index += BATCH) {
    const batch = texts.slice(index, index + BATCH).map((text) => prefix + text)
    const response = await fetch(`${config.url}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(config.key ? { authorization: `Bearer ${config.key}` } : {}) },
      body: JSON.stringify({ model: config.model, input: batch }),
      signal: AbortSignal.timeout(120_000),
    }).catch((error) => {
      throw new EmbeddingError(
        `Cannot reach the embedding model at ${config.url} (${error instanceof Error ? error.message : error}). Is Ollama running?`,
      )
    })
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 300)
      throw new EmbeddingError(
        /not found|pull/i.test(body)
          ? `The embedding model "${config.model}" is not installed. Run: ollama pull ${config.model}`
          : `The embedding model answered ${response.status}: ${body}`,
      )
    }
    const data = (await response.json()) as { data?: { embedding: number[]; index?: number }[] }
    const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    if (rows.length !== batch.length)
      throw new EmbeddingError("The embedding model returned the wrong number of results.")
    out.push(...rows.map((row) => row.embedding))
  }
  return out
}

type Stored = {
  file: string
  size: number
  mtime: number
  pieces: (Omit<Piece, "text" | "file"> & { vector: number[] })[]
}
type Index = { model: string; files: Record<string, Stored> }

const indexFile = (directory: string) =>
  path.join(
    Global.Path.data,
    "semantic",
    `${createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 16)}.json`,
  )

function load(directory: string, model: string): Index {
  try {
    const data = JSON.parse(readFileSync(indexFile(directory), "utf8")) as Index
    if (data.model === model && data.files) return data
  } catch {}
  return { model, files: {} }
}

function save(directory: string, index: Index) {
  const file = indexFile(directory)
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, JSON.stringify(index), { mode: 0o600 })
}

// nomic-embed-text works best with these task prefixes; other models ignore them.
const prefixes = (model: string) =>
  /nomic/i.test(model) ? { document: "search_document: ", query: "search_query: " } : { document: "", query: "" }

/** Brings the index up to date: new and changed files are embedded, removed files are dropped. */
export async function update(directory: string, config: Settings) {
  const index = load(directory, config.model)
  const files = OkuRepoMap.listFiles(directory).slice(0, MAX_FILES)
  const outlines = new Map((await OkuRepoMap.build(directory, files).catch(() => [])).map((item) => [item.path, item]))
  const wanted = new Set(files)
  let changed = 0
  for (const name of Object.keys(index.files)) if (!wanted.has(name)) delete index.files[name]
  const todo: { stored: Stored; list: Piece[] }[] = []
  for (const file of files) {
    let stat
    try {
      stat = statSync(path.join(directory, file))
    } catch {
      continue
    }
    if (stat.size > MAX_FILE_BYTES) continue
    const known = index.files[file]
    if (known && known.size === stat.size && known.mtime === stat.mtimeMs) continue
    const content = readFileSync(path.join(directory, file), "utf8")
    const starts = (outlines.get(file)?.entries ?? []).filter((entry) => entry.depth === 0)
    todo.push({
      stored: { file, size: stat.size, mtime: stat.mtimeMs, pieces: [] },
      list: pieces(file, content, starts),
    })
  }
  const all = todo.flatMap((item) => item.list)
  if (all.length) {
    const { document } = prefixes(config.model)
    const vectors = await embed(
      all.map((piece) => `${piece.file} ${piece.title}\n${piece.text}`),
      config,
      document,
    )
    let at = 0
    for (const item of todo) {
      item.stored.pieces = item.list.map((piece) => ({
        start: piece.start,
        end: piece.end,
        title: piece.title,
        vector: vectors[at++]!,
      }))
      index.files[item.stored.file] = item.stored
      changed++
    }
  }
  if (changed || Object.keys(index.files).length !== files.length) save(directory, index)
  return { index, changed, files: Object.keys(index.files).length }
}

export type Hit = { file: string; start: number; end: number; title: string; score: number }

export async function search(directory: string, query: string, limit = 8, config = settings()): Promise<Hit[]> {
  if (!config) throw new EmbeddingError('Semantic search is turned off ("semanticSearch": false in okucode.json).')
  const { index } = await update(directory, config)
  const [vector] = await embed([query], config, prefixes(config.model).query)
  const hits: Hit[] = []
  for (const stored of Object.values(index.files))
    for (const piece of stored.pieces)
      hits.push({
        file: stored.file,
        start: piece.start,
        end: piece.end,
        title: piece.title,
        score: cosine(vector!, piece.vector),
      })
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(limit, 30)))
}

/** The hits as text for the model: file, lines, name and the code itself. */
export function render(directory: string, hits: ReadonlyArray<Hit>, maxLines = 40) {
  if (!hits.length) return "No code found for this question."
  return hits
    .map((hit) => {
      let code = ""
      try {
        code = readFileSync(path.join(directory, hit.file), "utf8")
          .split("\n")
          .slice(hit.start - 1, Math.min(hit.end, hit.start - 1 + maxLines))
          .map((line, index) => `${hit.start + index}: ${line}`)
          .join("\n")
      } catch {}
      return `${hit.file}:${hit.start}-${hit.end} ${hit.title} (match ${hit.score.toFixed(2)})\n${code}`
    })
    .join("\n\n")
}
