export * as OkuMentions from "./mentions.js"

// Okutobus (OkuCode): files named in a message are attached automatically.
// Small local models often answer "please provide the code" instead of calling the read tool, and text typed in a
// terminal ("@calculator.py#L5-11", "calculator.py lines 5-11") never becomes an attachment. So when a message names
// a file that exists in the chat's folder, its content (or the named lines) is sent along with the message.

import { statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { OkuDocxRead } from "./docx-read.js"

export const MAX_FILES = 4
export const MAX_BYTES = 60 * 1024
/** Files up to this size are always sent whole, even when the message names only some lines. */
export const WHOLE_BYTES = 24 * 1024

export type Found = { file: string; start?: number; end?: number }

const END = String.raw`(?=$|[\s,;:!?)\]'"\x60]|\.(?:\s|$))`
// @calculator.py, @src/app.py#L5, @src/app.py#L5-11
const AT = new RegExp(String.raw`@([\w.\-/]*[\w\-]\.[A-Za-z][A-Za-z0-9]{0,9})(?:#L(\d+)(?:-L?(\d+))?)?` + END, "g")
// calculator.py, src/app.py lines 5-11, app.py line 3
const BARE = new RegExp(
  String.raw`(?<![\w@/.\-])([\w\-/]*[\w\-]\.[A-Za-z][A-Za-z0-9]{0,9})${END}(?:\s+lines?\s+(\d+)(?:\s*(?:-|to)\s*(\d+))?)?`,
  "gi",
)

const number = (value?: string) => {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/** File names (with optional line ranges) written in `text`, in order, without duplicates. */
export function parse(text: string): Found[] {
  const found = new Map<string, Found>()
  const add = (file: string, start?: string, end?: string) => {
    const key = file.replace(/^\.\//, "")
    const first = number(start)
    const last = number(end) ?? first
    const existing = found.get(key)
    if (existing && (existing.start !== undefined || first === undefined)) return
    found.set(key, { file: key, start: first, end: first === undefined ? undefined : Math.max(first, last ?? first) })
  }
  for (const match of text.matchAll(AT)) add(match[1]!, match[2], match[3])
  for (const match of text.matchAll(BARE)) add(match[1]!, match[2], match[3])
  return [...found.values()]
}

/**
 * Attachments for files named in `text` that exist inside `directory` and are not attached already.
 * Only regular files up to MAX_BYTES inside the chat's folder are used.
 */
export function attachments(
  text: string,
  directory: string,
  attached: readonly string[] = [],
): { uri: string; name: string; description?: string }[] {
  const root = path.resolve(directory)
  const already = new Set(attached.map((uri) => filePath(uri)).filter((value): value is string => !!value))
  const result: { uri: string; name: string; description?: string }[] = []
  for (const item of parse(text)) {
    if (result.length >= MAX_FILES) break
    const absolute = path.resolve(root, item.file)
    if (absolute !== root && !absolute.startsWith(root + path.sep)) continue
    if (already.has(absolute)) continue
    const name = path.relative(root, absolute)
    const word = OkuDocxRead.READABLE.has(path.extname(absolute).toLowerCase())
    let size: number
    try {
      const info = statSync(absolute)
      if (!info.isFile() || info.size > (word ? 20 * MAX_BYTES : MAX_BYTES)) continue
      size = info.size
    } catch {
      continue
    }
    if (word) {
      // Word files are sent as Markdown text.
      let text: string
      try {
        text = OkuDocxRead.readFile(absolute)
      } catch {
        continue
      }
      if (Buffer.byteLength(text) > MAX_BYTES) continue
      already.add(absolute)
      result.push({
        uri: `data:text/plain;base64,${Buffer.from(text || " ").toString("base64")}`,
        name,
        description: `The Word document ${name}, shown as Markdown. To change it, call the document tool with path "${name}" and the complete corrected Markdown.`,
      })
      continue
    }
    already.add(absolute)
    const url = pathToFileURL(absolute)
    if (item.start === undefined) {
      result.push({ uri: url.href, name, description: "The whole file." })
      continue
    }
    const lines = item.end && item.end !== item.start ? `lines ${item.start}-${item.end}` : `line ${item.start}`
    // A model shown only some lines may rewrite the file with just those lines and delete the rest, so small files
    // are sent whole and the named lines are pointed out.
    if (size <= WHOLE_BYTES) {
      result.push({ uri: url.href, name, description: `The whole file. The user is asking about ${lines}.` })
      continue
    }
    url.searchParams.set("start", String(item.start))
    url.searchParams.set("end", String(item.end ?? item.start))
    result.push({
      uri: url.href,
      name: `${name} (${lines})`,
      description: `Only ${lines} of a longer file. To change it, use the edit tool on these lines; never write the whole file from this part.`,
    })
  }
  return result
}

function filePath(uri: string) {
  try {
    const url = new URL(uri)
    if (url.protocol !== "file:") return undefined
    url.search = ""
    url.hash = ""
    return path.resolve(decodeURIComponent(url.pathname))
  } catch {
    return undefined
  }
}
