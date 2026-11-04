export * as OkuSandbox from "./sandbox.js"

// Okutobus (OkuCode) SRS FR-24: OS sandbox for the shell tool. Commands the agent runs can change files only inside
// the project folder, the temp folders and package-manager caches, and cannot read keys such as ~/.ssh or ~/.aws.
//   macOS  Seatbelt (sandbox-exec, built in)
//   Linux  bubblewrap (bwrap; apt install bubblewrap)
// FR-25: Docker instead of the OS sandbox: every command runs in a fresh container that sees only the project folder,
// with no capabilities, no host environment variables and no keys (build the image once: okucode sandbox-image).
// Settings in okucode.json:
//   "sandbox": "auto" (default) sandbox in Full-auto mode · "on" always · "off" never · "docker" Docker in Full-auto
//   "sandboxNetwork": false  also block network access (OS sandbox: localhost stays allowed)
//   "sandboxImage": "okucode-sandbox"  the Docker image (default okucode-sandbox, built from okutobus/sandbox)
// FR-22: Full-auto runs commands without asking only inside the sandbox. Where no sandbox is available, Full-auto
// still asks before commands.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { OkuApproval } from "./approval.js"

export type Setting = "auto" | "on" | "off" | "docker"
type Settings = { sandbox?: unknown; sandboxNetwork?: unknown; sandboxImage?: unknown; approvalMode?: unknown }
export const DEFAULT_IMAGE = "okucode-sandbox"

function settings(file = OkuApproval.settingsFile()): Settings {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Settings
  } catch {
    return {}
  }
}

export const setting = (value = settings().sandbox): Setting =>
  value === "on" || value === "off" || value === "docker" ? value : "auto"

export const image = (current = settings()) =>
  typeof current.sandboxImage === "string" && /^[\w./:@-]+$/.test(current.sandboxImage) ? current.sandboxImage : DEFAULT_IMAGE

/** True when commands of the agent run in the sandbox: "on", or "auto"/"docker" in Full-auto mode, and it exists. */
export function active(current = settings()) {
  const chosen = setting(current.sandbox)
  if (chosen === "off") return false
  if (chosen !== "on" && current.approvalMode !== "full-auto") return false
  return chosen === "docker" ? dockerReady(image(current)) : available()
}

/** Whether the chosen sandbox can run here (Full-auto asks before commands when it cannot). */
export function ready(current = settings()) {
  return setting(current.sandbox) === "docker" ? dockerReady(image(current)) : available()
}

const dockerChecked = new Map<string, { ok: boolean; at: number }>()

/** Docker is running and the image exists (checked at most once a minute). */
export function dockerReady(name: string) {
  const cached = dockerChecked.get(name)
  if (cached && Date.now() - cached.at < 60_000) return cached.ok
  let ok = false
  try {
    ok = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", name], { timeout: 5_000 }).status === 0
  } catch {
    ok = false
  }
  dockerChecked.set(name, { ok, at: Date.now() })
  return ok
}

/** For tests. */
export function setDockerReady(name: string, ok: boolean | undefined) {
  if (ok === undefined) dockerChecked.delete(name)
  else dockerChecked.set(name, { ok, at: Date.now() })
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

/** `docker run` arguments: the folders mounted at the same paths, nothing else from this computer. */
export function docker(
  roots: readonly string[],
  cwd: string,
  options: { network: boolean; image: string; uid?: number; gid?: number; home?: string },
) {
  const args = [
    "run", "--rm", "--init", "--label", "okucode.sandbox=1",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "1024",
    "-e", "HOME=/tmp", "-e", "TERM=xterm-256color", "-e", "OKUCODE_SANDBOX=1",
  ]
  if (options.uid !== undefined && options.gid !== undefined) args.push("--user", `${options.uid}:${options.gid}`)
  if (!options.network) args.push("--network", "none")
  // Never the whole disk or the home folder (or a folder above it): those would expose every file and key.
  const home = real(options.home ?? os.homedir())
  const safe = (dir: string) => dir !== path.parse(dir).root && !(home + path.sep).startsWith(dir + path.sep) && dir !== home
  const mounts = [...new Set(roots.map(real))].filter((dir) => existsSync(dir) && safe(dir))
  for (const dir of mounts) args.push("-v", `${dir}:${dir}`)
  const workdir = real(cwd)
  args.push("-w", mounts.some((dir) => workdir === dir || workdir.startsWith(dir + path.sep)) ? workdir : (mounts[0] ?? "/tmp"), options.image)
  return args
}

/**
 * The program and arguments to spawn for a shell command: the command itself, or wrapped in the sandbox when it is
 * active. `roots` are the folders it may change (the project and the working directory).
 */
export function wrap(
  program: string,
  args: readonly string[],
  roots: readonly string[],
  current = settings(),
  command?: string,
) {
  if (!active(current)) return { program, args: [...args], sandboxed: false }
  const network = current.sandboxNetwork !== false
  const folders = roots.filter(Boolean)
  if (setting(current.sandbox) === "docker" && command !== undefined) {
    // The computer's shell (zsh, fish…) may not exist in the image; bash does.
    const ids = process.platform === "linux" && process.getuid && process.getgid ? { uid: process.getuid(), gid: process.getgid() } : {}
    const run = docker(folders, folders.at(-1) ?? process.cwd(), { network, image: image(current), ...ids })
    return { program: "docker", args: [...run, "bash", "-c", command], sandboxed: true, engine: "docker" as const }
  }
  if (process.platform === "darwin") {
    const profile = seatbelt(folders, { network })
    // A profile macOS refuses would make every command fail: check it once and run without the sandbox instead.
    if (!profileWorks(profile)) return { program, args: [...args], sandboxed: false }
    return { program: "/usr/bin/sandbox-exec", args: ["-p", profile, program, ...args], sandboxed: true }
  }
  return { program: "bwrap", args: [...bubblewrap(folders, { network }), "--", program, ...args], sandboxed: true }
}

const BLOCKED = /operation not permitted|read-only file system|permission denied|sandbox/i
const MISSING = /command not found|not found|no such file or directory|read-only file system|permission denied/i

export const DOCKER_NOTE =
  "[OkuCode sandbox] This command ran in OkuCode's Docker sandbox (Full-auto mode): a container that sees only the " +
  "project folder, without the tools, settings and keys of this computer. If a program is missing, install it inside " +
  "the project (for example npm install) or tell the user it must be added to the sandbox image. Do not use sudo."

export const NOTE =
  "[OkuCode sandbox] This command ran in OkuCode's sandbox (Full-auto mode): it may change files only inside the " +
  "project folder, temp folders and package caches, and cannot read keys like ~/.ssh. The error above is the " +
  "sandbox, not macOS or file permissions. Do not use sudo or chmod. Work inside the project folder, or tell the " +
  "user that changing files outside the project needs Ask every time or Auto-edit mode."

/** Adds NOTE to the output of a sandboxed command that was blocked. */
export function explain(output: string, sandboxed: boolean, current = settings()) {
  if (!sandboxed) return output
  if (setting(current.sandbox) === "docker") return MISSING.test(output) ? `${output}\n\n${DOCKER_NOTE}` : output
  if (!BLOCKED.test(output)) return output
  return `${output}\n\n${NOTE}`
}
