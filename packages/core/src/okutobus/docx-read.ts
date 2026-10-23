export * as OkuDocxRead from "./docx-read.js"

// Okutobus (OkuCode): reads Word (.docx) files as Markdown so the model can read and change them.
// No extra software: the .docx zip is opened with Node's zlib and word/document.xml is turned into headings,
// paragraphs, bold/italic text, bullet and numbered lists and tables. Pictures become "[picture]".

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { extname } from "node:path"
import { inflateRawSync } from "node:zlib"

/** Word and other office documents OkuCode can read as text. */
export const READABLE = new Set([".docx", ".doc", ".rtf", ".odt"])

/** Reads a document file as Markdown (.docx built in; .doc/.rtf/.odt with macOS textutil). */
export function readFile(absolute: string): string {
  const extension = extname(absolute).toLowerCase()
  if (extension === ".docx") return markdown(readFileSync(absolute))
  if (process.platform === "darwin") {
    const result = spawnSync("textutil", ["-convert", "txt", "-stdout", absolute], { timeout: 60_000, encoding: "utf8" })
    if (result.status === 0) return result.stdout
  }
  throw new Error(`Reading ${extension} files needs macOS (textutil). Save it as .docx in Word and try again.`)
}

type Node = { name: string; attrs: Record<string, string>; children: Node[]; text?: string }

/** Files inside a zip archive (stored or deflated entries). */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files = new Map<string, Uint8Array>()
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error("This is not a valid .docx file (zip directory not found).")
  const count = data.readUInt16LE(end + 10)
  let offset = data.readUInt32LE(end + 16)
  for (let index = 0; index < count; index++) {
    if (data.readUInt32LE(offset) !== 0x02014b50) break
    const method = data.readUInt16LE(offset + 10)
    const compressed = data.readUInt32LE(offset + 20)
    const nameLength = data.readUInt16LE(offset + 28)
    const extraLength = data.readUInt16LE(offset + 30)
    const commentLength = data.readUInt16LE(offset + 32)
    const local = data.readUInt32LE(offset + 42)
    const name = data.toString("utf8", offset + 46, offset + 46 + nameLength)
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
    const raw = data.subarray(start, start + compressed)
    if (method === 0) files.set(name, raw)
    else if (method === 8) files.set(name, inflateRawSync(raw))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
    if (code[0] === "#")
      return String.fromCodePoint(code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
    return ENTITIES[code] ?? match
  })

/** Minimal XML tree (enough for Office documents). */
export function xml(source: string): Node {
  const root: Node = { name: "#root", attrs: {}, children: [] }
  const stack = [root]
  const pattern = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g
  for (const match of source.matchAll(pattern)) {
    const parent = stack[stack.length - 1]!
    if (match[6] !== undefined || match[5] !== undefined) {
      parent.children.push({ name: "#text", attrs: {}, children: [], text: match[5] ?? decode(match[6]!) })
      continue
    }
    if (!match[2]) continue
    if (match[1]) {
      if (stack.length > 1) stack.pop()
      continue
    }
    const attrs: Record<string, string> = {}
    for (const attr of (match[3] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      attrs[attr[1]!] = decode(attr[2] ?? attr[3] ?? "")
    const node: Node = { name: match[2], attrs, children: [] }
    parent.children.push(node)
    if (!match[4]) stack.push(node)
  }
  return root
}

const child = (node: Node | undefined, name: string) => node?.children.find((item) => item.name === name)
const children = (node: Node | undefined, name: string) => node?.children.filter((item) => item.name === name) ?? []
function find(node: Node, name: string): Node | undefined {
  if (node.name === name) return node
  for (const item of node.children) {
    const found = find(item, name)
    if (found) return found
  }
}
const on = (node: Node | undefined) => !!node && !["0", "false", "none"].includes(node.attrs["w:val"] ?? "")

type Run = { text: string; bold: boolean; italic: boolean }

function runs(node: Node, out: Run[] = []): Run[] {
  for (const item of node.children) {
    if (item.name === "w:r") {
      const props = child(item, "w:rPr")
      const bold = on(child(props, "w:b"))
      const italic = on(child(props, "w:i"))
      for (const part of item.children) {
        if (part.name === "w:t") out.push({ text: part.children.map((t) => t.text ?? "").join(""), bold, italic })
        else if (part.name === "w:tab") out.push({ text: " ", bold, italic })
        else if (part.name === "w:br" || part.name === "w:cr") out.push({ text: " ", bold, italic })
        else if (part.name === "w:drawing" || part.name === "w:pict") out.push({ text: "[picture]", bold: false, italic: false })
      }
    } else if (["w:hyperlink", "w:ins", "w:smartTag", "w:sdt", "w:sdtContent", "w:fldSimple"].includes(item.name)) runs(item, out)
  }
  return out
}

function inlineMarkdown(list: Run[]) {
  const merged: Run[] = []
  for (const run of list) {
    const last = merged[merged.length - 1]
    if (last && last.bold === run.bold && last.italic === run.italic) last.text += run.text
    else merged.push({ ...run })
  }
  return merged
    .map((run) => {
      if (!run.text.trim() || (!run.bold && !run.italic)) return run.text
      const lead = run.text.match(/^\s*/)![0]
      const tail = run.text.match(/\s*$/)![0]
      const core = run.text.trim()
      const mark = run.bold && run.italic ? "***" : run.bold ? "**" : "*"
      return `${lead}${mark}${core}${mark}${tail}`
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
}

type Style = { name: string; numId?: string; level?: string }
type Context = { styles: Map<string, Style>; ordered: (numId: string, level: string) => boolean }

function styleNames(source?: string) {
  const map = new Map<string, Style>()
  if (!source) return map
  for (const style of children(find(xml(source), "w:styles"), "w:style")) {
    const id = style.attrs["w:styleId"]
    const name = child(style, "w:name")?.attrs["w:val"]
    const numPr = child(child(style, "w:pPr"), "w:numPr")
    if (id && name)
      map.set(id, {
        name: name.toLowerCase(),
        numId: child(numPr, "w:numId")?.attrs["w:val"],
        level: child(numPr, "w:ilvl")?.attrs["w:val"],
      })
  }
  return map
}

function numbering(source?: string) {
  if (!source) return () => false
  const root = find(xml(source), "w:numbering")
  const abstract = new Map<string, Map<string, string>>()
  for (const item of children(root, "w:abstractNum")) {
    const levels = new Map<string, string>()
    for (const level of children(item, "w:lvl")) levels.set(level.attrs["w:ilvl"] ?? "0", child(level, "w:numFmt")?.attrs["w:val"] ?? "bullet")
    abstract.set(item.attrs["w:abstractNumId"] ?? "", levels)
  }
  const nums = new Map<string, string>()
  for (const item of children(root, "w:num")) nums.set(item.attrs["w:numId"] ?? "", child(item, "w:abstractNumId")?.attrs["w:val"] ?? "")
  return (numId: string, level: string) => {
    const format = abstract.get(nums.get(numId) ?? "")?.get(level)
    return !!format && format !== "bullet" && format !== "none"
  }
}

type Paragraph =
  | { kind: "list"; text: string; level: number; ordered: boolean; list: string }
  | { kind: "text"; text: string }

function paragraph(node: Node, context: Context): Paragraph {
  const props = child(node, "w:pPr")
  const styleId = child(props, "w:pStyle")?.attrs["w:val"] ?? ""
  const info = context.styles.get(styleId)
  const style = info?.name ?? styleId.toLowerCase()
  const text = inlineMarkdown(runs(node))
  const numPr = child(props, "w:numPr")
  const numId = child(numPr, "w:numId")?.attrs["w:val"] ?? info?.numId
  const level = child(numPr, "w:ilvl")?.attrs["w:val"] ?? info?.level ?? "0"
  if (text && numId && numId !== "0")
    return { kind: "list", text, level: Number(level) || 0, ordered: context.ordered(numId, level), list: numId }
  if (text && /^list (bullet|number)/.test(style))
    return { kind: "list", text, level: Number(style.match(/(\d)$/)?.[1] ?? 1) - 1, ordered: style.startsWith("list number"), list: style.replace(/\s*\d$/, "") }
  if (!text) return { kind: "text", text: "" }
  const plain = text.replace(/\*+/g, "")
  if (style === "title") return { kind: "text", text: `# ${plain}` }
  const heading = style.match(/^heading\s*(\d)$/)
  if (heading) return { kind: "text", text: `${"#".repeat(Math.min(6, Number(heading[1])))} ${plain}` }
  if (style === "subtitle") return { kind: "text", text: `*${plain}*` }
  return { kind: "text", text }
}

function table(node: Node, context: Context) {
  const rows = children(node, "w:tr").map((row, rowIndex) =>
    children(row, "w:tc").map((cell) => {
      const value = children(cell, "w:p")
        .map((p) => paragraph(p, context).text)
        .filter(Boolean)
        .join(" ")
        .replace(/\|/g, "\\|")
      return rowIndex === 0 ? value.replace(/^\*\*(.*)\*\*$/, "$1") : value
    }),
  )
  if (!rows.length) return ""
  const width = Math.max(...rows.map((row) => row.length), 1)
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`
  return [line(rows[0]!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n")
}

/** Turns a .docx file into Markdown. */
export function markdown(bytes: Uint8Array): string {
  const files = unzip(bytes)
  const document = files.get("word/document.xml")
  if (!document) throw new Error("This .docx file has no word/document.xml.")
  const text = (name: string) => {
    const file = files.get(name)
    return file ? Buffer.from(file).toString("utf8") : undefined
  }
  const context: Context = { styles: styleNames(text("word/styles.xml")), ordered: numbering(text("word/numbering.xml")) }
  const body = find(xml(Buffer.from(document).toString("utf8")), "w:body")
  if (!body) return ""
  const blocks: string[] = []
  let list: string[] = []
  let current = ""
  const counters: number[] = []
  const flush = () => {
    if (list.length) blocks.push(list.join("\n"))
    list = []
    current = ""
    counters.length = 0
  }
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.name === "w:p") {
        const result = paragraph(node, context)
        if (result.kind === "list") {
          const key = `${result.list}:${result.ordered}`
          if (current && current !== key && result.level === 0) flush()
          current = key
          counters.length = result.level + 1
          counters[result.level] = (counters[result.level] ?? 0) + 1
          list.push(`${"  ".repeat(result.level)}${result.ordered ? `${counters[result.level]}.` : "-"} ${result.text}`)
          continue
        }
        flush()
        if (result.text) blocks.push(result.text)
      } else if (node.name === "w:tbl") {
        flush()
        const value = table(node, context)
        if (value) blocks.push(value)
      } else if (node.name === "w:sdt" || node.name === "w:sdtContent" || node.name === "w:customXml") visit(node.children)
    }
  }
  visit(body.children)
  flush()
  return blocks.join("\n\n").trim() + "\n"
}
