#!/usr/bin/env bash
# OkuCode installer (Okutobus Technologies) — SRS FR-61. macOS and Linux (on Windows, run it inside WSL).
#
#   bash install.sh                      install, or update when OkuCode is already installed
#   bash install.sh --from ~/okucode-cli use a folder you already cloned instead of downloading
#   bash install.sh --no-models          skip Ollama and the local models (e.g. when you use an API model)
#   bash install.sh --uninstall          remove OkuCode (your chats, settings and keys are kept)
#
# What it does, step by step (safe to run again):
#   1. checks git and curl
#   2. installs Bun 1.4.3 for OkuCode only, in ~/.okucode/bun (newer Bun versions break the install)
#   3. downloads OkuCode to ~/.okucode/app (or updates it with git pull), then installs its packages
#   4. adds the `okucode` command to ~/.local/bin and to PATH
#   5. installs Ollama and the models: qwen2.5-coder 14B (7B on computers under 16 GB memory) and 3B
#   6. writes the settings (~/.config/opencode/opencode.json) without changing settings you already have,
#      adds the 7 team skills and the OkuCode rules
#   7. builds the web UI, so `okucode web` starts fast the first time
set -euo pipefail

REPO="${OKUCODE_REPO:-https://github.com/OKUTOBUS-TECH/okucode.git}"
BRANCH="${OKUCODE_BRANCH:-develop}"
BUN_VERSION="1.4.3"
HOME_DIR="${OKUCODE_HOME:-$HOME/.okucode}"
APP_DIR="$HOME_DIR/app"
BUN_DIR="$HOME_DIR/bun"
BIN_DIR="${OKUCODE_BIN_DIR:-$HOME/.local/bin}"
CONF_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
FROM=""
MODELS=1
MODIFY_PATH=1
UNINSTALL=0

if [ -t 1 ]; then BOLD='\033[1m'; GREEN='\033[0;32m'; RED='\033[0;31m'; DIM='\033[0;2m'; NC='\033[0m'; else BOLD=''; GREEN=''; RED=''; DIM=''; NC=''; fi
step() { printf "\n${BOLD}==> %s${NC}\n" "$1"; }
ok() { printf "    ${GREEN}✓${NC} %s\n" "$1"; }
note() { printf "    ${DIM}%s${NC}\n" "$1"; }
fail() { printf "\n${RED}okucode install: %s${NC}\n" "$1" >&2; exit 1; }

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --from) [ -n "${2:-}" ] || fail "--from needs a folder"; FROM="$2"; shift 2 ;;
    --branch) [ -n "${2:-}" ] || fail "--branch needs a name"; BRANCH="$2"; shift 2 ;;
    --repo) [ -n "${2:-}" ] || fail "--repo needs a URL"; REPO="$2"; shift 2 ;;
    --no-models) MODELS=0; shift ;;
    --no-modify-path) MODIFY_PATH=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown option $1 (see --help)" ;;
  esac
done

OS="$(uname -s)"
case "$OS" in Darwin|Linux) ;; *) fail "OkuCode installs on macOS and Linux. On Windows, install WSL and run this inside it." ;; esac

if [ "$UNINSTALL" = 1 ]; then
  step "Removing OkuCode"
  rm -f "$BIN_DIR/okucode" && ok "removed the okucode command"
  rm -rf "$APP_DIR" "$BUN_DIR" && ok "removed $APP_DIR and the OkuCode Bun"
  note "Kept: your settings ($CONF_DIR), chats and data (~/.local/share/opencode), ~/.okucode/web-password, Ollama and its models."
  exit 0
fi

# ---------- 1. tools ----------
step "1/7 Checking tools"
for tool in git curl tar; do command -v "$tool" >/dev/null 2>&1 || fail "$tool is missing. Install it first (macOS: xcode-select --install · Ubuntu: sudo apt install $tool)."; done
command -v unzip >/dev/null 2>&1 || fail "unzip is missing (needed to install Bun). Ubuntu: sudo apt install unzip"
ok "git, curl, tar and unzip found"

# ---------- 2. Bun ----------
step "2/7 Bun $BUN_VERSION"
mkdir -p "$HOME_DIR"
if [ -x "$BUN_DIR/bin/bun" ] && [ "$("$BUN_DIR/bin/bun" --version)" = "$BUN_VERSION" ]; then
  ok "already installed"
else
  case "$OS-$(uname -m)" in
    Darwin-arm64) TARGET=darwin-aarch64 ;;
    Darwin-x86_64) TARGET=darwin-x64 ;;
    Linux-aarch64|Linux-arm64) TARGET=linux-aarch64 ;;
    Linux-x86_64) TARGET=linux-x64 ;;
    *) fail "no Bun build for $OS $(uname -m)" ;;
  esac
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/bun.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-$TARGET.zip" ||
    fail "Bun could not be downloaded. Check the internet connection and run the installer again."
  unzip -q -o "$TMP/bun.zip" -d "$TMP" || fail "the Bun download is damaged. Run the installer again."
  mkdir -p "$BUN_DIR/bin"
  mv -f "$TMP/bun-$TARGET/bun" "$BUN_DIR/bin/bun"
  chmod +x "$BUN_DIR/bin/bun"
  rm -rf "$TMP"
  [ "$("$BUN_DIR/bin/bun" --version 2>/dev/null)" = "$BUN_VERSION" ] || fail "Bun was not installed in $BUN_DIR"
  ok "installed in $BUN_DIR (used only by OkuCode)"
fi
export PATH="$BUN_DIR/bin:$PATH"

# ---------- 3. OkuCode ----------
step "3/7 OkuCode"
if [ -n "$FROM" ]; then
  FROM="$(cd "$FROM" 2>/dev/null && pwd)" || fail "folder $FROM not found"
  [ -x "$FROM/bin/okucode" ] || fail "$FROM is not an OkuCode folder (bin/okucode is missing)"
  ROOT="$FROM"
  ok "using your folder $ROOT"
elif [ -d "$APP_DIR/.git" ]; then
  ROOT="$APP_DIR"
  git -C "$ROOT" pull --ff-only --quiet || fail "could not update $ROOT (did you change files there? run: git -C $ROOT status)"
  ok "updated to the latest $BRANCH ($(git -C "$ROOT" log -1 --format=%h))"
else
  ROOT="$APP_DIR"
  note "downloading from $REPO (branch $BRANCH)..."
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$ROOT" ||
    fail "could not download OkuCode. The repository is private: sign in to GitHub first (for example: gh auth login), or ask for access to $REPO."
  ok "downloaded to $ROOT ($(git -C "$ROOT" log -1 --format=%h))"
fi
note "installing packages (1–3 minutes the first time)..."
(cd "$ROOT" && bun install --frozen-lockfile >"$HOME_DIR/install.log" 2>&1) ||
  (cd "$ROOT" && bun install >>"$HOME_DIR/install.log" 2>&1) ||
  fail "bun install failed. Details: $HOME_DIR/install.log"
ok "packages installed"

# ---------- 4. command ----------
step "4/7 The okucode command"
mkdir -p "$BIN_DIR"
ln -sf "$ROOT/bin/okucode" "$BIN_DIR/okucode"
ok "$BIN_DIR/okucode"
case ":$PATH:" in
  *":$BIN_DIR:"*) ok "already in PATH" ;;
  *)
    if [ "$MODIFY_PATH" = 1 ]; then
      case "${SHELL:-}" in */zsh) RC="$HOME/.zshrc" ;; */bash) RC="$HOME/.bashrc"; [ "$OS" = Darwin ] && RC="$HOME/.bash_profile" ;; *) RC="$HOME/.profile" ;; esac
      LINE="export PATH=\"$BIN_DIR:\$PATH\""
      if grep -qsF "$LINE" "$RC"; then
        ok "already in PATH in $RC (open a new terminal to use it)"
      else
        printf '\n# OkuCode\n%s\n' "$LINE" >>"$RC"
        ok "added to PATH in $RC (open a new terminal, or run: source $RC)"
      fi
    else
      note "add $BIN_DIR to PATH yourself"
    fi
    ;;
esac

# ---------- 5. models ----------
step "5/7 Local models (Ollama)"
MEMORY_GB=0
if [ "$OS" = Darwin ]; then MEMORY_GB=$(( $(sysctl -n hw.memsize) / 1073741824 )); else MEMORY_GB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1048576 )); fi
# 16 GB machines report a little less than 16.
if [ "$MEMORY_GB" -ge 15 ]; then BIG="qwen2.5-coder:14b"; MAIN="qwen2.5-coder-14b-16k"; else BIG="qwen2.5-coder:7b"; MAIN="qwen2.5-coder-7b-16k"; fi
SMALL="qwen2.5-coder:3b"
if [ "$MODELS" = 0 ]; then
  note "skipped (--no-models)"
else
  if ! command -v ollama >/dev/null 2>&1; then
    if [ "$OS" = Darwin ]; then
      if command -v brew >/dev/null 2>&1; then
        note "installing Ollama with Homebrew..."
        brew install --quiet ollama >/dev/null 2>&1 || fail "brew install ollama failed"
        brew services start ollama >/dev/null 2>&1 || true
      else
        fail "Ollama is missing. Download it from https://ollama.com/download, open it once, then run this installer again (or use --no-models)."
      fi
    else
      note "installing Ollama (asks for your password)..."
      curl -fsSL https://ollama.com/install.sh | sh || fail "Ollama install failed (or use --no-models)"
    fi
  fi
  ok "Ollama $(ollama --version 2>/dev/null | awk '{print $NF}')"
  for _ in 1 2 3 4 5 6 7 8 9 10; do ollama list >/dev/null 2>&1 && break; sleep 2; done
  ollama list >/dev/null 2>&1 || fail "Ollama is not running. Start it (macOS: open the Ollama app · Linux: sudo systemctl start ollama) and run the installer again."
  note "memory: ${MEMORY_GB} GB, so the main model is $BIG"
  for model in "$BIG" "$SMALL" nomic-embed-text; do
    if ollama list | awk '{print $1}' | grep -qx "$model"; then ok "$model already downloaded"; else note "downloading $model (several GB, can take a while)..."; ollama pull "$model" || fail "could not download $model"; ok "$model"; fi
  done
  if ! ollama list | awk '{print $1}' | grep -q "^$MAIN"; then
    MODELFILE="$(mktemp)"
    printf 'FROM %s\nPARAMETER num_ctx 16384\n' "$BIG" >"$MODELFILE"
    ollama create "$MAIN" -f "$MODELFILE" >/dev/null || fail "could not create $MAIN"
    rm -f "$MODELFILE"
  fi
  ok "$MAIN (the main model, with a 16k context window)"
fi

# ---------- 6. settings, skills, rules ----------
step "6/7 Settings, skills and rules"
mkdir -p "$CONF_DIR"
CONF="$CONF_DIR/opencode.json"
OKUCODE_CONF="$CONF" OKUCODE_MAIN="$MAIN" OKUCODE_SMALL="$SMALL" OKUCODE_MODELS="$MODELS" OKUCODE_USER="$(id -un)" bun -e '
const fs = require("fs")
const path = process.env.OKUCODE_CONF
let data = {}
try { data = JSON.parse(fs.readFileSync(path, "utf8")) } catch (error) { if (fs.existsSync(path)) { console.error("    settings file is not valid JSON, left as it is: " + path); process.exit(0) } }
const added = []
const put = (object, key, value, label) => { if (object[key] === undefined) { object[key] = value; added.push(label ?? key) } }
put(data, "$schema", "https://opencode.ai/config.json", "schema")
put(data, "autoupdate", false)
put(data, "username", process.env.OKUCODE_USER)
if (process.env.OKUCODE_MODELS === "1") {
  data.provider ??= {}
  const ollama = (data.provider.ollama ??= { npm: "@ai-sdk/openai-compatible", name: "Ollama (this computer)", options: { baseURL: "http://localhost:11434/v1" } })
  ollama.models ??= {}
  put(ollama.models, process.env.OKUCODE_MAIN, { name: process.env.OKUCODE_MAIN, limit: { context: 16384, output: 4096 } }, "model " + process.env.OKUCODE_MAIN)
  put(ollama.models, process.env.OKUCODE_SMALL, { name: process.env.OKUCODE_SMALL, limit: { context: 4096, output: 2048 } }, "model " + process.env.OKUCODE_SMALL)
  put(data, "model", "ollama/" + process.env.OKUCODE_MAIN)
  put(data, "small_model", "ollama/" + process.env.OKUCODE_SMALL)
}
data.agent ??= {}
put(data.agent, "okucode", { mode: "primary", description: "OkuCode: answers questions and works on your project (files, commands, tests).", steps: 15 }, "agent okucode")
put(data.agent, "build", { disable: true }, "build agent off")
put(data.agent, "plan", { disable: true }, "plan agent off")
put(data, "default_agent", "okucode")
data.permission ??= {}
put(data.permission, "skill", "allow", "skills allowed")
// FR-04: the to-do list the agent keeps for longer tasks.
data.experimental ??= {}
put(data.experimental, "todo", true, "to-do list")
if (added.length && fs.existsSync(path)) fs.copyFileSync(path, path + ".backup-" + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, ""))
if (added.length) fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n")
console.log(added.length ? "    added: " + added.join(", ") : "    settings already complete, nothing changed")
'
ok "$CONF"
SKILLS_SRC="$ROOT/okutobus/skills"
if [ -d "$SKILLS_SRC" ]; then
  mkdir -p "$CONF_DIR/skills"
  ADDED_SKILLS=0
  for dir in "$SKILLS_SRC"/*/; do
    name="$(basename "$dir")"
    if [ ! -d "$CONF_DIR/skills/$name" ]; then cp -R "$dir" "$CONF_DIR/skills/$name"; ADDED_SKILLS=$((ADDED_SKILLS + 1)); fi
  done
  cp "$SKILLS_SRC"/*.txt "$CONF_DIR/skills/" 2>/dev/null || true
  ok "skills: $ADDED_SKILLS added, $(find "$CONF_DIR/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ') installed (switch them on or off in Settings → Extensions)"
fi
AGENTS="$CONF_DIR/AGENTS.md"
if ! grep -qs "OkuCode: how to decide" "$AGENTS"; then
  cat "$ROOT/okutobus/AGENTS.md" >>"$AGENTS"
  ok "OkuCode rules added to $AGENTS"
else
  ok "OkuCode rules already in $AGENTS"
fi
mkdir -p "$HOME/OkuCode-Chats"

# ---------- 7. web UI ----------
# FR-17: language servers, so OkuCode sees code errors after each edit (Python, TypeScript/JavaScript).
if bun add -g pyright@1.1.390 typescript-language-server@4.3.3 typescript@5.6.3 >>"$HOME_DIR/install.log" 2>&1; then
  ok "language servers for code errors (Python, TypeScript/JavaScript)"
else
  note "language servers not installed; OkuCode still checks the syntax after edits"
fi

step "7/7 Building the web UI"
(cd "$ROOT/packages/app" && bun run build >>"$HOME_DIR/install.log" 2>&1) || fail "web UI build failed. Details: $HOME_DIR/install.log"
ok "built"

printf "\n${GREEN}${BOLD}OkuCode is installed.${NC}\n\n"
echo "  Open a new terminal, then:"
echo "    okucode web        chat in the browser (http://localhost:4096)"
echo "    okucode            terminal UI in the current folder"
echo "    okucode update     update to the latest version"
[ "$MODELS" = 0 ] && echo "  No local model was set up: add a provider in the web UI under Settings → Providers."
echo ""
