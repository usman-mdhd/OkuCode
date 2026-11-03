import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { OkuApproval } from "@opencode/core/okutobus/approval"
import { OkuSandbox } from "@opencode/core/okutobus/sandbox"

describe("Okutobus sandbox (FR-24)", () => {
  test("is used in Full-auto by default, always with on, never with off", () => {
    OkuSandbox.setAvailable(true)
    expect(OkuSandbox.active({ approvalMode: "full-auto" })).toBe(true)
    expect(OkuSandbox.active({ approvalMode: "auto-edit" })).toBe(false)
    expect(OkuSandbox.active({ approvalMode: "ask", sandbox: "on" })).toBe(true)
    expect(OkuSandbox.active({ approvalMode: "full-auto", sandbox: "off" })).toBe(false)
    expect(OkuSandbox.wrap("/bin/sh", ["-c", "ls"], ["/p"], { approvalMode: "ask" })).toEqual({
      program: "/bin/sh",
      args: ["-c", "ls"],
      sandboxed: false,
    })
    OkuSandbox.setAvailable(false)
    expect(OkuSandbox.active({ approvalMode: "full-auto" })).toBe(false)
    OkuSandbox.setAvailable(undefined)
  })

  test("Full-auto asks before commands when no sandbox is available", () => {
    expect(OkuApproval.apply("ask", "shell", "full-auto", false, () => true)).toBe("allow")
    expect(OkuApproval.apply("ask", "shell", "full-auto", false, () => false)).toBe("ask")
    expect(OkuApproval.apply("ask", "shell", "full-auto", true, () => false)).toBe("allow")
    expect(OkuApproval.apply("ask", "edit", "full-auto", false, () => false)).toBe("allow")
  })

  test("the macOS profile allows writes only in the project, temp and caches, and hides keys", () => {
    const profile = OkuSandbox.seatbelt(["/Users/me/project"], { network: false, home: "/Users/me" })
    expect(profile).toContain("(deny file-write*)")
    expect(profile).toContain('(subpath "/Users/me/project")')
    expect(profile).toContain('(subpath "/Users/me/.npm")')
    expect(profile).toContain('(subpath "/Users/me/.ssh")')
    expect(profile).toContain('(deny network-outbound (remote ip "*:*"))')
    expect(OkuSandbox.seatbelt(["/p"], { network: true, home: "/h" })).not.toContain("network-outbound")
  })

  const linux = process.platform === "linux" && OkuSandbox.available()
  test.skipIf(!linux)("on Linux, commands can change the project but not other folders or read keys", () => {
    // Not under /tmp, which the sandbox lets commands write to.
    const home = mkdtempSync(path.join(os.homedir(), ".oku-sandbox-test-"))
    const project = path.join(home, "project")
    mkdirSync(project)
    mkdirSync(path.join(home, ".ssh"))
    writeFileSync(path.join(home, ".ssh", "id_rsa"), "SECRET")
    const outside = path.join(home, "Documents")
    mkdirSync(outside)
    const run = (command: string) => {
      const args = [...OkuSandbox.bubblewrap([project], { network: true, home }), "--", "/bin/sh", "-c", command]
      return spawnSync("bwrap", args, { cwd: project, encoding: "utf8" })
    }
    expect(run(`echo ok > ${project}/a.txt`).status).toBe(0)
    expect(readFileSync(path.join(project, "a.txt"), "utf8")).toBe("ok\n")
    expect(run(`echo no > ${outside}/b.txt`).status).not.toBe(0)
    expect(existsSync(path.join(outside, "b.txt"))).toBe(false)
    expect(run(`cat ${home}/.ssh/id_rsa`).stdout).not.toContain("SECRET")
    expect(run("echo tmp > /tmp/oku-sandbox-test.txt").status).toBe(0)
  })
  test("tells the model when the sandbox blocked a command", () => {
    const blocked = "zsh: operation not permitted: /Users/me/Desktop/oku-test.txt"
    expect(OkuSandbox.explain(blocked, true)).toContain("[OkuCode sandbox]")
    expect(OkuSandbox.explain(blocked, false)).toBe(blocked)
    expect(OkuSandbox.explain("hello", true)).toBe("hello")
  })
})
