export * as OkuPdf from "./pdf.js"

// Okutobus (OkuCode): built-in PDF writer for documents written in Markdown — no extra software.
// Uses the standard PDF fonts (Helvetica, Helvetica-Bold, Helvetica-Oblique, Courier), A4 pages,
// word wrapping, headings, lists, tables with borders, code blocks and horizontal rules.
// Text is Latin-1 / WinAnsi; other characters are replaced with "?".

import { parse, type Block, type Inline } from "./document.js"

type Font = "F1" | "F2" | "F3" | "F4" // regular, bold, italic, mono
type Word = { text: string; font: Font; size: number }

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 56
const WIDTH = PAGE_W - MARGIN * 2

// Helvetica glyph widths (1/1000 em) for ASCII 32..126.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
]

function charWidth(code: number, font: Font) {
  if (font === "F4") return 600
  const base = code >= 32 && code <= 126 ? (HELVETICA[code - 32] ?? 556) : 556
  return font === "F2" ? base * 1.06 : base
}

const textWidth = (text: string, font: Font, size: number) =>
  [...winAnsi(text)].reduce((sum, ch) => sum + charWidth(ch.charCodeAt(0), font), 0) * (size / 1000)

const WIN_ANSI: Record<string, number> = {
  "•": 0x95, "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "…": 0x85, "€": 0x80, "™": 0x99,
}

/** Maps text to single-byte WinAnsi characters. */
function winAnsi(text: string) {
  let out = ""
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63
    if (WIN_ANSI[ch] !== undefined) out += String.fromCharCode(WIN_ANSI[ch])
    else if (code === 9) out += "    "
    else if (code < 256 && code >= 32) out += ch
    else out += "?"
  }
  return out
}

const escapePdf = (text: string) => winAnsi(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")

function words(parts: Inline[], size: number, bold = false): Word[] {
  return parts.flatMap((part) => {
    const font: Font = part.code ? "F4" : part.bold || bold ? "F2" : part.italic ? "F3" : "F1"
    return part.text
      .split(/(\s+)/)
      .filter((piece) => piece.length > 0)
      .map((piece) => ({ text: /^\s+$/.test(piece) ? " " : piece, font, size }))
  })
}

/** Splits words into lines that fit `width`. */
function wrap(list: Word[], width: number): Word[][] {
  const lines: Word[][] = [[]]
  let used = 0
  for (const word of list) {
    const w = textWidth(word.text, word.font, word.size)
    const line = lines[lines.length - 1]!
    if (word.text === " ") {
      if (line.length) {
        line.push(word)
        used += w
      }
      continue
    }
    if (used + w > width && line.length) {
      while (line.at(-1)?.text === " ") line.pop()
      lines.push([word])
      used = w
      continue
    }
    line.push(word)
    used += w
  }
  return lines.filter((line, index) => line.length || index === 0)
}

class Writer {
  pages: string[] = []
  ops: string[] = []
  y = PAGE_H - MARGIN

  constructor() {
    this.ops = []
  }

  ensure(height: number) {
    if (this.y - height >= MARGIN) return
    this.pages.push(this.ops.join("\n"))
    this.ops = []
    this.y = PAGE_H - MARGIN
  }

  line(list: Word[], x: number, size: number, leading: number) {
    this.ensure(leading)
    this.y -= leading
    let cursor = x
    for (const word of list) {
      this.ops.push(`BT /${word.font} ${word.size} Tf ${cursor.toFixed(2)} ${(this.y + leading * 0.25).toFixed(2)} Td (${escapePdf(word.text)}) Tj ET`)
      cursor += textWidth(word.text, word.font, word.size)
    }
    void size
  }

  paragraph(parts: Inline[], options: { size?: number; bold?: boolean; indent?: number; after?: number; color?: string } = {}) {
    const size = options.size ?? 11
    const indent = options.indent ?? 0
    if (options.color) this.ops.push(`${options.color} rg`)
    for (const line of wrap(words(parts, size, options.bold), WIDTH - indent)) this.line(line, MARGIN + indent, size, size * 1.4)
    if (options.color) this.ops.push("0 0 0 rg")
    this.y -= options.after ?? 6
  }

  rule() {
    this.ensure(14)
    this.y -= 7
    this.ops.push(`0.75 0.75 0.75 RG 0.6 w ${MARGIN} ${this.y.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${this.y.toFixed(2)} l S 0 0 0 RG`)
    this.y -= 7
  }

  code(lines: string[]) {
    const size = 9
    const leading = 12
    for (const text of lines.length ? lines : [""]) {
      const chunks: string[] = []
      const max = Math.floor((WIDTH - 12) / (size * 0.6))
      for (let i = 0; i < Math.max(1, text.length); i += max) chunks.push(text.slice(i, i + max))
      for (const chunk of chunks) {
        this.ensure(leading)
        this.ops.push(`0.95 0.95 0.95 rg ${MARGIN} ${(this.y - leading).toFixed(2)} ${WIDTH} ${leading} re f 0 0 0 rg`)
        this.line([{ text: chunk || " ", font: "F4", size }], MARGIN + 6, size, leading)
      }
    }
    this.y -= 8
  }

  table(block: Extract<Block, { type: "table" }>) {
    const columns = Math.max(block.header.length, ...block.rows.map((row) => row.length), 1)
    const colWidth = WIDTH / columns
    const size = 10
    const leading = 13
    const rows = [block.header, ...block.rows]
    rows.forEach((row, rowIndex) => {
      const cells = Array.from({ length: columns }, (_, index) => wrap(words(row[index] ?? [], size, rowIndex === 0), colWidth - 10))
      const height = Math.max(...cells.map((lines) => lines.length)) * leading + 8
      this.ensure(height)
      const top = this.y
      if (rowIndex === 0) this.ops.push(`0.906 0.925 0.953 rg ${MARGIN} ${(top - height).toFixed(2)} ${WIDTH} ${height.toFixed(2)} re f 0 0 0 rg`)
      cells.forEach((lines, index) => {
        let y = top - 4
        for (const line of lines) {
          let x = MARGIN + index * colWidth + 5
          y -= leading
          for (const word of line) {
            this.ops.push(`BT /${word.font} ${word.size} Tf ${x.toFixed(2)} ${(y + 3).toFixed(2)} Td (${escapePdf(word.text)}) Tj ET`)
            x += textWidth(word.text, word.font, word.size)
          }
        }
      })
      this.ops.push("0.75 0.75 0.75 RG 0.5 w")
      for (let index = 0; index < columns; index++)
        this.ops.push(`${(MARGIN + index * colWidth).toFixed(2)} ${(top - height).toFixed(2)} ${colWidth.toFixed(2)} ${height.toFixed(2)} re S`)
      this.ops.push("0 0 0 RG")
      this.y = top - height
    })
    this.y -= 10
  }

  finish() {
    this.pages.push(this.ops.join("\n"))
    return this.pages
  }
}

/** Builds a PDF file from Markdown. */
export function pdf(markdown: string, title?: string): Uint8Array {
  const writer = new Writer()
  const navy = "0.122 0.220 0.392"
  if (title) writer.paragraph([{ text: title }], { size: 24, bold: true, after: 14, color: navy })
  for (const block of parse(markdown)) {
    switch (block.type) {
      case "heading": {
        const size = block.level === 1 ? 18 : block.level === 2 ? 14.5 : 12.5
        writer.y -= block.level === 1 ? 10 : 6
        writer.ensure(size * 3)
        writer.paragraph(block.text, { size, bold: true, after: 4, color: navy })
        break
      }
      case "paragraph":
        writer.paragraph(block.text)
        break
      case "list": {
        let number = 0
        for (const item of block.items) {
          const marker = block.ordered ? `${++number}.` : item.level === 0 ? "•" : "–"
          writer.paragraph([{ text: `${marker} ` }, ...item.text], { indent: 14 + item.level * 16, after: 2 })
        }
        writer.y -= 4
        break
      }
      case "table":
        writer.table(block)
        break
      case "code":
        writer.code(block.lines)
        break
      case "rule":
        writer.rule()
        break
    }
  }
  return assemble(writer.finish(), title)
}

function assemble(pages: string[], title?: string): Uint8Array {
  const objects: string[] = []
  const add = (body: string) => {
    objects.push(body)
    return objects.length
  }
  const catalog = add("") // filled below
  const pagesId = add("")
  const fonts = [
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>"),
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"),
  ]
  const resources = `<< /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R /F4 ${fonts[3]} 0 R >> >>`
  const kids: number[] = []
  for (const content of pages) {
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} /Contents ${stream} 0 R >>`))
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`
  const info = add(`<< /Title (${escapePdf(title ?? "Document")}) /Producer (OkuCode) >>`)

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(out.length)
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return bytes
}
