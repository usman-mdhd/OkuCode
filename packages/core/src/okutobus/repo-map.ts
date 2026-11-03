export * as OkuRepoMap from "./repo-map.js"

// Okutobus (OkuCode) SRS FR-18: repository map. Every source file in the project is parsed with tree-sitter and its
// classes, functions and methods are listed with their signatures. Files are ranked by how often their symbols are
// used elsewhere in the project, and by how well they match a query, so the model can pick the files it needs without
// reading the whole project.
//
// A short map (top files, top-level symbols) goes into the system prompt of every chat in a code project. The
// repo_map tool returns a longer, query-ranked map with methods. "repoMap": false in okucode.json turns the short map
// off. Parsed outlines are cached by file size and modification time.

import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { OkuApproval } from "./approval.js"

const require = createRequire(import.meta.url)

/** File extension → tree-sitter grammar in tree-sitter-wasms. */
const LANGUAGES: Record<string, string> = {
  ".py": "python",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".java": "java",
  ".go": "go",
  ".rs": "rust",
  ".cs": "c_sharp",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".rb": "ruby",
  ".php": "php",
  ".kt": "kotlin",
  ".swift": "swift",
  ".scala": "scala",
  ".dart": "dart",
  ".lua": "lua",
}

// Definitions whose body is not searched further (functions and methods).
const FUNCTIONS = new Set([
  "function_definition",
  "function_declaration",
  "function_item",
  "method_definition",
  "method_declaration",
  "constructor_declaration",
  "method",
  "singleton_method",
  "function_signature_item",
])
// Definitions that can hold methods.
const CONTAINERS = new Set([
  "class_definition",
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "struct_declaration",
  "struct_item",
  "enum_item",
  "trait_item",
  "impl_item",
  "mod_item",
  "class_specifier",
  "struct_specifier",
  "class",
  "module",
  "object_declaration",
  "protocol_declaration",
  "type_alias_declaration",
  "type_spec",
])
// git pathspecs for the languages above, so content search skips docs, data and lock files.
const SOURCE_SPECS = () => [...new Set(Object.keys(LANGUAGES))].map((extension) => `*${extension}`)
const VALUE_FUNCTIONS = new Set(["arrow_function", "function_expression", "function"])

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "venv",
  ".venv",
  "env",
  "__pycache__",
  ".next",
  ".nuxt",
  ".okucode",
  ".cache",
  "coverage",
  "bin",
  "obj",
])

const MAX_FILES = 1500
const MAX_FILE_BYTES = 256 * 1024
const MAX_ENTRIES_PER_FILE = 80

export type Entry = {
  readonly depth: number
  readonly kind: "function" | "container" | "type"
  readonly name: string
  readonly line: number
  readonly signature: string
}

export type FileOutline = {
  readonly path: string
  readonly entries: ReadonlyArray<Entry>
  /** Identifiers used in the file, for ranking by references. */
  readonly words: ReadonlySet<string>
}

type TreeNode = {
  type: string
  text: string
  startIndex: number
  startPosition: { row: number }
  namedChildren: ReadonlyArray<TreeNode | null>
  childForFieldName: (name: string) => TreeNode | null
}
type Parser = { setLanguage: (language: unknown) => void; parse: (text: string) => { rootNode: TreeNode } | null }

let runtime: Promise<{ Parser: new () => Parser; load: (lang: string) => Promise<unknown> }> | undefined
const languages = new Map<string, Promise<unknown>>()

function init() {
  runtime ??= (async () => {
    const { Parser, Language } = await import("web-tree-sitter")
    await Parser.init({
      locateFile: () =>
        process.env.OPENCODE_TREE_SITTER_WASM_PATH ?? require.resolve("web-tree-sitter/tree-sitter.wasm"),
    })
    return {
      Parser: Parser as unknown as new () => Parser,
      load: (lang: string) => {
        let language = languages.get(lang)
        if (!language) {
          language = Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${lang}.wasm`))
          languages.set(lang, language)
        }
        return language
      },
    }
  })()
  return runtime
}

export const languageOf = (file: string) => LANGUAGES[path.extname(file).toLowerCase()]

// Folders whose code is rarely what a question is about: listed after the rest, and left out of large projects.
const SECONDARY = /(^|\/)(tests?|__tests__|__mocks__|spec|e2e|fixtures?|stories|storybook|examples?|samples?|docs?|scripts|migrations|generated|test-browser|component-tests)\//i
const SECONDARY_FILE = /([._-](test|spec|stories|story)\.[a-z]+$)|(\.d\.ts$)|(\.min\.js$)/i
export const secondary = (file: string) => SECONDARY.test(file) || SECONDARY_FILE.test(file)

/** Every source file of the project: git's list when it is a git repository, otherwise a folder walk. */
export function allFiles(directory: string): string[] {
  const git = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const all =
    git.status === 0 && git.stdout.trim()
      ? git.stdout.split("\n").filter(Boolean)
      : walk(directory, "", [])
  return all.filter((file) => languageOf(file) && !file.split("/").some((part) => IGNORED_DIRS.has(part)))
}

/** The files the map covers: main code first, tests and examples after, at most MAX_FILES. */
export function listFiles(directory: string): string[] {
  const all = allFiles(directory)
  return [...all.filter((file) => !secondary(file)), ...all.filter(secondary)].slice(0, MAX_FILES)
}

const isGit = (directory: string) =>
  spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: directory, encoding: "utf8", timeout: 5_000 })
    .stdout?.trim() === "true"

function walk(root: string, relative: string, out: string[]): string[] {
  if (out.length >= 20_000) return out
  let names: string[]
  try {
    names = readdirSync(path.join(root, relative))
  } catch {
    return out
  }
  for (const name of names.sort()) {
    if (name.startsWith(".") || IGNORED_DIRS.has(name)) continue
    const child = relative ? `${relative}/${name}` : name
    let stat
    try {
      stat = statSync(path.join(root, child))
    } catch {
      continue
    }
    if (stat.isDirectory()) walk(root, child, out)
    else if (stat.isFile()) out.push(child)
  }
  return out
}

/** One line: the definition up to its body, whitespace collapsed. */
function signatureOf(node: TreeNode) {
  const body = node.childForFieldName("body")
  let text = body ? node.text.slice(0, body.startIndex - node.startIndex) : node.text.split("\n")[0]!
  // type Name = { ...long... }: the name is enough.
  if (/type_alias|type_spec/.test(node.type)) text = text.split("=")[0]!
  text = text.replace(/\s+/g, " ").trim().replace(/[{:=]\s*$/, "").trim()
  return text.length > 140 ? `${text.slice(0, 137)}...` : text
}

function nameOf(node: TreeNode): string | undefined {
  const named = node.childForFieldName("name") ?? node.childForFieldName("type")
  if (named) return named.text
  // C/C++ functions: the name is inside the declarator.
  let declarator = node.childForFieldName("declarator")
  while (declarator) {
    if (/identifier$/.test(declarator.type)) return declarator.text
    declarator = declarator.childForFieldName("declarator") ?? declarator.namedChildren.find((child) => child && /identifier$/.test(child.type)) ?? null
  }
  return undefined
}

/** Classes, functions and methods of one file, in order. */
export function outlineTree(root: TreeNode): Entry[] {
  const entries: Entry[] = []
  const visit = (node: TreeNode, depth: number) => {
    if (entries.length >= MAX_ENTRIES_PER_FILE) return
    if (FUNCTIONS.has(node.type) || CONTAINERS.has(node.type)) {
      const name = nameOf(node)
      if (name) {
        const container = CONTAINERS.has(node.type)
        const alias = node.type === "type_alias_declaration" || node.type === "type_spec"
        entries.push({
          depth,
          kind: alias ? "type" : container ? "container" : "function",
          name,
          line: node.startPosition.row + 1,
          signature: signatureOf(node),
        })
        if (!container) return
        for (const child of node.namedChildren) if (child) visit(child, depth + 1)
        return
      }
    }
    // const add = (a, b) => a + b
    if (node.type === "variable_declarator") {
      const value = node.childForFieldName("value")
      const name = node.childForFieldName("name")
      if (value && name && VALUE_FUNCTIONS.has(value.type)) {
        const params = value.childForFieldName("parameters") ?? value.childForFieldName("parameter")
        entries.push({
          depth,
          kind: "function",
          name: name.text,
          line: node.startPosition.row + 1,
          signature: `${name.text}${params ? (params.text.startsWith("(") ? params.text : `(${params.text})`) : "()"}`
            .replace(/\s+/g, " ")
            .slice(0, 140),
        })
        return
      }
    }
    for (const child of node.namedChildren) if (child) visit(child, depth)
  }
  visit(root, 0)
  return entries
}

const WORD = /[A-Za-z_][A-Za-z0-9_]{2,}/g
const cache = new Map<string, { size: number; mtime: number; outline: FileOutline }>()

/** Outlines of the project's source files (cached by size and modification time). */
export async function build(directory: string, files = listFiles(directory)): Promise<FileOutline[]> {
  if (files.length === 0) return []
  // Without tree-sitter (grammars not installed) files are still listed, with no symbols.
  const ts = await init().catch(() => undefined)
  const out: FileOutline[] = []
  for (const file of files) {
    const absolute = path.join(directory, file)
    let stat
    try {
      stat = statSync(absolute)
    } catch {
      continue
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue
    const cached = cache.get(absolute)
    if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs) {
      out.push(cached.outline)
      continue
    }
    try {
      const text = readFileSync(absolute, "utf8")
      if (!ts) {
        out.push({ path: file, entries: [], words: new Set(text.match(WORD) ?? []) })
        continue
      }
      const parser = new ts.Parser()
      parser.setLanguage(await ts.load(languageOf(file)!))
      const tree = parser.parse(text)
      const outline: FileOutline = {
        path: file,
        entries: tree ? outlineTree(tree.rootNode) : [],
        words: new Set(text.match(WORD) ?? []),
      }
      cache.set(absolute, { size: stat.size, mtime: stat.mtimeMs, outline })
      out.push(outline)
    } catch {
      // A grammar that fails to load: the file is still listed, with no symbols.
      out.push({ path: file, entries: [], words: new Set() })
    }
  }
  return out
}

const queryWords = (query: string) =>
  [
    ...new Set(
      query
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3),
    ),
  ]

/**
 * Files ordered by importance: symbols used in other files, words of the query in the path or symbol names, and an
 * optional extra score per path (search matches).
 */
export function rank(files: ReadonlyArray<FileOutline>, query = "", boost?: ReadonlyMap<string, number>): FileOutline[] {
  const words = queryWords(query)
  // In how many files each identifier appears.
  const usedIn = new Map<string, number>()
  for (const file of files) for (const word of file.words) usedIn.set(word, (usedIn.get(word) ?? 0) + 1)
  const score = (file: FileOutline) => {
    let value = boost?.get(file.path) ?? 0
    for (const entry of file.entries) {
      if (entry.depth > 0 && entry.kind === "function") continue
      const uses = (usedIn.get(entry.name) ?? 0) - (file.words.has(entry.name) ? 1 : 0)
      value += Math.log2(1 + Math.max(0, uses))
    }
    value += Math.min(file.entries.length, 20) * 0.05
    const lowerPath = file.path.toLowerCase()
    for (const word of words) {
      if (lowerPath.includes(word)) value += 20
      if (file.entries.some((entry) => entry.name.toLowerCase().includes(word))) value += 10
      else if ([...file.words].some((name) => name.toLowerCase() === word)) value += 3
    }
    // Tests and examples rank below the code they test unless asked for.
    if (secondary(file.path)) value *= 0.5
    return value
  }
  return files
    .map((file) => ({ file, value: score(file) }))
    .sort((a, b) => b.value - a.value || a.file.path.localeCompare(b.file.path))
    .map((item) => item.file)
}

/**
 * The map as text, best files first, within `budget` characters. `methods` includes members of classes, `lines` adds
 * line numbers, `types` includes type aliases, `perFile` caps the symbols listed for one file.
 */
export function render(
  files: ReadonlyArray<FileOutline>,
  budget: number,
  options: { methods?: boolean; lines?: boolean; types?: boolean; perFile?: number } = {},
) {
  const out: string[] = []
  let used = 0
  let left = 0
  for (const file of files) {
    if (used + file.path.length + 1 > budget) {
      left++
      continue
    }
    out.push(file.path)
    used += file.path.length + 1
    const entries = file.entries.filter(
      (entry) => (options.methods || entry.depth === 0) && (options.types || entry.kind !== "type"),
    )
    let shown = 0
    for (const entry of entries) {
      if (options.perFile !== undefined && shown >= options.perFile) break
      const line = `${"  ".repeat(entry.depth + 1)}${entry.signature}${options.lines ? `  (line ${entry.line})` : ""}`
      if (used + line.length + 1 > budget) break
      out.push(line)
      used += line.length + 1
      shown++
    }
    if (shown < entries.length) {
      const more = `${"  "}... ${entries.length - shown} more`
      if (used + more.length + 1 <= budget) {
        out.push(more)
        used += more.length + 1
      }
    }
  }
  if (left > 0) out.push(`(${left} more source files not shown)`)
  return out.join("\n")
}

// Words that say nothing about where the code is.
const STOP = new Set(
  "where what which when how does do is are the this that these those there here code file files logic function functions class method find show tell explain implemented implementation defined located handle handled handles work works project repo repository please can you could would should about with from into for and not use used using make get set new add fix change update write read".split(
    " ",
  ),
)

/** Search words from a request, most specific first. */
export function terms(text: string) {
  return queryWords(text).filter((word) => word.length >= 4 && !STOP.has(word)).slice(0, 6)
}

/**
 * Source files that match the request: words in the path, and words (or the words written together, such as
 * approvalMode / approval_mode) in the content, found with git grep or in the outlined files. Best first.
 */
export function search(directory: string, text: string, limit = 12, minimum = 0): string[] {
  return scored(directory, text, limit, minimum).map((item) => item.file)
}

/** search() with the score of each file. */
export function scored(directory: string, text: string, limit = 12, minimum = 0): { file: string; score: number }[] {
  const words = terms(text)
  if (words.length === 0) return []
  const files = allFiles(directory)
  const known = new Set(files)
  const score = new Map<string, number>()
  const add = (file: string, value: number) => {
    if (known.has(file)) score.set(file, (score.get(file) ?? 0) + value)
  }
  for (const file of files) {
    // Whole words of the path: packages/app/approval-setting.tsx → packages, app, approval, setting, tsx.
    const parts = new Set(
      file
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/),
    )
    for (const word of words)
      if (parts.has(word) || parts.has(`${word}s`) || (word.endsWith("s") && parts.has(word.slice(0, -1)))) add(file, 12)
  }
  const patterns = [
    ...words.map((word) => ({ pattern: word, value: 4 })),
    ...words.slice(1).map((word, i) => ({ pattern: `${words[i]}[_ -]?${word}`, value: 10 })),
  ]
  if (isGit(directory)) {
    for (const { pattern, value } of patterns) {
      const result = spawnSync("git", ["grep", "-l", "-i", "-w", "-E", "-e", pattern, "--", ...SOURCE_SPECS()], {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 32 * 1024 * 1024,
      })
      if (result.status !== 0 || !result.stdout) continue
      const hits = result.stdout.split("\n").filter(Boolean)
      // A word found in hundreds of files says little.
      const weight = hits.length > 200 ? value / 4 : value
      for (const file of hits) add(file, weight)
    }
  } else {
    for (const [absolute, item] of cache) {
      if (!absolute.startsWith(directory)) continue
      const names = [...item.outline.words].map((name) => name.toLowerCase())
      for (const word of words) if (names.some((name) => name.includes(word))) add(item.outline.path, 4)
    }
  }
  for (const [file, value] of score) if (secondary(file)) score.set(file, value / 3)
  return [...score.entries()]
    .filter(([, value]) => value > minimum)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, limit)
    .map(([file, value]) => ({ file, score: value }))
}

/** The files that match the request with their outlines, for the system prompt; undefined when none match. */
const recent = new Map<string, { at: number; value: Promise<string | undefined> }>()

/**
 * The file to attach to a message: the best match when it clearly beats the rest (a word in its path plus words in
 * its code), and is small enough to send whole. Small models answer from code they see far better than from a list.
 */
export function bestFile(directory: string, text: string, maxBytes = 24 * 1024): string | undefined {
  if (!enabled()) return undefined
  const [first, second] = scored(directory, text, 2, 19)
  if (!first || secondary(first.file)) return undefined
  if (second && second.score >= first.score * 0.9 && second.file.length < first.file.length) return undefined
  try {
    const info = statSync(path.join(directory, first.file))
    if (!info.isFile() || info.size > maxBytes) return undefined
  } catch {
    return undefined
  }
  return first.file
}

export function relevant(directory: string, text: string, budget = 2000): Promise<string | undefined> {
  if (!enabled()) return Promise.resolve(undefined)
  // Every step of a turn asks again for the same message: answer from memory for a minute.
  const key = `${directory}\n${budget}\n${text}`
  const hit = recent.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  const value = findRelevant(directory, text, budget).catch(() => undefined)
  recent.set(key, { at: Date.now(), value })
  if (recent.size > 50) recent.delete(recent.keys().next().value!)
  return value
}

async function findRelevant(directory: string, text: string, budget: number): Promise<string | undefined> {
  // Only clear matches: a word in the path, words written together, or three words in the content.
  const files = search(directory, text, 8, 11)
  if (files.length === 0) return undefined
  const outlines = await build(directory, files)
  const order = new Map(files.map((file, i) => [file, i]))
  outlines.sort((a, b) => order.get(a.path)! - order.get(b.path)!)
  return render(outlines, budget, { methods: true, lines: true, perFile: 12 })
}

export const enabled = () => {
  try {
    return (JSON.parse(readFileSync(OkuApproval.settingsFile(), "utf8")) as { repoMap?: unknown }).repoMap !== false
  } catch {
    return true
  }
}

export const SHORT_BUDGET = 2400
export const LONG_BUDGET = 9000

/** The short map for the system prompt, or undefined for folders with fewer than two source files. */
export async function short(directory: string): Promise<string | undefined> {
  if (!enabled()) return undefined
  const files = await build(directory)
  if (files.length < 2) return undefined
  return render(rank(files), SHORT_BUDGET, { methods: true, perFile: 10 })
}

/** The longer map for the repo_map tool, ranked for `query`. */
export async function long(directory: string, query = "", focus?: string) {
  // Files that match the query come first, even in projects too large for the whole map.
  const matched = query ? search(directory, query, 30) : []
  const files = await build(directory, [...new Set([...matched, ...listFiles(directory)])])
  const chosen = focus ? files.filter((file) => file.path.startsWith(focus.replace(/^\.\//, ""))) : files
  if (chosen.length === 0) return "No source files found."
  const boost = new Map(matched.map((file, i) => [file, 60 - i * 2]))
  return render(rank(chosen, query, boost), LONG_BUDGET, { methods: true, lines: true, types: true, perFile: 40 })
}
