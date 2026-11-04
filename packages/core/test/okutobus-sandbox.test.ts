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

describe("Okutobus Docker sandbox (FR-25)", () => {
  test("is used in Full-auto when chosen and the image exists; otherwise Full-auto asks", () => {
    OkuSandbox.setDockerReady("okucode-sandbox", true)
    expect(OkuSandbox.setting("docker")).toBe("docker")
    expect(OkuSandbox.active({ approvalMode: "full-auto", sandbox: "docker" })).toBe(true)
    expect(OkuSandbox.active({ approvalMode: "auto-edit", sandbox: "docker" })).toBe(false)
    const wrapped = OkuSandbox.wrap("/bin/zsh", ["-c", "ls"], ["/no/such/project"], { approvalMode: "full-auto", sandbox: "docker" }, "ls -la")
    expect(wrapped.program).toBe("docker")
    expect(wrapped.args.slice(-3)).toEqual(["bash", "-c", "ls -la"])
    expect(wrapped.args).toContain("ALL")
    expect(wrapped.args).toContain("okucode-sandbox")
    OkuSandbox.setDockerReady("okucode-sandbox", false)
    expect(OkuSandbox.ready({ sandbox: "docker" })).toBe(false)
    expect(OkuSandbox.active({ approvalMode: "full-auto", sandbox: "docker" })).toBe(false)
    OkuSandbox.setDockerReady("okucode-sandbox", undefined)
    expect(OkuSandbox.image({ sandboxImage: "team/sandbox:1" })).toBe("team/sandbox:1")
    expect(OkuSandbox.image({ sandboxImage: "bad image; rm -rf /" })).toBe("okucode-sandbox")
  })

  test("mounts only the project, never the disk root or the home folder", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "oku-dhome-"))
    const project = path.join(home, "project")
    mkdirSync(project)
    const args = OkuSandbox.docker([project, home, "/"], "/", { network: false, image: "img", home })
    const mounts = args.flatMap((arg, i) => (args[i - 1] === "-v" ? [arg] : []))
    const real = (dir: string) => require("node:fs").realpathSync(dir)
    expect(mounts).toEqual([`${real(project)}:${real(project)}`])
    expect(args[args.indexOf("-w") + 1]).toBe(real(project))
    expect(args).toContain("none")
    expect(OkuSandbox.docker([project], project, { network: true, image: "img", home })).not.toContain("none")
  })

  test("tells the model about missing tools in the container", () => {
    const text = OkuSandbox.explain("bash: mvn: command not found", true, { sandbox: "docker" })
    expect(text).toContain("Docker sandbox")
    expect(OkuSandbox.explain("ok", true, { sandbox: "docker" })).toBe("ok")
  })

  const image = process.env.OKUCODE_TEST_DOCKER_IMAGE
  test.skipIf(!image)("a command changes the project but cannot see files outside it", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "oku-outside-"))
    writeFileSync(path.join(outside, "secret.txt"), "key")
    const project = mkdtempSync(path.join(os.tmpdir(), "oku-dproject-"))
    const run = (command: string) => {
      const args = OkuSandbox.docker([project], project, { network: false, image: image!, home: "/nonexistent-home" })
      return spawnSync("docker", [...args, "bash", "-c", command], { encoding: "utf8", timeout: 60_000 })
    }
    expect(run("echo built > out.txt").status).toBe(0)
    expect(readFileSync(path.join(project, "out.txt"), "utf8")).toBe("built\n")
    const peek = run(`cat ${path.join(outside, "secret.txt")}`)
    expect(peek.status).not.toBe(0)
    expect(peek.stderr).toContain("No such file")
    expect(run("echo $OKUCODE_SANDBOX $HOME").stdout.trim()).toBe("1 /tmp")
  })
})
