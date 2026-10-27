export * as OkuCommit from "./commit.js"

// Okutobus (OkuCode) SRS FR-30: "/commit" writes a commit message and commits after the user approves.
// OkuCode collects `git status` and `git diff` itself (small models are unreliable at running several git
// commands), so the model only writes the message and runs one `git add -A && git commit` shell command. That
// command goes through the normal approval (Ask every time / Auto-edit ask first; Full-auto commits directly).

import { spawnSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"

const MAX_DIFF = 12_000

function git(directory: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
  return { ok: result.status === 0, out: (result.stdout ?? "").trimEnd(), err: (result.stderr ?? "").trim() }
}

export type Changes =
  | { type: "not-a-repo" }
  | { type: "clean" }
  | { type: "changes"; status: string; diff: string; shortened: boolean }

/** What would be committed in this folder: status plus staged, unstaged and new-file diffs (shortened). */
export function changes(directory: string): Changes {
  if (!git(directory, ["rev-parse", "--is-inside-work-tree"]).ok) return { type: "not-a-repo" }
  const status = git(directory, ["status", "--short"]).out
  if (!status) return { type: "clean" }
  const tracked = git(directory, ["diff", "HEAD", "--stat", "--patch", "--no-color"])
  // A repository without commits has no HEAD yet; show the working tree diff instead.
  const diff = tracked.ok ? tracked.out : git(directory, ["diff", "--no-color"]).out
  const untracked = status
    .split("\n")
    .filter((line) => line.startsWith("??"))
    .map((line) => newFile(directory, line.slice(3).replace(/^"|"$/g, "")))
    .join("\n\n")
  const full = [diff, untracked].filter(Boolean).join("\n\n")
  return { type: "changes", status, diff: full.slice(0, MAX_DIFF), shortened: full.length > MAX_DIFF }
}

// New files have no diff; small text files are shown in full so the message can describe them.
function newFile(directory: string, name: string) {
  try {
    const file = path.join(directory, name)
    const stat = statSync(file)
    if (!stat.isFile() || stat.size > 2_000) return `new file: ${name}`
    const text = readFileSync(file, "utf8")
    if (text.includes("\u0000")) return `new file: ${name}`
    return `new file: ${name}\n${text.trimEnd()}`
  } catch {
    return `new file: ${name}`
  }
}

/** The message the model receives for "/commit [note]". */
export function prompt(directory: string, note: string) {
  const found = changes(directory)
  if (found.type === "not-a-repo")
    return `The user asked to commit, but ${directory} is not a git repository. Tell them in one sentence that they can run "git init" first. Do not run any commands.`
  if (found.type === "clean")
    return "The user asked to commit, but there are no changes to commit. Tell them in one sentence. Do not run any commands."
  return [
    "Write a git commit message for the changes below and commit them.",
    "",
    "Changes (git status --short):",
    "```",
    found.status,
    "```",
    "",
    `Diff${found.shortened ? " (shortened)" : ""}:`,
    "```diff",
    found.diff,
    "```",
    note.trim() ? `\nThe user added: ${note.trim()}\n` : "",
    "Steps:",
    '1. Write the message: one summary line of at most 72 characters in the imperative mood (for example "Add login page"), describing what changed and why. Optionally add 1-3 short detail lines.',
    '2. Call the shell tool once with: git add -A && git commit -m "<summary line>" (add a second -m "<details>" only if you wrote details). Use double quotes and escape any double quotes inside the message.',
    "Do not run any other command and do not change any files. The user approves the commit before it runs.",
    "3. After it runs, reply with the commit message you used in one short sentence.",
  ]
    .filter((line) => line !== "")
    .join("\n")
}
