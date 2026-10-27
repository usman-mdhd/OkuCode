// Okutobus (OkuCode): team accounts kept on the machine that runs `okucode web`.
//   <data>/okucode/users.json   users, roles and the secret that signs sign-in cookies (owner-only file)
//   <config>/okucode.json       Google sign-in and Gmail settings, filled from the admin panel (owner-only file)
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import path from "node:path"

export type Role = "admin" | "member"
export type Status = "invited" | "active" | "disabled"

export type User = {
  email: string
  name?: string
  picture?: string
  role: Role
  status: Status
  addedAt: number
  addedBy?: string
  invitedAt?: number
  lastLogin?: number
}

export type Settings = {
  publicUrl?: string
  google?: { clientId?: string; clientSecret?: string }
  gmail?: { address?: string; appPassword?: string; fromName?: string }
  /** Test hooks: other Google endpoints (never set in normal use). */
  googleEndpoints?: { auth?: string; token?: string; userinfo?: string }
  smtp?: { host?: string; port?: number; insecure?: boolean }
  /** FR-22 approval mode: "ask", "auto-edit" or "full-auto" (read by core's OkuApproval). */
  approvalMode?: string
}

type File = { secret: string; users: User[] }

export const normalize = (email: string) => email.trim().toLowerCase()
export const validEmail = (email: string) => /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(email)

function writePrivate(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  renameSync(temporary, file)
  try {
    chmodSync(file, 0o600)
  } catch {
    // Windows has no POSIX modes.
  }
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return undefined
  }
}

export class Store {
  readonly usersFile: string
  readonly settingsFile: string

  constructor(dirs: { data: string; config: string }) {
    this.usersFile = path.join(dirs.data, "okucode", "users.json")
    this.settingsFile = path.join(dirs.config, "okucode.json")
  }

  private load(): File {
    const file = readJson<File>(this.usersFile)
    if (file?.secret && Array.isArray(file.users)) return file
    const fresh = { secret: randomBytes(32).toString("base64url"), users: file?.users ?? [] }
    writePrivate(this.usersFile, fresh)
    return fresh
  }

  private save(file: File) {
    writePrivate(this.usersFile, file)
  }

  secret() {
    return this.load().secret
  }

  /** True once accounts are in use (someone was added or Google sign-in is set up). */
  enabled() {
    return existsSync(this.usersFile) && this.load().users.length > 0
  }

  list() {
    return this.load().users.slice().sort((a, b) => a.email.localeCompare(b.email))
  }

  get(email: string) {
    return this.load().users.find((user) => user.email === normalize(email))
  }

  add(input: { email: string; role: Role; by?: string; invited?: boolean }) {
    const file = this.load()
    const email = normalize(input.email)
    if (!validEmail(email)) throw new Error("Enter a valid email address.")
    if (file.users.some((user) => user.email === email)) throw new Error(`${email} is already added.`)
    const now = Date.now()
    const user: User = {
      email,
      role: input.role,
      status: "invited",
      addedAt: now,
      addedBy: input.by,
      invitedAt: input.invited ? now : undefined,
    }
    file.users.push(user)
    this.save(file)
    return user
  }

  update(email: string, change: (user: User, all: User[]) => void) {
    const file = this.load()
    const user = file.users.find((item) => item.email === normalize(email))
    if (!user) throw new Error("User not found.")
    change(user, file.users)
    this.save(file)
    return user
  }

  remove(email: string) {
    const file = this.load()
    const target = normalize(email)
    const user = file.users.find((item) => item.email === target)
    if (!user) throw new Error("User not found.")
    if (user.role === "admin" && activeAdmins(file.users).filter((item) => item.email !== target).length === 0)
      throw new Error("You can't remove the last admin.")
    file.users = file.users.filter((item) => item.email !== target)
    this.save(file)
  }

  settings(): Settings {
    return readJson<Settings>(this.settingsFile) ?? {}
  }

  saveSettings(next: Settings) {
    writePrivate(this.settingsFile, next)
  }
}

export const activeAdmins = (users: User[]) => users.filter((user) => user.role === "admin" && user.status !== "disabled")
