# OkuCode for VS Code

Use OkuCode, the Okutobus AI coding agent, without leaving VS Code.

## Needs

The `okucode` command on this computer (from the okucode-cli repo, with Ollama running).

## Chat panel

Click the **OkuCode** icon in the activity bar (left side), or press **Cmd+Alt+O**.

- Chat about the open folder. Replies stream in as OkuCode writes them.
- When OkuCode wants to run a command or change a file, approve it in the panel: **Allow once**, **Always allow** or **Deny** (follows the approval mode in OkuCode settings).
- Every file OkuCode changes shows **+added −removed** lines, a **View diff** link (before ↔ after in the VS Code diff editor) and **Undo**. The diff also opens on its own (turn off with `okucode.showDiffs`).
- **@ Add file** (or **Cmd+Alt+K** in the editor) adds the open file and selected lines, e.g. `@src/app.py#L10-20`.
- **Right-click a file or selected code → Ask OkuCode about this** asks in the panel.
- **New chat** starts over. The last chat of each folder comes back when you reopen VS Code.

The panel starts its own OkuCode server in the background (port 4097, private password). Its log is in **Output → OkuCode server**.

## Other commands

- **Cmd+Esc**: OkuCode in a terminal beside your code.
- **OkuCode: Open Web App**: the full OkuCode web page inside VS Code.

## Settings

- `okucode.command`: how to start OkuCode (default `okucode`; use the full path if VS Code cannot find it).
- `okucode.panelPort`: port of the panel's background server (default `4097`).
- `okucode.showDiffs`: open a diff whenever OkuCode changes a file (default on).
- `okucode.port`: port of the web app for "Open Web App" (default `4096`).
