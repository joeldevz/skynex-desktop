import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { opencodeClient, type MessagePage } from "./client"
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from "../runtime-url"
import { addCompactionUsage, belongsToUsageSelection, fetchUsageStats, fetchUsageTools, fetchWorkspaceUsageStats, fetchWorkspaceUsageTools, resolveUsageWorkspaceId, type UsageTotals } from "./session-stats"
import { bindWorkspaceAssignment } from "@/lib/workspaces/session-assignment"
import { bindWorkspaceScope, snapshotWorkspaceScope } from "@/lib/workspaces/session-scope"
import type { Part, Session, ToolState } from "./model"
import { useWorkspacesStore } from "@/stores/useWorkspacesStore"

const previous = getRuntimeUrlResolver()
beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: "https://stats.test" })
  opencodeClient.reconnectToRuntimeBaseUrl()
  useWorkspacesStore.setState({
    hasBaseline: true,
    status: "ready",
    catalog: { version: 1, workspaces: [
      { id: "workspace-a", name: "A", description: "", folders: [{ id: "a", path: "/a", role: "" }], defaults: {} },
      { id: "workspace-b", name: "B", description: "", folders: [{ id: "b", path: "/b", role: "" }], defaults: {} },
      { id: "workspace-tools", name: "Tools", description: "", folders: [{ id: "tools", path: "/tools", role: "" }], defaults: {} },
      { id: "workspace-pages", name: "Pages", description: "", folders: [{ id: "pages", path: "/pages", role: "" }], defaults: {} },
    ] },
  })
})
afterEach(() => {
  setRuntimeUrlResolver(previous)
  opencodeClient.reconnectToRuntimeBaseUrl()
})

const tokens = (input: number) => ({ input, output: 2, reasoning: 1, cache: { read: 3, write: 4 } })

const workspace = (id: string, path: string) => ({ id, name: id, description: "", folders: [{ id, path, role: "" }], defaults: {} })
const usageSession = (id: string, directory: string, metadata?: Session["metadata"], parentID?: string): Session => ({
  id, directory, metadata, parentID, projectID: "prj", title: id, cost: 0, tokens: tokens(0), time: { created: 0, updated: 0 },
})
const assistant = (id: string, sessionID: string, created: number, input: number, cost = 0, modelID = "model"): MessagePage["items"][number] => ({
  info: { id, sessionID, role: "assistant", time: { created }, agent: "agent", providerID: "provider", modelID, tokens: tokens(input), cost },
  parts: [],
})

const wire = {
  range: { from: 1_000, to: 2_000 },
  sessions: 2,
  subagents: 1,
  prompts: 5,
  steps: 9,
  tokens: tokens(10),
  cost: 1.25,
  tools: {
    mode: "detail",
    totals: { calls: 9, succeeded: 7, failed: 1, unfinished: 1 },
    usage: [
      { name: "read", calls: 5, succeeded: 4, failed: 1, unfinished: 0, durationP50: 340 },
      { name: "bash", calls: 4, succeeded: 3, failed: 0, unfinished: 1 },
    ],
  },
  activeDays: 2,
  streak: 2,
  activity: [{ date: "2026-09-01", steps: 4 }],
  models: [{ model: { providerID: "anthropic", id: "claude", variant: "high" }, steps: 9, tokens: tokens(10), cost: 1.25 }],
}

describe("session.stats boundary", () => {
  test("asks for the report without the tool scan, and translates it", async () => {
    let url: URL | null = null
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      url = new URL(input instanceof Request ? input.url : input.toString())
      return Response.json({ data: { ...wire, tools: { mode: "none" } } })
    })
    try {
      const stats = await fetchUsageStats({ from: 1_000, timezone: "Europe/Kyiv" })
      expect(url!.pathname).toBe("/api/experimental/session/stats")
      expect(Object.fromEntries(url!.searchParams)).toEqual({
        from: "1000",
        timezone: "Europe/Kyiv",
        tools: "none",
      })
      expect(stats.tokens).toEqual({ input: 10, output: 2, reasoning: 1, cacheRead: 3, cacheWrite: 4, total: 20 })
      expect(stats.tools).toEqual({ mode: "none" })
      expect(stats.models[0]).toMatchObject({ providerID: "anthropic", modelID: "claude", variant: "high", cost: 1.25 })
      expect(stats.range).toEqual({ from: 1_000, to: 2_000 })
    } finally {
      fetch.mockRestore()
    }
  })

  test("asks for the tool breakdown over a fixed window on request", async () => {
    let url: URL | null = null
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      url = new URL(input instanceof Request ? input.url : input.toString())
      return Response.json({ data: wire })
    })
    try {
      const tools = await fetchUsageTools({ from: 1_000, to: 2_000, timezone: "UTC" })
      expect(Object.fromEntries(url!.searchParams)).toEqual({ from: "1000", to: "2000", timezone: "UTC", tools: "detail" })
      expect(tools).toEqual({
        mode: "detail",
        totals: { calls: 9, succeeded: 7, failed: 1, unfinished: 1 },
        usage: [
          { name: "read", calls: 5, succeeded: 4, failed: 1, unfinished: 0, durationP50: 340 },
          { name: "bash", calls: 4, succeeded: 3, failed: 0, unfinished: 1, durationP50: null },
        ],
      })
    } finally {
      fetch.mockRestore()
    }
  })

  test("omits unset filters so OpenCode counts every session from the first message", async () => {
    let url: URL | null = null
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      url = new URL(input instanceof Request ? input.url : input.toString())
      return Response.json({ data: wire })
    })
    try {
      await fetchUsageStats({ timezone: "UTC" })
      expect([...url!.searchParams.keys()].sort()).toEqual(["timezone", "tools"])
    } finally {
      fetch.mockRestore()
    }
  })

  test("a failed read throws instead of returning an empty report", async () => {
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ _tag: "InvalidRequestError", message: "Stats range must end after it starts" }, { status: 400 }),
    )
    try {
      const error = await fetchUsageStats({ from: 5, to: 1, timezone: "UTC" }).then(
        () => null,
        (reason: Error) => reason,
      )
      expect(error).toMatchObject({ operation: "session.stats" })
    } finally {
      fetch.mockRestore()
    }
  })
})

describe("workspace session stats", () => {
  test("uses captured scope, explicit assignment, and parent membership in precedence order", () => {
    const workspaceA = { id: "workspace-a", name: "A", description: "", folders: [{ id: "a", path: "/a", role: "" }], defaults: {} }
    const workspaceB = { id: "workspace-b", name: "B", description: "", folders: [{ id: "b", path: "/b", role: "" }], defaults: {} }
    const scopeA = snapshotWorkspaceScope(workspaceA, { kind: "workspace" })
    const scopeB = snapshotWorkspaceScope(workspaceB, { kind: "workspace" })
    if (scopeA.kind !== "valid" || scopeB.kind !== "valid") throw new Error("workspace scope fixture invalid")
    const parent = { id: "parent", directory: "/a", metadata: bindWorkspaceScope({}, scopeA.value) }
    const inherited = { id: "child", parentID: "parent", directory: "/b" }
    const override = { id: "override", parentID: "parent", directory: "/b", metadata: bindWorkspaceScope({}, scopeB.value) }
    const assigned = bindWorkspaceAssignment({}, { directory: "/b" }, workspaceB)
    const legacy = { id: "legacy", parentID: "parent", directory: "/b", metadata: assigned }
    const sessions = new Map<string, Pick<Session, "id" | "parentID" | "metadata">>([
      [parent.id, parent], [inherited.id, inherited], [override.id, override], [legacy.id, legacy],
    ])
    expect(resolveUsageWorkspaceId(inherited, sessions)).toBe("workspace-a")
    expect(resolveUsageWorkspaceId(override, sessions)).toBe("workspace-b")
    expect(resolveUsageWorkspaceId(legacy, sessions)).toBe("workspace-b")
  })

  test("places unassigned and deleted-workspace sessions in No workspace", () => {
    const known = new Set(["workspace-a"])
    expect(belongsToUsageSelection(null, "__unassigned__", known)).toBe(true)
    expect(belongsToUsageSelection("deleted-workspace", "__unassigned__", known)).toBe(true)
    expect(belongsToUsageSelection("workspace-a", "__unassigned__", known)).toBe(false)
    expect(belongsToUsageSelection("workspace-a", "workspace-a", known)).toBe(true)
  })

  test("rejects the whole report when any selected session history fails", async () => {
    const session: Session = {
      id: "ses_1", projectID: "prj_1", directory: "/missing/worktree", title: "Session", cost: 0,
      tokens: tokens(0), time: { created: 1_000, updated: 1_000 },
    }
    const list = spyOn(opencodeClient, "listSessionsPage").mockResolvedValue({ sessions: [session], cursor: {} })
    const messages = spyOn(opencodeClient, "getSessionMessages").mockRejectedValue(new Error("directory unavailable"))
    try {
      const result = await fetchWorkspaceUsageStats({ workspaceId: "__unassigned__", timezone: "UTC" })
        .then(() => null, (error: Error) => error)
      expect(result).toMatchObject({ message: "directory unavailable" })
    } finally {
      list.mockRestore()
      messages.mockRestore()
    }
  })

  test("rejects the workspace report when compaction usage history fails", async () => {
    const session = usageSession("log-failure", "/missing/worktree")
    const list = spyOn(opencodeClient, "listSessionsPage").mockResolvedValue({ sessions: [session], cursor: {} })
    const messages = spyOn(opencodeClient, "getSessionMessages").mockResolvedValue({
      items: [assistant("step", session.id, 1_500, 1)], cursor: {},
    })
    const log = spyOn(opencodeClient, "readSessionUsageRecords").mockRejectedValue(new Error("session log unavailable"))
    try {
      const result = await fetchWorkspaceUsageStats({ workspaceId: "__unassigned__", timezone: "UTC" })
        .then(() => null, (error: Error) => error)
      expect(result).toMatchObject({ message: "session log unavailable" })
    } finally {
      list.mockRestore()
      messages.mockRestore()
      log.mockRestore()
    }
  })

  test("aggregates root and child messages within date bounds and skips other workspaces", async () => {
    const workspaceA = workspace("workspace-a", "/a")
    const workspaceB = workspace("workspace-b", "/b")
    const scope = snapshotWorkspaceScope(workspaceB, { kind: "workspace" })
    if (scope.kind !== "valid") throw new Error("workspace scope fixture invalid")
    const root = usageSession("root", "/b", bindWorkspaceScope({}, scope.value))
    const child = usageSession("child", "/b", undefined, root.id)
    const forked = usageSession("forked", "/b", bindWorkspaceScope({}, scope.value))
    forked.time.created = Date.UTC(2026, 0, 2)
    forked.fork = { sessionID: root.id, boundary: { type: "before", messageID: "fork-boundary" } }
    const scopeA = snapshotWorkspaceScope(workspaceA, { kind: "workspace" })
    if (scopeA.kind !== "valid") throw new Error("workspace scope fixture invalid")
    const other = usageSession("other", "/a", bindWorkspaceScope({}, scopeA.value))
    const list = spyOn(opencodeClient, "listSessionsPage").mockImplementation(async (options) => options?.cursor
      ? { sessions: [other], cursor: {} }
      : { sessions: [root, child, forked], cursor: { next: "session-page-2" } })
    const start = Date.UTC(2026, 0, 1)
    const end = Date.UTC(2026, 0, 3)
    const user: MessagePage["items"][number] = { info: { id: "prompt", sessionID: root.id, role: "user", time: { created: start } }, parts: [] }
    const childUser: MessagePage["items"][number] = { info: { id: "child-prompt", sessionID: child.id, role: "user", time: { created: start } }, parts: [] }
    const forkedSynthetic: MessagePage["items"][number] = { info: { id: "forked-context", sessionID: forked.id, role: "synthetic", time: { created: end - 1 }, text: "context" }, parts: [] }
    const rootMessages: MessagePage = { items: [user, assistant("r1", root.id, start, 10, 1), assistant("r2", root.id, start + 86_400_000, 20, 2), assistant("outside", root.id, end, 99, 9)], cursor: {} }
    const childMessages: MessagePage = { items: [childUser, assistant("c1", child.id, start + 86_400_000, 5, 0.5, "other-model")], cursor: {} }
    const forkedMessages: MessagePage = { items: [assistant("before-fork", forked.id, start, 200, 20), forkedSynthetic], cursor: {} }
    const read = spyOn(opencodeClient, "getSessionMessages").mockImplementation(async (id) =>
      id === root.id ? rootMessages : id === child.id ? childMessages : forkedMessages)
    const logs = spyOn(opencodeClient, "readSessionUsageRecords").mockImplementation(async (id, visit) => {
      if (id === root.id) visit({ created: start + 86_400_000, source: "compaction", cost: 2, tokens: tokens(3) })
    })
    try {
      const result = await fetchWorkspaceUsageStats({ workspaceId: workspaceB.id, from: start, to: end, timezone: "America/Los_Angeles" })
      expect(list.mock.calls).toHaveLength(2)
      expect(read.mock.calls.map(([id]) => id).sort()).toEqual(["child", "forked", "root"])
      expect(result).toMatchObject({ sessions: 1, subagents: 1, prompts: 1, steps: 3, cost: 5.5, activeDays: 2, streak: 2 })
      expect(result.tokens).toMatchObject({ input: 38, output: 8, reasoning: 4, cacheRead: 12, cacheWrite: 16, total: 78 })
      expect(result.activity).toEqual([{ date: "2025-12-31", steps: 1 }, { date: "2026-01-01", steps: 2 }])
      expect(result.models.map((model) => [model.modelID, model.steps])).toEqual([["model", 2], ["other-model", 1]])
    } finally {
      list.mockRestore()
      read.mockRestore()
      logs.mockRestore()
    }
  })

  test("counts selected tool outcomes and computes the median completed duration", async () => {
    const selectedWorkspace = workspace("workspace-tools", "/tools")
    const scope = snapshotWorkspaceScope(selectedWorkspace, { kind: "workspace" })
    if (scope.kind !== "valid") throw new Error("workspace scope fixture invalid")
    const session = usageSession("tools", "/tools", bindWorkspaceScope({}, scope.value))
    const list = spyOn(opencodeClient, "listSessionsPage").mockResolvedValue({ sessions: [session], cursor: {} })
    const info = assistant("step", session.id, 100, 0).info
    const toolState = (status: "completed" | "error" | "running", start: number, finish?: number): ToolState => {
      if (status === "completed") return { status, input: {}, output: "", time: { start, end: finish ?? start } }
      if (status === "error") return { status, input: {}, error: "failed", time: { start, end: finish ?? start } }
      return { status, input: {}, time: { start } }
    }
    const toolPart = (id: string, status: "completed" | "error" | "running", start: number, finish?: number): Part => ({
      id, sessionID: session.id, messageID: info.id, type: "tool", callID: id, tool: "read", executed: true,
      completedDurationMs: finish === undefined ? undefined : finish - start,
      state: toolState(status, start, finish),
    })
    const messages = spyOn(opencodeClient, "getSessionMessages").mockResolvedValue({
      items: [{ info, parts: [toolPart("one", "completed", 0, 100), toolPart("two", "completed", 0, 300),
        toolPart("three", "error", 0, 100), toolPart("four", "running", 0),
        toolPart("completed-no-end", "completed", 0), toolPart("error-no-end", "error", 0),
        toolPart("running-duration", "running", 0, 50)] }], cursor: {},
    })
    const logs = spyOn(opencodeClient, "readSessionUsageRecords")
    try {
      const tools = await fetchWorkspaceUsageTools({ workspaceId: selectedWorkspace.id, from: 0, to: 200, timezone: "UTC" })
      expect(logs.mock.calls).toHaveLength(0)
      expect(tools).toMatchObject({ mode: "detail", totals: { calls: 7, succeeded: 3, failed: 2, unfinished: 2 } })
      if (tools.mode !== "detail") throw new Error("Expected tool detail")
      expect(tools.totals.calls).toBe(tools.totals.succeeded + tools.totals.failed + tools.totals.unfinished)
      expect(tools.mode === "detail" ? tools.usage : []).toEqual([
        { name: "read", calls: 7, succeeded: 3, failed: 2, unfinished: 2, durationP50: 100 },
      ])
    } finally {
      list.mockRestore()
      messages.mockRestore()
      logs.mockRestore()
    }
  })

  test("walks message pages and stops before any request when cancelled", async () => {
    const selectedWorkspace = workspace("workspace-pages", "/pages")
    const scope = snapshotWorkspaceScope(selectedWorkspace, { kind: "workspace" })
    if (scope.kind !== "valid") throw new Error("workspace scope fixture invalid")
    const session = usageSession("pages", "/pages", bindWorkspaceScope({}, scope.value))
    const list = spyOn(opencodeClient, "listSessionsPage").mockResolvedValue({ sessions: [session], cursor: {} })
    const firstItems = Array.from({ length: 100 }, (_, index) => assistant(`step-${index}`, session.id, 1000 + index, 1))
    const messages = spyOn(opencodeClient, "getSessionMessages").mockImplementation(async (_id, options) => options?.cursor
      ? { items: [assistant("last", session.id, 2000, 1)], cursor: {} }
      : { items: firstItems, cursor: { next: "message-page-2" } })
    const logs = spyOn(opencodeClient, "readSessionUsageRecords").mockImplementation(async () => undefined)
    try {
      const result = await fetchWorkspaceUsageStats({ workspaceId: selectedWorkspace.id, from: 0, to: 3000, timezone: "UTC" })
      expect(messages.mock.calls).toHaveLength(2)
      expect(result.steps).toBe(101)

      const controller = new AbortController()
      controller.abort()
      const cancelled = await fetchWorkspaceUsageStats({ workspaceId: selectedWorkspace.id, timezone: "UTC" }, controller.signal)
        .then(() => null, (error: Error) => error)
      expect(cancelled).toMatchObject({ name: "AbortError" })
      expect(list.mock.calls).toHaveLength(1)
    } finally {
      list.mockRestore()
      messages.mockRestore()
      logs.mockRestore()
    }
  })

  test("adds only in-window compaction usage to overall totals", () => {
    const totals: UsageTotals = { tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }
    const event = { created: 150, source: "compaction", cost: 2, tokens: tokens(3) }
    addCompactionUsage(totals, event, { from: 100, to: 200 })
    addCompactionUsage(totals, { ...event, created: 200 }, { from: 100, to: 200 })
    addCompactionUsage(totals, { ...event, source: "title" }, { from: 100, to: 200 })
    expect(totals).toEqual({ tokens: { input: 3, output: 2, reasoning: 1, cacheRead: 3, cacheWrite: 4, total: 13 }, cost: 2 })
  })

  test("child-only activity counts a subagent and child prompt without a root session or prompt", async () => {
    const child = usageSession("child-only", "/child", undefined, "unlisted-parent")
    const list = spyOn(opencodeClient, "listSessionsPage").mockResolvedValue({ sessions: [child], cursor: {} })
    const messages = spyOn(opencodeClient, "getSessionMessages").mockResolvedValue({
      items: [{ info: { id: "prompt", sessionID: child.id, role: "user", time: { created: 100 } }, parts: [] }], cursor: {},
    })
    const logs = spyOn(opencodeClient, "readSessionUsageRecords").mockImplementation(async () => undefined)
    try {
      const result = await fetchWorkspaceUsageStats({ workspaceId: "__unassigned__", from: 0, to: 200, timezone: "UTC" })
      expect(result).toMatchObject({ sessions: 0, subagents: 1, prompts: 0, steps: 0, activity: [] })
    } finally {
      list.mockRestore()
      messages.mockRestore()
      logs.mockRestore()
    }
  })
})
