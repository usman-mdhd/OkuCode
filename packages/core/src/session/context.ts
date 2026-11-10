export * as SessionContext from "./context.js"

import { Model } from "../model.js"
import { Permission } from "../permission.js"
import { Context, Effect, Layer, Schema } from "effect"
import { Agent } from "../agent.js"
import { CodeModeInstructions } from "../codemode/instructions.js"
import { Database } from "../database/database.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Instructions } from "../instructions/index.js"
import { InstructionBuiltIns } from "../instructions/builtins.js"
import { Location } from "../location.js"
import { McpInstructions } from "../mcp/instructions.js"
import { McpTool } from "../tool/mcp.js"
import { ReferenceInstructions } from "../reference/instructions.js"
import { SkillInstructions } from "../skill/instructions.js"
import { Tool } from "../tool.js"
import { AgentNotFoundError } from "./error.js"
import { SessionHistory } from "./history.js"
import { InstructionEntry } from "./instruction-entry.js"
import { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SessionMessageTable } from "./sql.js"
import { OkuDocs } from "../okutobus/docs.js"
import { OkuRepoMap } from "../okutobus/repo-map.js"
import { OkuRouting } from "../okutobus/routing.js"
import { and, desc, eq, inArray } from "drizzle-orm"

export interface Selection {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly instructions: Instructions.List
  readonly tools: Tool.Snapshot
}

export interface Loaded {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly model: SessionRunnerModel.Resolved
  readonly initial: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly tools: Tool.Snapshot
}

/**
 * Resolves model-request state in two phases: `select` fixes the Session,
 * agent, instruction sources, and tool snapshot; `load` adds the model and
 * active history for that selection. Auxiliary operations resolve only the
 * capabilities they need; request preparation stays separate from selection.
 */
export interface Interface {
  /** Selects the Session, agent, instructions, and tools used by subsequent work. */
  readonly select: (sessionID: SessionSchema.ID) => Effect.Effect<Selection, AgentNotFoundError>
  /** Resolves the model and active history for that selection. */
  readonly load: (selection: Selection) => Effect.Effect<Loaded, SessionRunnerModel.Error>
  readonly resolveModel: (
    session: SessionSchema.Info,
  ) => Effect.Effect<SessionRunnerModel.Resolved, SessionRunnerModel.Error>
  /** Selects auxiliary title capabilities without instruction or tool preflight. */
  readonly selectTitle: (session: SessionSchema.Info) => Effect.Effect<
    | {
        readonly agent: Agent.Info
        readonly primary: SessionRunnerModel.Resolved | undefined
        readonly selected: SessionRunnerModel.Resolved
      }
    | undefined
  >
  readonly request: SessionModelRequest.Interface
}

/** Location-scoped model-context loader for durable Session Steps. */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionContext") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const builtins = yield* InstructionBuiltIns.Service
    const model = yield* Model.Service
    const db = (yield* Database.Service).db
    const discovery = yield* InstructionDiscovery.Service
    const entries = yield* InstructionEntry.Service
    const location = yield* Location.Service
    const mcpInstructions = yield* McpInstructions.Service
    const mcpTools = yield* McpTool.Service
    const models = yield* SessionRunnerModel.Service
    const request = yield* SessionModelRequest.Service
    const referenceInstructions = yield* ReferenceInstructions.Service
    const skillInstructions = yield* SkillInstructions.Service
    const store = yield* SessionStore.Service
    const registry = yield* Tool.Service

    const resolveModel = (session: SessionSchema.Info) => models.resolve(session, model.available)

    // Okutobus FR-46: the small model from okucode.json, resolved like a session model; undefined when unset or missing.
    const resolveSmall = Effect.fn("SessionContext.resolveSmall")(function* (session: SessionSchema.Info) {
      const small = OkuRouting.smallModel()
      if (!small) return undefined
      return yield* resolveModel({
        ...session,
        model: Model.Ref.make({ providerID: small.providerID as never, id: small.id as never }),
      }).pipe(Effect.orElseSucceed(() => undefined))
    })

    const selectTitle = Effect.fn("SessionContext.selectTitle")(function* (session: SessionSchema.Info) {
      const agent = yield* agents.get(Agent.ID.make("title"))
      if (!agent) return
      const primary = yield* resolveModel(session).pipe(Effect.orElseSucceed(() => undefined))
      const info = yield* Effect.gen(function* () {
        if (agent.model) return yield* model.get(agent.model.providerID, agent.model.id)
        if (!primary) return
        const small = OkuRouting.smallModel()
        if (small) {
          const configured = yield* model.get(small.providerID as never, small.id as never)
          if (configured) return configured
        }
        return yield* model.small(primary.ref.providerID)
      })
      const variant =
        agent.model?.variant ?? MINIMAL_REASONING_VARIANTS.find((id) => info?.variants.some((item) => item.id === id))
      const preferred =
        info &&
        (yield* resolveModel({
          ...session,
          model: Model.Ref.make({
            providerID: info.providerID,
            id: info.id,
            ...(variant ? { variant } : {}),
          }),
        }).pipe(Effect.orElseSucceed(() => undefined)))
      const selected = preferred ?? primary
      if (!selected) return
      return { agent, primary, selected }
    })

    const select = Effect.fn("SessionContext.select")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt

      yield* mcpTools.flush
      const agent = yield* agents.select(session.agent)
      if (!agent.info) return yield* new AgentNotFoundError({ sessionID: session.id, agent: session.agent ?? agent.id })
      // Session permissions narrow discovery the same way they narrow the tool snapshot.
      const permissions = Permission.merge(agent.info.permissions, session.permissions ?? [])
      const loaded = yield* Effect.all(
        {
          tools: registry.snapshot(permissions),
          builtins: builtins.load(),
          discovery: discovery.load(),
          skills: skillInstructions.load(permissions),
          references: referenceInstructions.load(),
          mcp: mcpInstructions.load(permissions),
          entries: entries.load(sessionID),
          repoMap: Effect.succeed(repoMapInstructions(location.directory)),
        },
        { concurrency: "unbounded" },
      )
      return {
        session,
        agent: { ...agent, info: agent.info },
        // Ordered from most to least shared across sessions so the baseline stays a reusable
        // prompt-cache prefix: user-level catalog and guidance, then project instructions, then
        // the date and environment, which vary by day and directory.
        instructions: Instructions.combine([
          CodeModeInstructions.make(loaded.tools.codeModeCatalog),
          loaded.mcp,
          loaded.references,
          loaded.skills,
          loaded.discovery,
          loaded.builtins,
          loaded.entries,
          loaded.repoMap,
        ]),
        tools: loaded.tools,
      }
    })

    // Okutobus FR-46: a short general question goes to the small model until a tool runs.
    const routed = Effect.fn("SessionContext.routed")(function* (session: SessionSchema.Info) {
      if (!OkuRouting.smallModel()) return undefined
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, session.id), inArray(SessionMessageTable.type, ["user", "assistant"])))
        .orderBy(desc(SessionMessageTable.seq))
        .limit(20)
        .all()
        .pipe(Effect.orDie)
      const recent = yield* Effect.forEach(rows, SessionHistory.decodeMessageRow)
      if (!OkuRouting.useSmall(recent)) return undefined
      return yield* resolveSmall(session)
    })

    const load = Effect.fn("SessionContext.load")(function* (selection: Selection) {
      const small = yield* routed(selection.session).pipe(Effect.orElseSucceed(() => undefined))
      const model = small ?? (yield* resolveModel(selection.session))
      const history = yield* SessionHistory.entriesForRunner(
        db,
        selection.session.id,
        selection.instructions,
        model.ref,
      )
      const messages = history.entries.map((entry) => entry.message)
      // Okutobus FR-18: the files that match the latest message, from the repository map, so the model reads the right
      // files instead of guessing.
      const latest = messages.findLast((message) => message.type === "user")
      const matched =
        small || !latest || latest.type !== "user"
          ? undefined
          : yield* Effect.promise(() => OkuRepoMap.relevant(selection.session.location.directory, latest.text))
      const initial = matched
        ? `${history.initial}\n\nFiles in this project that match the latest request (from the repository map, best first). Read the ones you need before you answer; do not guess file names:\n<matching_files>\n${matched}\n</matching_files>`
        : history.initial
      return {
        session: selection.session,
        agent: selection.agent,
        model,
        // Okutobus FR-46: the small model only answers in text. Without tools it cannot invent tool calls.
        initial: small ? `${initial}\n\n${OkuRouting.SMALL_NOTE}` : initial,
        messages: history.entries.map((entry) => entry.message),
        tools: small
          ? { ...selection.tools, definitions: [] }
          : // Okutobus: Word/PDF files only when the user asks for one.
            OkuDocs.fileRequested(messages)
            ? selection.tools
            : { ...selection.tools, definitions: selection.tools.definitions.filter((tool) => tool.name !== "document") },
      }
    })

    return Service.of({ select, load, resolveModel, selectTitle, request })
  }),
)

const REPO_MAP_REFRESH_MS = 10 * 60_000
const repoMapCache = new Map<string, { at: number; map: Promise<string | undefined> }>()
const cachedShortMap = (directory: string) => {
  const known = repoMapCache.get(directory)
  if (known && Date.now() - known.at < REPO_MAP_REFRESH_MS) return known.map
  const map = OkuRepoMap.short(directory)
  repoMapCache.set(directory, { at: Date.now(), map })
  map.catch(() => repoMapCache.delete(directory))
  return map
}

// Okutobus SRS FR-18: a short repository map (main source files with their classes and functions) in code projects.
const repoMapInstructions = (directory: string) =>
  Instructions.make<string>({
    key: Instructions.Key.make("okucode/repo-map"),
    codec: Schema.toCodecJson(Schema.String),
    // The map is refreshed at most every 10 minutes: a new map after every edit made small models answer the map
    // ("The repository map has been updated...") instead of the user. The repo_map tool always reads the current files.
    read: Effect.tryPromise(() => cachedShortMap(directory)).pipe(
      Effect.map((map) => map ?? Instructions.removed),
      Effect.orElseSucceed(() => Instructions.removed),
    ),
    render: {
      initial: (map) =>
        [
          "Repository map: the main source files of this project with their classes and functions, most used first.",
          "It shows only part of a large project. Use it to decide which files to read; call the repo_map tool with a query for methods, line numbers and more files.",
          "<repo_map>",
          map,
          "</repo_map>",
        ].join("\n"),
      changed: (_, map) =>
        [
          "Background update, for reference only: the repository map below replaces the previous one. Do not mention it or reply to it; carry on with the user's request.",
          "<repo_map>",
          map,
          "</repo_map>",
        ].join("\n"),
      removed: () => "The repository map is no longer available.",
    },
  })

/** Variant IDs that minimize reasoning output, in preference order. */
const MINIMAL_REASONING_VARIANTS = ["none", "minimal", "low"].map((id) => Model.VariantID.make(id))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Agent.node,
    Model.node,
    Database.node,
    InstructionBuiltIns.node,
    InstructionDiscovery.node,
    InstructionEntry.node,
    Location.node,
    McpInstructions.node,
    McpTool.node,
    ReferenceInstructions.node,
    SessionRunnerModel.node,
    SessionModelRequest.node,
    SessionStore.node,
    SkillInstructions.node,
    Tool.node,
  ],
})
