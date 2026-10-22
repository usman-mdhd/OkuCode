/**
 * Okutobus (OkuCode): model-facing "document" tool. Creates Word (.docx), PDF, HTML and other
 * document files from Markdown. .docx/.html/.md/.txt need no extra software; .pdf/.odt/.rtf/
 * .pptx/.epub use pandoc or LibreOffice when installed. Same approvals as the write tool.
 */
export * as DocumentTool from "./document.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, extname, join } from "node:path"
import { Effect, Schema } from "effect"
import { FileAccess } from "../../file-access.js"
import { FileMutation } from "../../file-mutation.js"
import { OkuDocument } from "../../okutobus/document.js"
import { Permission } from "../../permission.js"
import { fileDiff } from "./file-diff.js"

export const name = "document"

export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description: "File to create, with its type as the extension, e.g. report.docx, notes.pdf, page.html",
  }),
  content: Schema.String.annotate({
    description: "The full document in Markdown: # headings, paragraphs, **bold**, lists, | tables |, ``` code ```",
  }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional title shown at the top of the document" }),
})

export const Output = Schema.Struct({
  operation: Schema.Literal("write"),
  target: Schema.String,
  resource: Schema.String,
  existed: Schema.Boolean,
})
export type Output = typeof Output.Type

const BUILT_IN = new Set([".docx", ".html", ".htm", ".md", ".markdown", ".txt"])
const CONVERTED = new Set([".pdf", ".odt", ".rtf", ".doc", ".pptx", ".epub"])
/** Binary document types that must never be written as plain text. */
export const DOCUMENT_TYPES = new Set([".docx", ...CONVERTED])

const has = (command: string) => spawnSync(process.platform === "win32" ? "where" : "which", [command]).status === 0

/** Converts with pandoc (from Markdown) or LibreOffice (from the built .docx). */
function convert(markdown: string, title: string | undefined, extension: string): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "okucode-doc-"))
  try {
    const out = join(dir, `document${extension}`)
    const source = join(dir, "document.md")
    writeFileSync(source, title ? `# ${title}\n\n${markdown}` : markdown)
    // macOS has textutil built in: HTML → .odt / .rtf / .doc without installing anything.
    if (process.platform === "darwin" && [".odt", ".rtf", ".doc"].includes(extension) && has("textutil")) {
      const page = join(dir, "document.html")
      writeFileSync(page, OkuDocument.html(markdown, title))
      const result = spawnSync("textutil", ["-convert", extension.slice(1), page, "-output", out], { timeout: 120_000 })
      if (result.status === 0) return readFileSync(out)
    }
    if (has("pandoc")) {
      const result = spawnSync("pandoc", [source, "-o", out], { timeout: 120_000 })
      if (result.status === 0) return readFileSync(out)
    }
    const office = ["soffice", "libreoffice"].find(has)
    if (office) {
      writeFileSync(join(dir, "document.docx"), OkuDocument.docx(markdown, title))
      const result = spawnSync(office, ["--headless", "--convert-to", extension.slice(1), "--outdir", dir, join(dir, "document.docx")], {
        timeout: 120_000,
      })
      if (result.status === 0) return readFileSync(out)
    }
    throw new Error(
      `Making ${extension} files needs LibreOffice or pandoc on this computer (for example: brew install --cask libreoffice). A .docx file works without them, and Word or Pages can save it as PDF.`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function render(path: string, markdown: string, title?: string): Uint8Array | string {
  const extension = extname(path).toLowerCase()
  if (extension === ".docx") return OkuDocument.docx(markdown, title)
  if (extension === ".html" || extension === ".htm") return OkuDocument.html(markdown, title)
  if (BUILT_IN.has(extension)) return title ? `# ${title}\n\n${markdown}` : markdown
  if (CONVERTED.has(extension)) return convert(markdown, title, extension)
  throw new Error(`Unsupported document type "${extension || basename(path)}". Use .docx, .pdf, .html, .odt, .rtf, .doc, .pptx, .md or .txt.`)
}

export const Plugin = {
  id: "okutobus.tool.document",
  effect: Effect.fn("DocumentTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const fileMutation = yield* FileMutation.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false, permission: "edit" },
          description:
            "Creates a document file the user can open in Word or other apps: Word (.docx), PDF (.pdf), web page (.html), OpenDocument (.odt), Rich Text (.rtf), PowerPoint (.pptx), Markdown (.md) or text (.txt).\n\nUse this tool whenever the user asks for a Word file, docx, document, report, letter or PDF. Write the whole document as Markdown in `content` (headings, paragraphs, bold, bullet and numbered lists, tables, code blocks); the tool turns it into the requested file type based on the extension in `path`.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
              const target = yield* access.resolve({ path: input.path, kind: "file" })
              yield* access.authorizeExternal([target], context)
              const preview = fileDiff(target.resource, "", input.content, "added")
              yield* permission.assert({
                action: "edit",
                resources: [target.resource],
                save: ["*"],
                metadata: { files: [preview] },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              const content = yield* Effect.try({
                try: () => render(input.path, input.content, input.title),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              })
              return yield* fileMutation.write({ target, content })
            }).pipe(
              Effect.map((output) => ({
                output,
                content: `Created document: ${output.resource}. Tell the user the file name and where it is; they can open it in Word or another app.`,
              })),
              Effect.mapError(
                (error) =>
                  new ToolFailure({
                    message: error instanceof Error ? `Unable to create ${input.path}: ${error.message}` : `Unable to create ${input.path}`,
                    error,
                  }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
