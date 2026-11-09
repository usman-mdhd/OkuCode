import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageUser } from "@opencode/client/promise"
import { For, Match, Show, Switch, type ComponentProps } from "solid-js"
import type { SessionUserActions, SessionUserAttachmentReference, SessionUserComment } from "../actions"
import { AssistantReasoningContent, AssistantTextContent, CurrentUserMessageDisplay } from "./message-content"
import {
  CurrentContextToolGroup,
  CurrentFileToolGroup,
  CurrentReadToolGroup,
  ToolDisplay,
} from "../tools/tool-renderer"
import { currentToolError, currentToolInput, currentToolMetadata, currentToolOutput } from "./current-tool-state"

export type { SessionUserActions, SessionUserAttachmentReference, SessionUserComment } from "../actions"

export { SessionShellMessage } from "../tools/tool-renderer"

export { currentContentDefaultOpen } from "./current-tool-state"

export function SessionUserMessage(props: {
  sessionID: string
  message: SessionMessageUser
  displayText?: string
  comments?: SessionUserComment[]
  references?: SessionUserAttachmentReference[]
  voice?: boolean
  historicalAgent: string
  historicalModel: SessionMessageAssistant["model"]
  actions?: SessionUserActions
}) {
  return (
    <CurrentUserMessageDisplay
      sessionID={props.sessionID}
      message={props.message}
      text={props.displayText ?? props.message.text}
      comments={props.comments}
      references={props.references}
      voice={props.voice}
      agent={props.historicalAgent}
      model={props.historicalModel}
      actions={props.actions}
    />
  )
}

export function SessionAssistantContent(props: {
  message: SessionMessageAssistant
  content: SessionMessageAssistant["content"][number]
  contentID: string
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number | null
  defaultOpen?: boolean
  reasoningDefaultOpen?: boolean
  toolOpen?: boolean
  onToolOpenChange?: (open: boolean) => void
  onContentRendered?: () => void
}) {
  return (
    <Switch>
      <Match when={props.content.type === "text" ? props.content : undefined}>
        {(content) => (
          <AssistantTextContent
            id={props.contentID}
            text={content().text}
            message={props.message}
            showCopy={props.showAssistantCopyPartID === props.contentID}
            turnDurationMs={props.turnDurationMs}
          />
        )}
      </Match>
      <Match when={props.content.type === "reasoning" ? props.content : undefined}>
        {(content) => (
          <AssistantReasoningContent
            id={props.contentID}
            content={content()}
            streaming={false}
            defaultOpen={props.reasoningDefaultOpen}
            open={props.toolOpen}
            onOpenChange={props.onToolOpenChange}
            onContentRendered={props.onContentRendered}
          />
        )}
      </Match>
      <Match when={props.content.type === "tool" ? props.content : undefined}>
        {(tool) => (
          <>
            <ToolDisplay
              id={props.contentID}
              tool={tool().name}
              input={currentToolInput(tool())}
              metadata={currentToolMetadata(tool())}
              output={currentToolOutput(tool())}
              status={tool().state.status}
              error={currentToolError(tool())}
              defaultOpen={props.defaultOpen}
              open={props.toolOpen}
              onOpenChange={props.onToolOpenChange}
              deferContent
              virtualizeDiff={false}
              onContentRendered={props.onContentRendered}
            />
            <InjectionNotice tools={[tool()]} />
          </>
        )}
      </Match>
    </Switch>
  )
}

// Okutobus (OkuCode) FR-28: tool results the injection guard flagged start with this line.
const INJECTION_WARNING = "⚠ OkuCode injection guard:"
function injectionWarnings(tools: readonly SessionMessageAssistantTool[]) {
  return tools.flatMap((tool) => {
    const output = currentToolOutput(tool)
    if (!output?.startsWith(INJECTION_WARNING)) return []
    return [output.slice(INJECTION_WARNING.length).split("\n")[0]!.split(". It is content")[0]!.trim()]
  })
}

/** A warning under a step whose result looked like hidden instructions for the AI. */
function InjectionNotice(props: { tools: readonly SessionMessageAssistantTool[] }) {
  return (
    <For each={injectionWarnings(props.tools)}>
      {(text) => (
        <div
          data-slot="okucode-injection-warning"
          role="note"
          style={{
            margin: "6px 0 2px",
            padding: "8px 12px",
            "border-radius": "10px",
            border: "1px solid rgba(229, 165, 75, 0.45)",
            background: "rgba(229, 165, 75, 0.06)",
            color: "#e5a54b",
            "font-size": "13px",
            "line-height": "1.45",
          }}
        >
          ⚠ Possible hidden instructions: {text}. OkuCode told the AI not to follow them.
        </div>
      )}
    </For>
  )
}

export function SessionContextToolGroup(props: ComponentProps<typeof CurrentContextToolGroup>) {
  const tools = () =>
    props.parts.filter((part): part is SessionMessageAssistantTool => "type" in part && part.type === "tool")
  return (
    <>
      <CurrentContextToolGroup {...props} />
      <Show when={tools().length > 0}>
        <InjectionNotice tools={tools()} />
      </Show>
    </>
  )
}

export function SessionReadToolGroup(props: ComponentProps<typeof CurrentReadToolGroup>) {
  return (
    <>
      <CurrentReadToolGroup {...props} />
      <InjectionNotice tools={props.tools} />
    </>
  )
}

export function SessionFileToolGroup(props: {
  tools: SessionMessageAssistantTool[]
  fileOpen: (path: string) => boolean | undefined
  onFileOpenChange: (path: string, open: boolean) => void
  onSizeChange?: () => void
}) {
  return (
    <CurrentFileToolGroup
      tools={props.tools}
      fileOpen={props.fileOpen}
      onFileOpenChange={props.onFileOpenChange}
      onSizeChange={props.onSizeChange}
    />
  )
}
