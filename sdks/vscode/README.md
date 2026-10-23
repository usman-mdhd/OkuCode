# OkuCode for VS Code

Use OkuCode, the Okutobus AI coding agent, without leaving VS Code.

## Needs

The `okucode` command on this computer (from the okucode-cli repo, with Ollama running).

## Use it

- **Cmd+Esc**: open OkuCode in a terminal beside your code, in the open project folder.
- **Cmd+Shift+Esc** or the OkuCode button at the top right of the editor: a new OkuCode tab.
- **OkuCode: Open Chat Panel** (Cmd+Shift+P): the OkuCode chat page inside VS Code.
- **Cmd+Alt+K**: add the current file (and selected lines) to the chat, e.g. `@src/app.py#L10-20`.
- **Right-click a file or selected code → Ask OkuCode about this**: type a question and OkuCode answers about that code.

## Settings

- `okucode.command`: how to start OkuCode (default `okucode`).
- `okucode.port`: chat page port (default `4096`).
