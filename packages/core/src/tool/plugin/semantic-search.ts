/**
 * Okutobus (OkuCode) SRS FR-19: model-facing "semantic_search" tool. Finds code by meaning ("where do we check
 * passwords?") with a local embedding model, and returns the closest functions and classes with their code and line
 * numbers. Read-only.
 */
export * as SemanticSearchTool from "./semantic-search.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { OkuSemantic } from "../../okutobus/semantic.js"

export const name = "semantic_search"

export const Input = Schema.Struct({
  query: Schema.String.annotate({
    description: "What the code does, in plain words, e.g. 'check the user's password' or 'send the invite email'",
  }),
  limit: Schema.optional(Schema.Number).annotate({ description: "How many results (default 8, at most 30)" }),
})

export const Output = Schema.Struct({ results: Schema.String })

export const description = [
  "Find code in the project by what it does, not by exact words: returns the closest functions and classes with file,",
  "line numbers and code. Use it when you do not know the names to grep for. Read-only.",
].join(" ")

export const Plugin = {
  id: "okucode.tool.semantic-search",
  effect: Effect.fn("SemanticSearchTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    yield* ctx.tool
      .transform((editor) => {
        if (!OkuSemantic.settings()) return
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.tryPromise({
              try: async () =>
                OkuSemantic.render(
                  location.directory,
                  await OkuSemantic.search(location.directory, input.query, input.limit ?? 8),
                ),
              catch: (error) =>
                new ToolFailure({
                  message: error instanceof OkuSemantic.EmbeddingError ? error.message : "Semantic search failed",
                  error,
                }),
            }).pipe(Effect.map((results) => ({ output: { results }, content: results }))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
