// Okutobus (OkuCode): "Good evening, Usman" above the message box of a new chat (instead of the OpenCode wordmark).
import { createResource, Show } from "solid-js"
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
      <Mark class="h-8 w-6 shrink-0" />
      <span>
        {greeting(new Date().getHours())}
        <Show when={name()}>{(value) => <>, {value()}</>}</Show>
      </span>
    </h1>
  )
}
