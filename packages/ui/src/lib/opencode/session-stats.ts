/**
 * OpenCode's experimental usage route (`session.stats`,
 * `GET /api/experimental/session/stats`), translated into the shape the usage
 * page reads.
 *
 * Route semantics (OpenCode 2.1.4, `packages/core/src/session/stats.ts`):
 * - `from`/`to` are epoch milliseconds, `from` inclusive, `to` exclusive.
 *   `to` defaults to now; without `from` the range starts at the oldest
 *   message. `from >= to` is a 400.
 * - `timezone` is an IANA zone used to bucket `activity` into `YYYY-MM-DD`
 *   days (defaults to UTC, so we always send the viewer's zone).
 * - `tools` selects the tool-call breakdown. We ask for `"detail"`: the same
 *   message scan `"summary"` runs, plus per-tool counts sorted by calls and a
 *   median duration. `"none"` would make OpenCode skip that work.
 *
 * A failed read throws; it is never a zeroed report.
 */

import type { SessionStatsInfo } from "@opencode/client"
import { normalizeOpencodeError, opencodeClient } from "./client"
import type { Message, Part, Session } from "./model"
import { useWorkspacesStore } from "@/stores/useWorkspacesStore"
import { readWorkspaceScope } from "@/lib/workspaces/session-scope"
import { readWorkspaceAssignment } from "@/lib/workspaces/session-assignment"

export interface UsageTokens {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface UsageModel {
  providerID: string
  modelID: string
  variant: string | null
  steps: number
  tokens: UsageTokens
  cost: number
}

/** Tool-call counts for the whole report. */
interface UsageToolTotals {
  calls: number
  succeeded: number
  failed: number
  /** Neither completed nor errored: interrupted, pending or unknown state. */
  unfinished: number
}

/** One tool's counts; `detail` reports carry these per tool. */
interface UsageToolUsage {
  name: string
  calls: number
  succeeded: number
  failed: number
  unfinished: number
  /** Median duration of completed calls in ms; absent when none completed. */
  durationP50: number | null
}

/** The tool-call breakdown the request mode produced; `none` carries nothing. */
export type UsageTools =
  | { mode: "none" }
  | { mode: "summary"; totals: UsageToolTotals }
  | { mode: "detail"; totals: UsageToolTotals; usage: UsageToolUsage[] }

export interface UsageStats {
  range: { from: number; to: number }
  sessions: number
  subagents: number
  prompts: number
  steps: number
  tokens: UsageTokens
  cost: number
  tools: UsageTools
  activeDays: number
  /** Longest run of consecutive active days inside the range. */
  streak: number
  /** Active days only, ascending; days with no model steps are absent. */
  activity: Array<{ date: string; steps: number }>
  /** Sorted by total tokens, largest first. */
  models: UsageModel[]
}

interface UsageStatsQuery {
  from?: number
  to?: number
  timezone: string
}

const toTokens = (tokens: SessionStatsInfo["tokens"]): UsageTokens => ({
  input: tokens.input,
  output: tokens.output,
  reasoning: tokens.reasoning,
  cacheRead: tokens.cache.read,
  cacheWrite: tokens.cache.write,
  total: tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write,
})

const toTools = (tools: SessionStatsInfo["tools"]): UsageTools => {
  if (tools.mode === "none") return { mode: "none" }
  const totals = {
    calls: tools.totals.calls,
    succeeded: tools.totals.succeeded,
    failed: tools.totals.failed,
    unfinished: tools.totals.unfinished,
  }
  if (tools.mode === "summary") return { mode: "summary", totals }
  return {
    mode: "detail",
    totals,
    usage: tools.usage.map((tool) => ({
      name: tool.name,
      calls: tool.calls,
      succeeded: tool.succeeded,
      failed: tool.failed,
      unfinished: tool.unfinished,
      durationP50: tool.durationP50 ?? null,
    })),
  }
}

const toUsageStats = (info: SessionStatsInfo): UsageStats => ({
  range: { from: info.range.from, to: info.range.to },
  sessions: info.sessions,
  subagents: info.subagents,
  prompts: info.prompts,
  steps: info.steps,
  tokens: toTokens(info.tokens),
  cost: info.cost,
  tools: toTools(info.tools),
  activeDays: info.activeDays,
  streak: info.streak,
  activity: info.activity.map((day) => ({ date: day.date, steps: day.steps })),
  models: info.models.map((entry) => ({
    providerID: entry.model.providerID,
    modelID: entry.model.id,
    variant: entry.model.variant ?? null,
    steps: entry.steps,
    tokens: toTokens(entry.tokens),
    cost: entry.cost,
  })),
})

const requestStats = async (query: UsageStatsQuery, tools: "none" | "detail", signal?: AbortSignal): Promise<SessionStatsInfo> => {
  try {
    return await opencodeClient.getSdkClient().session.stats(
      { from: query.from, to: query.to, timezone: query.timezone, tools },
      { signal },
    )
  } catch (error) {
    throw normalizeOpencodeError("session.stats", error)
  }
}

/**
 * The report without tool calls: `tools: "none"` keeps OpenCode from scanning
 * every tool call in the range, a cost that grows with history. The server
 * defaults to `summary`, so the mode is always sent.
 */
export async function fetchUsageStats(query: UsageStatsQuery, signal?: AbortSignal): Promise<UsageStats> {
  return toUsageStats(await requestStats(query, "none", signal))
}

/**
 * Tool calls for a report, on request. There is no tools-only mode: the route
 * recomputes the whole report and only `tools` is kept. Pass the loaded
 * report's `range` so the numbers cover the same window as the page.
 */
export async function fetchUsageTools(query: UsageStatsQuery, signal?: AbortSignal): Promise<UsageTools> {
  return toTools((await requestStats(query, "detail", signal)).tools)
}

export type WorkspaceUsageQuery = UsageStatsQuery & { workspaceId: string | "__unassigned__" }

const PAGE_SIZE = 100
const MESSAGE_PAGE_SIZE = 100
const MAX_PARALLEL_SESSIONS = 4

type SessionMembership = Pick<Session, "id" | "parentID" | "metadata">

export function resolveUsageWorkspaceId(session: SessionMembership, sessions: ReadonlyMap<string, SessionMembership>): string | null {
  let current: SessionMembership | undefined = session
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const scope = readWorkspaceScope(current.metadata)
    if (scope) return scope.workspaceId
    const assignment = readWorkspaceAssignment(current.metadata)
    if (assignment) return assignment.workspaceId
    current = current.parentID ? sessions.get(current.parentID) : undefined
  }
  return null
}

export function belongsToUsageSelection(owner: string | null, workspaceId: string | "__unassigned__", knownWorkspaceIds: ReadonlySet<string>): boolean {
  return workspaceId === "__unassigned__" ? owner === null || !knownWorkspaceIds.has(owner) : owner === workspaceId
}

async function allSessions(signal: AbortSignal): Promise<Session[]> {
  const result: Session[] = []
  let cursor: string | undefined
  do {
    signal.throwIfAborted()
    const page = await opencodeClient.listSessionsPage({ global: true, limit: PAGE_SIZE, cursor, signal })
    result.push(...page.sessions)
    cursor = page.cursor.next
  } while (cursor)
  return result
}

type UsageMessage = { info: Message; parts: Part[] }

async function allMessages(session: Session, signal: AbortSignal, from?: number): Promise<UsageMessage[]> {
  const result: UsageMessage[] = []
  let cursor: string | undefined
  const lowerBound = from === undefined ? undefined : Math.max(from, session.fork ? session.time.created : from)
  do {
    signal.throwIfAborted()
    const page = await opencodeClient.getSessionMessages(session.id, { limit: MESSAGE_PAGE_SIZE, cursor, order: "desc", signal }, session.directory)
    result.push(...(lowerBound === undefined ? page.items : page.items.filter(({ info }) => info.time.created >= lowerBound)))
    const oldest = page.items.at(-1)?.info.time.created
    cursor = page.cursor.next
    if (lowerBound !== undefined && oldest !== undefined && oldest < lowerBound) break
  } while (cursor)
  return result
}

export type UsageTotals = { tokens: UsageTokens; cost: number }

type CompactionUsage = {
  created: number
  source: string
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

function newUsageTokens(): UsageTokens {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

function addUsageTokens(target: UsageTokens, source: UsageTokens): void {
  target.input += source.input
  target.output += source.output
  target.reasoning += source.reasoning
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
  target.total += source.total
}

export function addCompactionUsage(totals: UsageTotals, event: CompactionUsage, window: { from: number; to: number }): void {
  if (event.source !== "compaction" || event.created < window.from || event.created >= window.to) return
  const source = event.tokens
  addUsageTokens(totals.tokens, {
    input: source.input, output: source.output, reasoning: source.reasoning,
    cacheRead: source.cache.read, cacheWrite: source.cache.write,
    total: source.input + source.output + source.reasoning + source.cache.read + source.cache.write,
  })
  totals.cost += event.cost
}

function reportFromMessages(
  sessions: readonly Session[],
  messages: ReadonlyMap<string, readonly UsageMessage[]>,
  query: WorkspaceUsageQuery,
  window: { from: number; to: number },
  compaction: UsageTotals,
): UsageStats {
  const models = new Map<string, UsageModel>()
  const activity = new Map<string, number>()
  const tokens = newUsageTokens()
  let prompts = 0
  let steps = 0
  let cost = 0
  const rootSessions = new Set<string>()
  const subagents = new Set<string>()
  const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: query.timezone, year: "numeric", month: "2-digit", day: "2-digit" })
  for (const session of sessions) {
    for (const { info: message } of messages.get(session.id) ?? []) {
      const timestamp = message.time.created
      if (timestamp < window.from || timestamp >= window.to || (session.fork && timestamp < session.time.created)) continue
      if (message.role !== "user" && message.role !== "assistant") continue
      if (session.parentID) subagents.add(session.id)
      else rootSessions.add(session.id)
      if (message.role === "user") {
        if (!session.parentID) prompts++
        continue
      }
      const entry = models.get(`${message.providerID}/${message.modelID}#${message.variant ?? ""}`) ?? {
        providerID: message.providerID, modelID: message.modelID, variant: message.variant ?? null, steps: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
      }
      const usage = message.tokens
      if (usage) {
        const values = { input: usage.input, output: usage.output, reasoning: usage.reasoning, cacheRead: usage.cache.read, cacheWrite: usage.cache.write }
        // SAFETY: `values` is constructed above with exactly the token keys in UsageTokens.
        for (const key of Object.keys(values) as Array<keyof typeof values>) {
          entry.tokens[key] += values[key]
          tokens[key] += values[key]
        }
        entry.tokens.total += Object.values(values).reduce((sum, value) => sum + value, 0)
        tokens.total += Object.values(values).reduce((sum, value) => sum + value, 0)
      }
      entry.cost += message.cost ?? 0
      cost += message.cost ?? 0
      entry.steps++
      steps++
      const dateParts = Object.fromEntries(dateFormatter.formatToParts(timestamp).map((part) => [part.type, part.value]))
      const date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`
      activity.set(date, (activity.get(date) ?? 0) + 1)
      models.set(`${message.providerID}/${message.modelID}#${message.variant ?? ""}`, entry)
    }
  }
  addUsageTokens(tokens, compaction.tokens)
  cost += compaction.cost
  const dates = [...activity.keys()].sort()
  let streak = 0
  let longest = 0
  let previous = -1
  for (const day of dates) {
    const current = Date.parse(`${day}T00:00:00Z`) / 86_400_000
    streak = current === previous + 1 ? streak + 1 : 1
    longest = Math.max(longest, streak)
    previous = current
  }
  return {
    range: window, sessions: rootSessions.size, subagents: subagents.size,
    prompts, steps, tokens, cost, tools: { mode: "none" }, activeDays: dates.length, streak: longest,
    activity: dates.map((date) => ({ date, steps: activity.get(date) ?? 0 })),
    models: [...models.values()].sort((a, b) => b.tokens.total - a.tokens.total),
  }
}

async function fetchWorkspaceData(query: WorkspaceUsageQuery, signal: AbortSignal, includeCompaction: boolean): Promise<{
  sessions: Session[]
  messages: Map<string, UsageMessage[]>
  window: { from: number; to: number }
  compaction: UsageTotals
}> {
  const inventory = await allSessions(signal)
  const byId = new Map(inventory.map((session) => [session.id, session]))
  const assignments = new Map(inventory.map((session) => [session.id, resolveUsageWorkspaceId(session, byId)]))
  const workspaceState = useWorkspacesStore.getState()
  if (query.workspaceId === "__unassigned__" && !workspaceState.hasBaseline) {
    throw new Error("Workspace catalog is not available")
  }
  const workspaces = workspaceState.catalog.workspaces
  const knownWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id))
  const selected = inventory.filter((session) => {
    const owner = assignments.get(session.id) ?? null
    return belongsToUsageSelection(owner, query.workspaceId, knownWorkspaceIds)
  })
  const now = Date.now()
  const to = query.to ?? now
  const messageMap = new Map<string, UsageMessage[]>()
  for (let index = 0; index < selected.length; index += MAX_PARALLEL_SESSIONS) {
    signal.throwIfAborted()
    const batch = selected.slice(index, index + MAX_PARALLEL_SESSIONS)
    const pages = await Promise.all(batch.map((session) => allMessages(session, signal, query.from)))
    batch.forEach((session, batchIndex) => messageMap.set(session.id, pages[batchIndex]))
  }
  let oldestMessage: number | undefined
  for (const [sessionID, page] of messageMap) {
    const session = byId.get(sessionID)
    if (!session) continue
    for (const { info } of page) {
      if (info.role !== "user" && info.role !== "assistant") continue
      if ((session.fork && info.time.created < session.time.created) || info.time.created >= to) continue
      oldestMessage = oldestMessage === undefined ? info.time.created : Math.min(oldestMessage, info.time.created)
    }
  }
  const window = { from: query.from ?? oldestMessage ?? to, to }
  const compaction: UsageTotals = { tokens: newUsageTokens(), cost: 0 }
  if (includeCompaction) {
    for (let index = 0; index < selected.length; index += MAX_PARALLEL_SESSIONS) {
      signal.throwIfAborted()
      await Promise.all(selected.slice(index, index + MAX_PARALLEL_SESSIONS).map((session) =>
        opencodeClient.readSessionUsageRecords(session.id, (item) => {
          addCompactionUsage(compaction, item, window)
        }, signal),
      ))
    }
  }
  return { sessions: selected, messages: messageMap, window, compaction }
}

export async function fetchWorkspaceUsageStats(query: WorkspaceUsageQuery, signal?: AbortSignal): Promise<UsageStats> {
  const active = signal ?? new AbortController().signal
  const data = await fetchWorkspaceData(query, active, true)
  return reportFromMessages(data.sessions, data.messages, query, data.window, data.compaction)
}

export async function fetchWorkspaceUsageTools(query: WorkspaceUsageQuery, signal?: AbortSignal): Promise<UsageTools> {
  const active = signal ?? new AbortController().signal
  const data = await fetchWorkspaceData(query, active, false)
  const byTool = new Map<string, { calls: number; succeeded: number; failed: number; unfinished: number; durations: number[] }>()
  let calls = 0
  let succeeded = 0
  let failed = 0
  let unfinished = 0
  const sessionsById = new Map(data.sessions.map((session) => [session.id, session]))
  for (const page of data.messages.values()) for (const { info, parts } of page) {
    if (info.role !== "assistant" || info.time.created < data.window.from || info.time.created >= data.window.to) continue
    const session = sessionsById.get(info.sessionID)
    if (!session || (session.fork && info.time.created < session.time.created)) continue
    for (const part of parts) {
      if (part.type !== "tool") continue
      const tool = part
      const entry = byTool.get(tool.tool) ?? { calls: 0, succeeded: 0, failed: 0, unfinished: 0, durations: [] }
      entry.calls++
      calls++
      if (tool.state.status === "completed") {
        entry.succeeded++
        succeeded++
      } else if (tool.state.status === "error") {
        entry.failed++
        failed++
      } else {
        entry.unfinished++
        unfinished++
      }
      if (tool.completedDurationMs !== undefined) entry.durations.push(tool.completedDurationMs)
      byTool.set(tool.tool, entry)
    }
  }
  const usage = [...byTool].map(([name, entry]) => {
    const sorted = entry.durations.sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    const durationP50 = sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null
    return { name, calls: entry.calls, succeeded: entry.succeeded, failed: entry.failed, unfinished: entry.unfinished, durationP50 }
  }).sort((a, b) => b.calls - a.calls)
  return { mode: "detail", totals: { calls, succeeded, failed, unfinished }, usage }
}
