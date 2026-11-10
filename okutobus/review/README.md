# OkuCode PR review bot (FR-32) and GitHub Action (FR-55)

## On your computer

```
cd <your project, on your feature branch>
okucode review                      # review this branch against main (--base <branch> for another)
okucode review --fail-on high       # exit code 1 when a high-severity problem is found
```

It uses OkuCode's default model (for example the team gateway after `okucode gateway connect`), or
`--url <OpenAI-compatible address> --model <name> --key <key>`.

The review has three parts: **Summary**, **Issues** (each one **high**, **medium** or **low**, with `file:line` and
the fix) and **Verdict** ("Looks good to merge" or "Changes needed").

## On every pull request (GitHub Actions)

1. In the repository, add two secrets (Settings → Secrets and variables → Actions):
   `OKUCODE_GATEWAY_URL` (the gateway address) and `OKUCODE_GATEWAY_KEY` (from `okucode gateway key`).
2. Copy `okutobus/github-action/example-workflow.yml` to `.github/workflows/okucode-review.yml`.

Each pull request then gets one "OkuCode review" comment, updated on every new push. Set `fail-on: high` to also
fail the check when a high-severity problem is found.

Azure DevOps: see `okutobus/github-action/azure-pipelines-example.yml`.
