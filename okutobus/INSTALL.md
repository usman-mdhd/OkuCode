# Installing OkuCode (macOS and Linux)

One command installs everything: Bun, OkuCode, the `okucode` command, Ollama with the local models, the settings,
the 7 team skills and the OkuCode rules. Running it again updates OkuCode. On Windows, use WSL.

## Install

You need access to the OKUTOBUS-TECH/okucode repository on GitHub (sign in first, for example with `gh auth login`).

```
git clone --depth 1 --branch develop https://github.com/OKUTOBUS-TECH/okucode.git /tmp/okucode-setup
bash /tmp/okucode-setup/okutobus/install.sh
```

Then open a new terminal and run `okucode web`.

## Options

| Option | What it does |
|---|---|
| `--no-models` | skip Ollama and the local models (for example when you use an API model) |
| `--from <folder>` | use a folder you already cloned (developers) instead of `~/.okucode/app` |
| `--branch <name>` | install another branch (default `develop`) |
| `--no-modify-path` | do not add `~/.local/bin` to PATH |
| `--uninstall` | remove OkuCode; settings, chats, keys, Ollama and models are kept |

## Models

- Computers with 16 GB of memory or more: `qwen2.5-coder:14b` as the main model (with a 16k context window) and
  `qwen2.5-coder:3b` for chat titles.
- Under 16 GB: `qwen2.5-coder:7b` instead of 14B.
- `nomic-embed-text` (about 270 MB) for semantic search: finding code by what it does.
- Settings you already have in `~/.config/opencode/opencode.json` are never changed; only missing ones are added
  (a backup is saved first).

## Update

```
okucode update
```

## Docker sandbox (optional)

In Full-auto mode OkuCode runs the agent's commands in a sandbox. To use Docker instead of the computer's own
sandbox, start Docker Desktop, run `okucode sandbox-image` once, then choose **Docker** in Settings → Team →
Sandbox for Full-auto. Add the tools your team needs to `okutobus/sandbox/Dockerfile` and run the command again.

## Team model gateway (optional)

To use the team's models on the GPU server instead of the models on this computer, get the gateway address and key
from your admin, then run `okucode gateway connect <address> <key>`. Setting up the gateway itself:
okutobus/gateway/README.md.

## Where things are

- OkuCode: `~/.okucode/app` · its Bun: `~/.okucode/bun` · install log: `~/.okucode/install.log`
- Settings, skills, rules: `~/.config/opencode/` (`opencode.json`, `skills/`, `AGENTS.md`)
- Chats and data: `~/.local/share/opencode/`
