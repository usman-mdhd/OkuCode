import path from "node:path"

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined

export function selfCommand() {
  const runtime = path.basename(process.execPath, path.extname(process.execPath)).toLowerCase()
  if (runtime !== "bun" && runtime !== "node" && runtime !== "nodejs") return [process.execPath]
  if (!entrypoint) throw new Error("Failed to resolve CLI entrypoint")
  if (runtime === "node" || runtime === "nodejs") return [process.execPath, ...nodeFlags(), entrypoint]
  return [process.execPath, ...sourcePreload(), entrypoint]
}

// Okutobus: when running from TypeScript source (dev), child processes such as the background
// server start in another directory and miss packages/cli/bunfig.toml. Pass the Solid JSX
// preload explicitly so they load .tsx modules the same way as the parent process.
function sourcePreload(): string[] {
  if (!entrypoint || !/\.(ts|tsx)$/.test(entrypoint)) return []
  try {
    return ["--preload", Bun.resolveSync("@opentui/solid/preload", path.dirname(entrypoint))]
  } catch {
    return []
  }
}

function nodeFlags() {
  return process.execArgv.flatMap((arg, index, args) => {
    if (index > 0 && args[index - 1] === "--conditions") return []
    if (arg === "--conditions") return args[index + 1] ? [arg, args[index + 1]] : []
    if (arg.startsWith("--conditions=")) return [arg]
    if (
      arg === "--experimental-ffi" ||
      arg === "--use-system-ca" ||
      arg === "--enable-source-maps" ||
      arg === "--no-addons"
    )
      return [arg]
    if (arg === "--no-warnings" || arg.startsWith("--disable-warning=")) return [arg]
    return []
  })
}
