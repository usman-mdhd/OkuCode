// Okutobus (OkuCode) SRS FR-29: stage a selected hunk (or a whole file) from the diff viewer, like `git add -p`.
// The viewer already shows each hunk as its own patch (file headers + one "@@" block); that patch is applied to
// the index with `git apply --cached`. OkuCode's terminal app runs on the same computer as the project, so git is
// run directly in the project folder.
import { spawnSync } from "node:child_process"
import { splitPatchHunks } from "./diff"

export type StageResult = { ok: true; message: string } | { ok: false; message: string }

function git(directory: string, args: string[], input?: string) {
  const result = spawnSync("git", args, { cwd: directory, input, encoding: "utf8" })
  if (result.error) return { ok: false, out: result.error.message }
  return { ok: result.status === 0, out: `${result.stderr ?? ""}${result.stdout ?? ""}`.trim() }
}

/** The single-hunk patch for hunk `index` of a file patch (headers included). */
export function hunkPatch(patch: string, index: number) {
  const hunks = splitPatchHunks(patch)
  const hunk = hunks[index] ?? (hunks.length === 1 ? hunks[0] : undefined)
  if (!hunk) return undefined
  return hunk.patch.endsWith("\n") ? hunk.patch : `${hunk.patch}\n`
}

const firstLine = (text: string) => text.split("\n").find((line) => line.trim()) ?? text

/** Stages one hunk; `unstage` takes it back out of the index. */
export function stageHunk(directory: string, file: string, patch: string, index: number, unstage = false): StageResult {
  const single = hunkPatch(patch, index)
  if (!single) return { ok: false, message: "No change selected. Press ] or [ to pick one." }
  const args = ["apply", "--cached", "--recount", "--whitespace=nowarn", ...(unstage ? ["--reverse"] : []), "-"]
  const result = git(directory, args, single)
  if (result.ok) return { ok: true, message: `${unstage ? "Unstaged" : "Staged"} change ${index + 1} in ${file}` }
  const already = /already exists in index|patch does not apply/.test(result.out)
  return {
    ok: false,
    message: already
      ? `Could not ${unstage ? "unstage" : "stage"} this change in ${file} (it may already be ${unstage ? "unstaged" : "staged"}).`
      : `git: ${firstLine(result.out)}`,
  }
}

/** Stages (or unstages) every change in a file. */
export function stageFile(directory: string, file: string, unstage = false): StageResult {
  const result = unstage ? git(directory, ["restore", "--staged", "--", file]) : git(directory, ["add", "--", file])
  if (result.ok) return { ok: true, message: `${unstage ? "Unstaged" : "Staged"} ${file}` }
  return { ok: false, message: `git: ${firstLine(result.out)}` }
}
