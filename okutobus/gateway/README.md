# OkuCode model gateway (FR-45)

One address and one key for the whole team's models. OkuCode on each laptop talks to the gateway, and the gateway
talks to the model servers (Ollama today, vLLM later, or a paid API if we ever add one).

```
laptops (OkuCode)  ──►  gateway (LiteLLM, port 4000, needs the key)  ──►  Ollama / vLLM on the GPU server
```

It gives us:

- **One place to change models.** Moving from Ollama to vLLM, or to a bigger model, is an edit to `config.yaml` on
  the server. The laptops don't change.
- **A key on every request.** Without the key the gateway refuses (401).
- **Fallback.** If `okucode-main` fails or is busy, the same request goes to `okucode-7b`.
- **Logs without prompts.** One JSON line per request (model, tokens, time). The prompt text is not logged.
- **No paid-API keys on laptops.** If a paid model is added, its key stays on the server.

## Team model names

| Name in OkuCode | Model on the server |
|---|---|
| `okucode-main` | Qwen2.5-Coder 14B, 16k context |
| `okucode-7b` | Qwen2.5-Coder 7B, 16k context (the fallback) |
| `okucode-small` | Qwen2.5-Coder 3B (chat titles and summaries) |

## On the GPU server

```
okucode gateway setup              # installs LiteLLM 1.80.0 in ~/.okucode/gateway and makes the key
okucode gateway start              # runs it on 127.0.0.1:4000 (Ctrl+C stops it)
okucode gateway status             # is it running?
okucode gateway key                # shows the key
```

- `setup --models http://host:11434/v1` uses a model server on another computer (the default is Ollama on the same computer).
- `setup --service` also runs it now and at every boot (systemd, needs sudo).
- `start --host 0.0.0.0` lets other computers connect. Put it behind HTTPS (nginx) before opening it to the internet.

## On a laptop

```
okucode gateway connect https://<gateway address> <key>
```

This checks the address and the key, then adds the "Okutobus gateway" provider with the team models to
`~/.config/opencode/opencode.json`. It saves a backup first and makes `okucode-main` the default model. Add
`--keep-default` to leave the default model unchanged. Restart `okucode web` afterwards.

## Per-person keys

Everyone uses the one gateway key for now. LiteLLM can make a key per person, with its own budget, but that needs a
Postgres database (`DATABASE_URL`). That is planned together with FR-59 (budgets). OkuCode's own usage page (FR-58)
already counts usage per person.
