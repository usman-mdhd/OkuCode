/**
 * Okutobus (OkuCode) SRS FR-18: model-facing "repo_map" tool. Lists the project's source files with their classes,
 * functions and methods (from tree-sitter), most relevant first for the query, so the model can pick which files to
 * read. Read-only.
 */
export * as RepoMapTool from "./repo-map.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { OkuRepoMap } from "../../okutobus/repo-map.js"

export const name = "repo_map"

export const Input = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description: "What you are looking for (words from the task, e.g. 'login password reset'); best matches come first",
  }),
  path: Schema.optional(Schema.String).annotate({ description: "Only files under this folder, e.g. src/api" }),
})

export const Output = Schema.Struct({ map: Schema.String })

export const description = [
  "Show a map of the project's source files with their classes, functions and methods (signatures and line numbers),",
  "ranked by relevance to the query. Use it to find which files to read or change before reading them.",
].join(" ")

export const Plugin = {
  id: "okucode.tool.repo-map",
  effect: Effect.fn("RepoMapTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.tryPromise({
              try: () => OkuRepoMap.long(location.directory, input.query ?? "", input.path),
              catch: (error) => new ToolFailure({ message: "Could not build the repository map", error }),
            }).pipe(Effect.map((map) => ({ output: { map }, content: map }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
