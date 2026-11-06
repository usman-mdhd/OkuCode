// OkuCode model gateway (FR-45): `okucode gateway connect <address> <key>` points OkuCode on this computer at the
// team gateway. It checks the address and key, then adds the "gateway" provider with the team's models to
// ~/.config/opencode/opencode.json (a backup is saved first) and makes okucode-main and okucode-small the defaults.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const KNOWN: Record<string, { name: string; context: number; output: number }> = {
  "okucode-main": { name: "OkuCode main (gateway)", context: 16384, output: 4096 },
  "okucode-7b": { name: "OkuCode 7B (gateway)", context: 16384, output: 4096 },
  "okucode-small": { name: "OkuCode small (gateway)", context: 4096, output: 2048 },
}

function stop(message: string): never {
  console.error(`okucode: ${message}`)
  process.exit(1)
}

const [address, key, ...rest] = process.argv.slice(2)
const keepDefaults = rest.includes("--keep-default")
if (!address || !key) stop("usage: okucode gateway connect <address, e.g. http://127.0.0.1:4000> <key> [--keep-default]")
const base = address.replace(/\/+$/, "").replace(/\/v1$/, "")
if (!/^https?:\/\/[^\s]+$/.test(base)) stop(`not a web address: ${address}`)

const response = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } }).catch((error) =>
  stop(`cannot reach the gateway at ${base} (${error instanceof Error ? error.message : error}). Is it running? Try: okucode gateway status`),
)
const refused = response.status === 401 || response.status === 403 || (response.status === 400 && /auth|key|no_db_connection/i.test(await response.clone().text()))
if (refused) stop("the gateway refused this key. Check it with: okucode gateway key (on the gateway computer)")
if (!response.ok) stop(`the gateway answered ${response.status} ${response.statusText}`)
const listed = ((await response.json()) as { data?: { id: string }[] }).data?.map((item) => item.id) ?? []
if (!listed.length) stop("the gateway has no models. Check okutobus/gateway/config.yaml on the gateway computer")

const file = process.env.OKUCODE_CONF ?? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode", "opencode.json")
let data: Record<string, any> = {}
if (fs.existsSync(file)) {
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    stop(`the settings file is not valid JSON, so it was not changed: ${file}`)
  }
  fs.copyFileSync(file, `${file}.backup-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`)
}

data.provider ??= {}
data.provider.gateway = {
  npm: "@ai-sdk/openai-compatible",
  name: "Okutobus gateway",
  options: { baseURL: `${base}/v1`, apiKey: key },
  models: Object.fromEntries(
    listed.map((id) => {
      const known = KNOWN[id]
      return [id, known ? { name: known.name, limit: { context: known.context, output: known.output } } : { name: id }]
    }),
  ),
}
const main = listed.includes("okucode-main") ? "okucode-main" : listed[0]
const small = listed.includes("okucode-small") ? "okucode-small" : undefined
if (!keepDefaults) {
  data.model = `gateway/${main}`
  if (small) data.small_model = `gateway/${small}`
}

fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 })
fs.chmodSync(file, 0o600)

console.log(`okucode: connected to the gateway at ${base}`)
console.log(`  models: ${listed.join(", ")}`)
if (!keepDefaults) console.log(`  default model: gateway/${main}${small ? `, titles: gateway/${small}` : ""}`)
console.log(`  saved in ${file}. Restart OkuCode (okucode web) to use it.`)
