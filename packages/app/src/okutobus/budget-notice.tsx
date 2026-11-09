// Okutobus (OkuCode) SRS FR-59: the person's monthly budget above the message box — a warning from 80%, and at
// 100% a note that new messages are paused (the server refuses them) until next month or a higher limit.
import { createResource, onCleanup, Show } from "solid-js"
import { headers, useCurrentServer } from "./approval-setting"

type View = {
  unit: "tokens" | "usd"
  limit: number | null
  used: number
  share: number
  warning: boolean
  exceeded: boolean
  resetsOn: string
}

const amount = (value: number, unit: View["unit"]) =>
  unit === "usd"
    ? `$${value < 10 ? value.toFixed(2) : Math.round(value).toLocaleString()}`
    : value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M tokens`
      : value >= 1000
        ? `${(value / 1000).toFixed(1)}k tokens`
        : `${value} tokens`

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })

export function BudgetNotice() {
  const server = useCurrentServer()
  const [budget, { refetch }] = createResource(server, async (http) => {
    const response = await fetch(`${http.url.replace(/\/+$/, "")}/okucode/budget`, {
      credentials: "include",
      headers: headers(http),
    })
    return response.ok ? ((await response.json()) as View) : undefined
  })
  // Check again every 30 seconds and when the window comes back, so the warning follows the chat.
  const timer = setInterval(() => void refetch(), 30_000)
  const focus = () => void refetch()
  window.addEventListener("focus", focus)
  onCleanup(() => {
    clearInterval(timer)
    window.removeEventListener("focus", focus)
  })

  return (
    <Show when={budget.latest && (budget.latest.warning || budget.latest.exceeded) && budget.latest}>
      {(current) => (
        <div
          data-slot="okucode-budget-notice"
          data-state={current().exceeded ? "exceeded" : "warning"}
          role="status"
          class="mb-2 rounded-xl border px-3.5 py-2 text-[13px]"
          style={
            current().exceeded
              ? { color: "#f2555a", "border-color": "rgba(242, 85, 90, 0.45)", background: "rgba(242, 85, 90, 0.06)" }
              : { color: "#e5a54b", "border-color": "rgba(229, 165, 75, 0.45)", background: "rgba(229, 165, 75, 0.06)" }
          }
        >
          <Show
            when={current().exceeded}
            fallback={
              <>
                You have used {Math.round(current().share * 100)}% of your monthly budget (
                {amount(current().used, current().unit)} of {amount(current().limit ?? 0, current().unit)}). It starts
                again on {day(current().resetsOn)}.
              </>
            }
          >
            You have used your monthly budget ({amount(current().used, current().unit)} of{" "}
            {amount(current().limit ?? 0, current().unit)}). New messages are paused until {day(current().resetsOn)}, or
            ask an admin to raise your limit.
          </Show>
        </div>
      )}
    </Show>
  )
}
