// Okutobus (OkuCode): the + menu of the message box — Add files or photos, Skills and Plugins.
// Commands (/), context (@) and shell (!) still work by typing them; Settings → Shortcuts lists them.
import { For, Show, createResource } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { useServerSDK } from "@/runtime/server/client"
import { useMcpToggle } from "@/providers/connect/mcp"
import { pluginLabels } from "@/providers/catalog/plugin"
import { useSettingsSurface } from "@/settings/surface"
import type { ComposerSuggestion } from "@/composer/types"

export function OkuAddMenuItems(props: {
  attachShortcut?: string
  skills: ComposerSuggestion[]
  onAttach: () => void
  onSkill: (item: ComposerSuggestion) => void
}) {
  const settings = useSettingsSurface()
  const manage = (subtab: "skills" | "mcps") => {
    settings.open("extensions")
    settings.subtab(subtab)
  }

  return (
    <>
      <Menu.Item onSelect={props.onAttach} shortcut={props.attachShortcut} data-action="okucode-add-files">
        Add files or photos
      </Menu.Item>
      <Menu.Separator />
      <Menu.Sub gutter={0} overlap>
        <Menu.SubTrigger data-action="okucode-add-skills">Skills</Menu.SubTrigger>
        <Menu.Portal>
          <Menu.SubContent class="max-h-[min(360px,calc(100dvh-48px))] w-[240px] overflow-y-auto">
            <For each={props.skills} fallback={<Menu.Item disabled>No skills switched on</Menu.Item>}>
              {(skill) => (
                <Menu.Item onSelect={() => props.onSkill(skill)} data-skill={skill.label.replace(/^@/, "")}>
                  <span class="truncate" title={skill.description}>
                    {skill.label.replace(/^@/, "")}
                  </span>
                </Menu.Item>
              )}
            </For>
            <Menu.Separator />
            <Menu.Item onSelect={() => manage("skills")}>Manage skills…</Menu.Item>
          </Menu.SubContent>
        </Menu.Portal>
      </Menu.Sub>
      <Menu.Sub gutter={0} overlap>
        <Menu.SubTrigger data-action="okucode-add-plugins">Plugins</Menu.SubTrigger>
        <Menu.Portal>
          <Menu.SubContent class="max-h-[min(360px,calc(100dvh-48px))] w-[240px] overflow-y-auto">
            <OkuPluginItems />
            <Menu.Separator />
            <Menu.Item onSelect={() => manage("mcps")}>Manage plugins…</Menu.Item>
          </Menu.SubContent>
        </Menu.Portal>
      </Menu.Sub>
    </>
  )
}

/** MCP connectors (click to switch one on or off) and installed plugins. Loaded when the submenu opens. */
function OkuPluginItems() {
  const sdk = useServerSDK()
  // `.latest` (not calling the resource) so opening the submenu never waits for the lists to load.
  const [mcpList, { refetch }] = createResource(
    () =>
      sdk.api.mcp
        .list()
        .then((result) => result.data)
        .catch(() => []),
    { initialValue: [] },
  )
  const [pluginList] = createResource(
    () =>
      sdk.api.plugin
        .list()
        .then((result) => pluginLabels(result.data))
        .catch(() => [] as string[]),
    { initialValue: [] as string[] },
  )
  const mcps = () => mcpList.latest ?? []
  const plugins = () => pluginList.latest ?? []
  const toggle = useMcpToggle(undefined, refetch)

  return (
    <>
      <Show when={mcps().length > 0}>
        <Menu.Group>
          <Menu.GroupLabel>Connectors</Menu.GroupLabel>
          <For each={mcps()}>
            {(server) => (
              <Menu.Item
                closeOnSelect={false}
                onSelect={() => !toggle.isPending && toggle.mutate(server.name)}
                badge={server.status.status === "connected" ? "On" : "Off"}
              >
                <span class="flex min-w-0 items-center gap-2">
                  <Icon name="mcp" class="shrink-0" />
                  <span class="truncate">{server.name}</span>
                </span>
              </Menu.Item>
            )}
          </For>
        </Menu.Group>
      </Show>
      <Show when={plugins().length > 0}>
        <Menu.Group>
          <Menu.GroupLabel>Plugins</Menu.GroupLabel>
          <For each={plugins()}>
            {(name) => (
              <Menu.Item disabled>
                <span class="truncate">{name}</span>
              </Menu.Item>
            )}
          </For>
        </Menu.Group>
      </Show>
      <Show when={!mcpList.loading && !pluginList.loading && !mcps().length && !plugins().length}>
        <Menu.Item disabled>No plugins yet</Menu.Item>
      </Show>
    </>
  )
}
