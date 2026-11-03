export * as OkuSandbox from "./sandbox.js"

// Okutobus (OkuCode) SRS FR-24: OS sandbox for the shell tool. Commands the agent runs can change files only inside
// the project folder, the temp folders and package-manager caches, and cannot read keys such as ~/.ssh or ~/.aws.
//   macOS  Seatbelt (sandbox-exec, built in)
//   Linux  bubblewrap (bwrap; apt install bubblewrap)
// Settings in okucode.json:
//   "sandbox": "auto" (default) sandbox in Full-auto mode · "on" always · "off" never
//   "sandboxNetwork": false  also block network access (localhost stays allowed)
// FR-22: Full-auto runs commands without asking only inside the sandbox. Where no sandbox is available, Full-auto
// still asks before commands.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { OkuApproval } from "./approval.js"

export type Setting = "auto" | "on" | "off"
type Settings = { sandbox?: unknown; sandboxNetwork?: unknown; approvalMode?: unknown }

function settings(file = OkuApproval.settingsFile()): Settings {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Settings
  } catch {
    return {}
  }
}

export const setting = (value = settings().sandbox): Setting => (value === "on" || value === "off" ? value : "auto")

/** True when commands of the agent run in the sandbox: "on", or "auto" in Full-auto mode, and a sandbox exists. */
export function active(current = settings()) {
  const chosen = setting(current.sandbox)
  if (chosen === "off") return false
  if (chosen === "auto" && current.approvalMode !== "full-auto") return false
  return available()
}

let support: boolean | undefined

/** Whether this computer can run the sandbox (checked once by running a no-op inside it). */
export function available(): boolean {
  if (support !== undefined) return support
  try {
    if (process.platform === "darwin")
      support = spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"]).status === 0
    else if (process.platform === "linux")
      support =
        spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--", "true"], {
          timeout: 5_000,
        }).status === 0
    else support = false
  } catch {
    support = false
  }
  return support
}

/** For tests. */
export function setAvailable(value: boolean | undefined) {
  support = value
}

const real = (target: string) => {
  try {
    return realpathSync(target)
  } catch {
    return path.resolve(target)
  }
}

/** Folders a command may write to, besides the project. */
export function writable(home = os.homedir()) {
  return [
    os.tmpdir(),
    "/tmp",
    "/private/tmp",
    "/private/var/folders",
    "/var/tmp",
    // Package-manager caches, so installs work.
    path.join(home, ".cache"),
    path.join(home, ".npm"),
    path.join(home, ".bun"),
    path.join(home, ".yarn"),
    path.join(home, ".pnpm-store"),
    path.join(home, "Library", "Caches"),
    path.join(home, ".cargo", "registry"),
    path.join(home, "go", "pkg"),
    path.join(home, ".gradle"),
    path.join(home, ".m2"),
    path.join(home, ".local", "lib"),
    path.join(home, ".local", "share", "virtualenvs"),
  ]
}

/** Secrets a command may not read. */
export function hidden(home = os.homedir()) {
  return [".ssh", ".aws", ".gnupg", ".kube", ".docker", path.join(".config", "gcloud"), ".netrc"].map((item) =>
    path.join(home, item),
  )
}

const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`

const checked = new Map<string, boolean>()
function profileWorks(profile: string) {
  let ok = checked.get(profile)
  if (ok === undefined) {
    ok = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/usr/bin/true"], { timeout: 5_000 }).status === 0
    checked.set(profile, ok)
  }
  return ok
}

/** The Seatbelt profile for macOS. */
export function seatbelt(roots: readonly string[], options: { network: boolean; home?: string }) {
  const home = options.home ?? os.homedir()
  const writes = [...new Set([...roots, ...writable(home)].map(real))]
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    "(allow file-write*",
    ...writes.map((dir) => `  (subpath ${quote(dir)})`),
    '  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper")',
    '  (regex #"^/dev/fd/") (regex #"^/dev/tty") (regex #"^/dev/ptmx"))',
    "(deny file-read*",
    ...hidden(home).map((dir) => `  (subpath ${quote(real(dir))})`),
    ")",
  ]
  if (!options.network)
    lines.push(
      '(deny network-outbound (remote ip "*:*"))',
      '(allow network-outbound (remote ip "localhost:*"))',
      "(allow network-outbound (remote unix-socket))",
    )
  return lines.join("\n")
}

/** bubblewrap arguments for Linux (before the command). */
export function bubblewrap(roots: readonly string[], options: { network: boolean; home?: string }) {
  const home = options.home ?? os.homedir()
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent"]
  for (const dir of [...new Set([...writable(home), ...roots].map(real))])
    if (existsSync(dir)) args.push("--bind", dir, dir)
  for (const dir of hidden(home)) if (existsSync(dir)) args.push("--tmpfs", real(dir))
  if (!options.network) args.push("--unshare-net")
  return args
}

/**
 * The program and arguments to spawn for a shell command: the command itself, or wrapped in the sandbox when it is
 * active. `roots` are the folders it may change (the project and the working directory).
 */
export function wrap(program: string, args: readonly string[], roots: readonly string[], current = settings()) {
  if (!active(current)) return { program, args: [...args], sandboxed: false }
  const network = current.sandboxNetwork !== false
  const folders = roots.filter(Boolean)
  if (process.platform === "darwin") {
    const profile = seatbelt(folders, { network })
    // A profile macOS refuses would make every command fail: check it once and run without the sandbox instead.
    if (!profileWorks(profile)) return { program, args: [...args], sandboxed: false }
    return { program: "/usr/bin/sandbox-exec", args: ["-p", profile, program, ...args], sandboxed: true }
  }
  return { program: "bwrap", args: [...bubblewrap(folders, { network }), "--", program, ...args], sandboxed: true }
}
