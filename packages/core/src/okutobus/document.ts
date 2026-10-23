export * as OkuDocument from "./document.js"

// Okutobus (OkuCode): turn Markdown written by the model into real document files.
// - .docx is built here (no extra software needed): headings, paragraphs, bold/italic/code,
//   bullet and numbered lists, tables, code blocks, horizontal rules.
// - .html is built here too; .md / .txt are written as-is.
// Other formats (.pdf, .odt, .rtf, .pptx, .epub) are converted by the document tool with
// pandoc or LibreOffice when one of them is installed.

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean }
export type Block =
  | { type: "heading"; level: number; text: Inline[] }
  | { type: "paragraph"; text: Inline[] }
  | { type: "list"; ordered: boolean; items: { level: number; text: Inline[] }[] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] }
  | { type: "code"; lines: string[] }
  | { type: "rule" }

/** Parses **bold**, *italic*, _italic_ and `code` spans. */
export function inline(source: string): Inline[] {
  const out: Inline[] = []
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let last = 0
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) out.push({ text: source.slice(last, index) })
    const token = match[0]
    if (token.startsWith("**") || token.startsWith("__")) out.push({ text: token.slice(2, -2), bold: true })
    else if (token.startsWith("`")) out.push({ text: token.slice(1, -1), code: true })
    else out.push({ text: token.slice(1, -1), italic: true })
    last = index + token.length
  }
  if (last < source.length) out.push({ text: source.slice(last) })
  return out.map((part) => ({ ...part, text: part.text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)") }))
}

// "\|" is a literal | inside a cell, not a column break.
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||(?<!\\)\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => inline(cell.trim().replace(/\\\|/g, "|")))

/**
 * Adds `addition` to `markdown`. A section in `addition` whose heading already exists (same level and text)
 * replaces that section instead of being added a second time; everything else is added at the end.
 */
export function merge(markdown: string, addition: string): string {
  type Section = { key?: string; level: number; lines: string[] }
  const split = (source: string) => {
    const sections: Section[] = [{ level: 0, lines: [] }]
    let fence = false
    for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
      if (line.trim().startsWith("```")) fence = !fence
      const heading = fence ? null : line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (heading) sections.push({ key: `${heading[1]!.length}:${heading[2]!.toLowerCase()}`, level: heading[1]!.length, lines: [line] })
      else sections[sections.length - 1]!.lines.push(line)
    }
    return sections
  }
  const base = split(markdown)
  const extra = split(addition)
  const tail: string[] = []
  for (const section of extra) {
    const text = section.lines.join("\n").trim()
    if (!text) continue
    const index = section.key ? base.findIndex((item) => item.key === section.key) : -1
    if (index < 0) {
      tail.push(text)
      continue
    }
    // The replaced section ends where the next heading of the same or a higher level starts.
    let end = index + 1
    while (end < base.length && base[end]!.level > base[index]!.level) end++
    base.splice(index, end - index, { key: section.key, level: section.level, lines: [text, ""] })
  }
  const merged = base.map((section) => section.lines.join("\n").trim()).filter(Boolean)
  return [...merged, ...tail].join("\n\n") + "\n"
}

/** Small Markdown block parser, enough for documents written by a model. */
export function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: inline(paragraph.join(" ")) })
    paragraph = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      continue
    }
    if (trimmed.startsWith("```")) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) code.push(lines[i++] ?? "")
      blocks.push({ type: "code", lines: code })
      continue
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flush()
      blocks.push({ type: "heading", level: (heading[1] ?? "#").length, text: inline((heading[2] ?? "").replace(/#+$/, "").trim()) })
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush()
      blocks.push({ type: "rule" })
      continue
    }
    if (trimmed.startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      flush()
      const header = cells(trimmed)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) rows.push(cells(lines[i++] ?? ""))
      i--
      blocks.push({ type: "table", header, rows })
      continue
    }
    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
    if (item) {
      flush()
      const ordered = /\d/.test(item[2] ?? "")
      const level = Math.min(2, Math.floor((item[1] ?? "").replace(/\t/g, "  ").length / 2))
      const previous = blocks.at(-1)
      const entry = { level, text: inline(item[3] ?? "") }
      if (previous?.type === "list" && previous.ordered === ordered) previous.items.push(entry)
      else blocks.push({ type: "list", ordered, items: [entry] })
      continue
    }
    paragraph.push(trimmed)
  }
  flush()
  return blocks
}

// ---------- DOCX ----------

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function runs(parts: Inline[], extra = "") {
  return parts
    .filter((part) => part.text.length > 0)
    .map((part) => {
      const props = [
        part.bold ? "<w:b/>" : "",
        part.italic ? "<w:i/>" : "",
        part.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:fill="F2F2F2"/>' : "",
        extra,
      ].join("")
      return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(part.text)}</w:t></w:r>`
    })
    .join("")
}

function paragraphXml(parts: Inline[], style?: string, numbering?: { id: number; level: number }) {
  const props = [
    style ? `<w:pStyle w:val="${style}"/>` : "",
    numbering ? `<w:numPr><w:ilvl w:val="${numbering.level}"/><w:numId w:val="${numbering.id}"/></w:numPr>` : "",
  ].join("")
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs(parts)}</w:p>`
}

function tableXml(block: Extract<Block, { type: "table" }>) {
  const columns = Math.max(block.header.length, ...block.rows.map((row) => row.length), 1)
  const width = Math.floor(9000 / columns)
  const cell = (parts: Inline[] | undefined, header: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:fill="E7ECF3"/>' : ""}</w:tcPr>` +
    `<w:p>${runs(parts ?? [], header ? "<w:b/>" : "")}</w:p></w:tc>`
  const row = (values: Inline[][], header: boolean) =>
    `<w:tr>${Array.from({ length: columns }, (_, index) => cell(values[index], header)).join("")}</w:tr>`
  const border = '<w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>'
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>` +
    row(block.header, true) +
    block.rows.map((values) => row(values, false)).join("") +
    `</w:tbl><w:p/>`
  )
}

function bodyXml(blocks: Block[]) {
  let ordered = 10
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return paragraphXml(block.text, block.level === 1 ? "Heading1" : block.level === 2 ? "Heading2" : "Heading3")
        case "paragraph":
          return paragraphXml(block.text)
        case "list": {
          // Each numbered list restarts at 1: give it its own numbering instance.
          const id = block.ordered ? ++ordered : 1
          return block.items.map((item) => paragraphXml(item.text, "ListParagraph", { id, level: item.level })).join("")
        }
        case "table":
          return tableXml(block)
        case "code":
          return block.lines.map((line) => paragraphXml([{ text: line || " " }], "Code")).join("")
        case "rule":
          return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr></w:pPr></w:p>'
      }
    })
    .join("")
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:fill="F2F2F2"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`

function numberingXml() {
  const level = (index: number, format: string, text: string) =>
    `<w:lvl w:ilvl="${index}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + index * 360}" w:hanging="360"/></w:pPr></w:lvl>`
  const bullets = [0, 1, 2].map((index) => level(index, "bullet", ["•", "◦", "▪"][index] ?? "•")).join("")
  const numbers = [0, 1, 2].map((index) => level(index, ["decimal", "lowerLetter", "lowerRoman"][index] ?? "decimal", `%${index + 1}.`)).join("")
  const instances = [`<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`]
  for (let id = 11; id <= 60; id++)
    instances.push(
      `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`,
    )
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bullets}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${numbers}</w:abstractNum>
${instances.join("")}
</w:numbering>`
}

/** Builds a .docx file from Markdown. */
export function docx(markdown: string, title?: string): Uint8Array {
  const blocks = parse(markdown)
  const titleXml = title ? paragraphXml([{ text: title }], "Title") : ""
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${titleXml}${bodyXml(blocks)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z")
  return zip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ],
    [
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
    ],
    ["word/document.xml", document],
    ["word/styles.xml", STYLES],
    ["word/numbering.xml", numberingXml()],
    [
      "docProps/core.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title ?? "")}</dc:title><dc:creator>OkuCode</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
    ],
  ])
}

// ---------- HTML ----------

function htmlInline(parts: Inline[]) {
  return parts
    .map((part) => {
      const text = escapeXml(part.text)
      if (part.code) return `<code>${text}</code>`
      if (part.bold) return `<strong>${text}</strong>`
      if (part.italic) return `<em>${text}</em>`
      return text
    })
    .join("")
}

/** Builds a standalone .html page from Markdown. */
export function html(markdown: string, title?: string): string {
  const body = parse(markdown)
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `<h${Math.min(block.level, 6)}>${htmlInline(block.text)}</h${Math.min(block.level, 6)}>`
        case "paragraph":
          return `<p>${htmlInline(block.text)}</p>`
        case "list": {
          const tag = block.ordered ? "ol" : "ul"
          return `<${tag}>${block.items.map((item) => `<li>${htmlInline(item.text)}</li>`).join("")}</${tag}>`
        }
        case "table":
          return `<table><thead><tr>${block.header.map((cell) => `<th>${htmlInline(cell)}</th>`).join("")}</tr></thead><tbody>${block.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${htmlInline(cell)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`
        case "code":
          return `<pre><code>${escapeXml(block.lines.join("\n"))}</code></pre>`
        case "rule":
          return "<hr>"
      }
    })
    .join("\n")
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(title ?? "Document")}</title><style>body{font-family:Calibri,Arial,sans-serif;max-width:800px;margin:40px auto;line-height:1.5;color:#222}h1,h2,h3{color:#1f3864}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #bbb;padding:6px 10px}th{background:#e7ecf3}pre{background:#f2f2f2;padding:10px;overflow:auto}code{font-family:Consolas,monospace}</style></head><body>${title ? `<h1>${escapeXml(title)}</h1>` : ""}${body}</body></html>`
}

// ---------- ZIP (store, no compression) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function zip(files: [string, string][]): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(content)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(8, 0, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    chunks.push(new Uint8Array(local.buffer), nameBytes, data)
    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, data.length, true)
    entry.setUint32(24, data.length, true)
    entry.setUint16(28, nameBytes.length, true)
    entry.setUint32(42, offset, true)
    central.push(new Uint8Array(entry.buffer), nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = central.reduce((size, chunk) => size + chunk.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  const all = [...chunks, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((size, chunk) => size + chunk.length, 0))
  let position = 0
  for (const chunk of all) {
    out.set(chunk, position)
    position += chunk.length
  }
  return out
}
