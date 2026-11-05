// Okutobus (OkuCode): "Good evening, Usman" above the message box of a new chat (instead of the OpenCode wordmark).
import { createResource, For, Show } from "solid-js"
import { Mark } from "@opencode/ui/logo"
import { greeting } from "@/home/hero"
import { userName } from "@/home/user-name"
import { fetchMe } from "./account"
import { useCurrentServer } from "./approval-setting"

export function OkuGreeting() {
  const server = useCurrentServer()
  const [me] = createResource(server, (http) => fetchMe(http))
  // A name typed on the start screen wins; otherwise the first name of the account that signed in.
  const name = () => userName.value() || (me() && !me()!.owner ? me()!.name?.split(" ")[0] : undefined)

  return (
    <h1
      data-component="okucode-greeting"
      class="flex items-center justify-center gap-3 text-center text-[28px] font-medium leading-tight text-v2-text-text-base md:text-[34px]"
    >
      <Mark class="h-8 w-6 shrink-0 oku-mark-plain" />
      <SilverMark />
      <span>
        {greeting(new Date().getHours())}
        <Show when={name()}>{(value) => <>, {value()}</>}</Show>
      </span>
    </h1>
  )
}

/** The OkuCode mark in polished silver (dark mode; light mode keeps the plain mark). */
function SilverMark() {
  return (
    <svg data-component="okucode-silver-mark" class="h-8 w-6 shrink-0" viewBox="0 0 16 20" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="oku-mark-chrome" x1="0" y1="0" x2="16" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="0.35" stop-color="#a7abb3" />
          <stop offset="0.55" stop-color="#f1f2f4" />
          <stop offset="0.8" stop-color="#6c7078" />
          <stop offset="1" stop-color="#d9dce1" />
        </linearGradient>
      </defs>
      <path d="M12 16H4V8H12V16Z" fill="#2a2b30" />
      <path d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="url(#oku-mark-chrome)" />
    </svg>
  )
}

const SUGGESTIONS = [
  { label: "Explain code", text: "Explain how this project works, file by file, in simple words." },
  { label: "Fix failing tests", text: "Run the tests, find out why they fail and fix them." },
  { label: "Write SQL", text: "Write a SQL query that " },
  { label: "Make a Word file", text: "Create a Word document about " },
]

/** Example requests under the greeting; clicking one puts it in the message box. */
export function OkuSuggestions(props: { onPick: (text: string) => void }) {
  return (
    <div data-component="okucode-suggestions" class="flex flex-wrap justify-center gap-2">
      <For each={SUGGESTIONS}>
        {(item) => (
          <button
            type="button"
            data-slot="okucode-suggestion"
            class="rounded-full border border-v2-border-border-muted px-3.5 py-1.5 text-[13px] text-v2-text-text-muted transition-colors hover:border-v2-border-border-strong hover:text-v2-text-text-base"
            onClick={() => props.onPick(item.text)}
          >
            {item.label}
          </button>
        )}
      </For>
    </div>
  )
}
