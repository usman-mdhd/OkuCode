// Okutobus (OkuCode): small open models often put a Markdown table inside a plain code block
// (``` ... ```), so it shows as raw "| a | b |" text. Remove the fence around such blocks so the
// table renders. Only plain / markdown / text fences that contain a real table are changed.

const PLAIN_LANGUAGES = new Set(["", "markdown", "md", "text", "txt", "plaintext"])
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`~]*)[^\n]*\n([\s\S]*?)\n[ \t]{0,3}\1[`~]*[ \t]*$/gm
const ROW = /^[ \t]*\|.*\|[ \t]*$/
const SEPARATOR = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/

export function hasTable(text: string) {
  const lines = text.split("\n")
  return lines.some((line, index) => index > 0 && SEPARATOR.test(line) && ROW.test(lines[index - 1] ?? ""))
}

export function unfenceTables(text: string) {
  if (!text.includes("|")) return text
  if (!text.includes("```") && !text.includes("~~~")) return text
  return text.replace(FENCE, (block: string, _fence: string, language: string, body: string) =>
    PLAIN_LANGUAGES.has(language.toLowerCase()) && hasTable(body) ? `\n${body}\n` : block,
  )
}
