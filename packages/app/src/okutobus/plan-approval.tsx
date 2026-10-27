// Okutobus (OkuCode) SRS FR-03: in Plan mode the agent only proposes a plan. When a plan reply has
// finished, this bar lets the user approve it: OkuCode switches back to the working agent (okucode or
// build) and asks it to carry the plan out. Until then nothing is edited (the Plan agent cannot change files).
import { createMemo, Show } from "solid-js"
import type { ComposerAdapter } from "@/composer/adapter"
import type { ComposerModel } from "@/composer/model"
import type { SessionModel } from "@/session/model"

import { APPROVAL_TEXT, PLAN_AGENT, planReady } from "./plan-ready"

export function PlanApprovalBar(props: { session: SessionModel; adapter: ComposerAdapter; composer: ComposerModel }) {
  const controls = () => props.adapter.controls()
  const inPlan = createMemo(() => controls().agents.current === PLAN_AGENT)
  // The agent that does the work: OkuCode's own agent when configured, otherwise Build.
  const worker = createMemo(() => {
    const options = controls().agents.options.filter((name) => name !== PLAN_AGENT)
    return options.find((name) => name === "okucode") ?? options.find((name) => name === "build") ?? options[0]
  })
  const show = createMemo(
    () => inPlan() && !!worker() && !props.session.data.working() && planReady(props.session.history.messages()),
  )

  const approve = () => {
    const target = worker()
    if (!target) return
    controls().agents.select(target)
    props.adapter.state.set(
      [{ type: "text", content: APPROVAL_TEXT, start: 0, end: APPROVAL_TEXT.length }],
      APPROVAL_TEXT.length,
    )
    // Let the agent switch and the prompt reach the composer before sending.
    let tries = 0
    const send = () => {
      if (controls().agents.current !== target && tries++ < 10) return void setTimeout(send, 100)
      props.composer.view.submit.onSubmit()
    }
    setTimeout(send, 100)
  }

  return (
    <Show when={show()}>
      <div
        data-component="okucode-plan-approval"
        class="mb-2 flex flex-wrap items-center gap-2 rounded-[12px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2 text-[13px] text-v2-text-text-base"
      >
        <span class="min-w-0 flex-1">Plan mode: nothing has been changed yet. Approve the plan to start, or reply with changes.</span>
        <button
          type="button"
          data-action="okucode-plan-approve"
          class="rounded-full bg-v2-background-bg-inverse px-3 py-1 text-[13px] font-medium text-v2-text-text-inverse transition-opacity hover:opacity-85"
          onClick={approve}
        >
          Approve plan &amp; start
        </button>
      </div>
    </Show>
  )
}
