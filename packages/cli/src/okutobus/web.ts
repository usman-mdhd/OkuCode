// Okutobus (OkuCode): connects the team accounts (accounts.ts) to the server's request pipeline.
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import type { Accounts, Response } from "./accounts"

function toResponse(response: Response) {
  const headers = new Headers(response.headers)
  for (const cookie of response.cookies ?? []) headers.append("set-cookie", cookie)
  return HttpServerResponse.fromWeb(new globalThis.Response(response.body ?? null, { status: response.status, headers }))
}

export function wrap(accounts: Accounts) {
  return <E, R>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`)
      const input = {
        method: request.method,
        url,
        headers: request.headers as Record<string, string | undefined>,
        cookies: request.cookies,
      }
      if (url.pathname.startsWith("/okucode/")) {
        const text = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
          ? yield* request.text.pipe(Effect.orElseSucceed(() => ""))
          : ""
        const handled = yield* Effect.promise(() => accounts.handle({ ...input, body: async () => text }))
        if (handled) return toResponse(handled)
      }
      const blocked = accounts.gate(input)
      if (blocked) return toResponse(blocked)
      return yield* app
    })
}

export * as OkuWeb from "./web"
