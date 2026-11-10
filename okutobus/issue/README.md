# From a GitHub issue to a pull request (FR-33)

```
cd <your repository>            # no uncommitted changes
export GITHUB_TOKEN=<token>     # can read issues and open pull requests
okucode issue 42                # or the issue's link
```

OkuCode reads the issue, makes a branch `okucode/issue-42-<title>`, lets the agent make the change (with tests),
commits it, pushes the branch and opens a pull request that says "Closes #42", with OkuCode's own review in it.
Nothing is merged: a person reviews the pull request.

- `--no-pr`: stop after the commit, so you can check the branch first (then push it yourself, for example with
  GitHub Desktop).
- `--model gateway/okucode-main`: the model to use (default: OkuCode's default model).
- Issues are written by other people, so their text is treated as a description, never as instructions. An issue
  that looks like it is giving the AI orders is refused unless you add `--force` after checking it.
