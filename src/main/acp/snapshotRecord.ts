import type { SnapshotEntry } from '@shared/types/session'
import type { AttachmentChip, ToolCallPayload, TranscriptEvent } from '@shared/types/transcript'

export type ReplayComparison = 'same' | 'different' | 'incomparable'

/**
 * AGENT エントリの `messageId` だけを出現順に並べ（同じ id の連続は1回に畳む）、両者を比べる。
 *   - replay 側が1件も `messageId` を持たない → 'incomparable'
 *   - どちらかに `messageId` の無い AGENT エントリがある → 'different'
 *   - 並びが一致 → 'same'、それ以外 → 'different'
 */
export function compareByMessageId(local: SnapshotEntry[], replay: SnapshotEntry[]): ReplayComparison {
  const localIds = collapsedAgentMessageIds(local)
  const replayIds = collapsedAgentMessageIds(replay)
  if (!replayIds.some((id) => id !== undefined)) return 'incomparable'
  if (localIds.includes(undefined) || replayIds.includes(undefined)) return 'different'
  if (localIds.length !== replayIds.length) return 'different'
  return localIds.every((id, i) => id === replayIds[i]) ? 'same' : 'different'
}

/**
 * `compareByMessageId` の判断材料（デバッグログ用）。比べた id の並びと、
 * 最初に食い違った位置、片側にしか無い id、`messageId` を持たない AGENT
 * エントリ（先頭の文字だけ）を返す。
 */
export function describeMessageIdComparison(local: SnapshotEntry[], replay: SnapshotEntry[]): Record<string, unknown> {
  const localIds = collapsedAgentMessageIds(local)
  const replayIds = collapsedAgentMessageIds(replay)
  let firstMismatch = -1
  for (let i = 0; i < Math.max(localIds.length, replayIds.length); i++) {
    if (localIds[i] !== replayIds[i] || localIds[i] === undefined) {
      firstMismatch = i
      break
    }
  }
  const localSet = new Set(localIds)
  const replaySet = new Set(replayIds)
  const withoutId = (entries: SnapshotEntry[]): string[] =>
    entries.filter((e) => e.role === 'AGENT' && !e.messageId).map((e) => e.markdown.slice(0, 40))
  return {
    localCount: localIds.length,
    replayCount: replayIds.length,
    firstMismatch:
      firstMismatch < 0 ? null : { index: firstMismatch, local: localIds[firstMismatch] ?? null, replay: replayIds[firstMismatch] ?? null },
    onlyInLocal: localIds.filter((id) => id !== undefined && !replaySet.has(id)),
    onlyInReplay: replayIds.filter((id) => id !== undefined && !localSet.has(id)),
    localWithoutId: withoutId(local),
    replayWithoutId: withoutId(replay),
    localIds,
    replayIds
  }
}

function collapsedAgentMessageIds(entries: SnapshotEntry[]): (string | undefined)[] {
  const ids: (string | undefined)[] = []
  for (const entry of entries) {
    if (entry.role !== 'AGENT') continue
    const id = entry.messageId
    if (id !== undefined && ids.length > 0 && ids[ids.length - 1] === id) continue
    ids.push(id)
  }
  return ids
}

/**
 * トランスクリプトのスナップショット用に、確定済みのブロックとツールコールのグループを蓄積する。
 * 並び順は renderer の `transcriptReducer` に合わせ、ブロックとグループは最初に現れた位置、
 * 思考だけは確定した位置に置く。
 */
export class SnapshotAccumulator {
  private order: string[] = []
  private readonly entries = new Map<string, SnapshotEntry>()
  private readonly groups = new Map<string, Map<string, ToolCallPayload>>()
  private readonly chips = new Map<string, AttachmentChip[]>()
  /**
   * ストリーミング中のブロックの role。確定時の `blockMarkdown` は role を運ばないので、
   * 開始時の `block` イベントで覚えておく。
   */
  private readonly streamingRoles = new Map<string, SnapshotEntry['role']>()

  private place(id: string): void {
    if (!this.order.includes(id)) this.order.push(id)
  }

  track(events: TranscriptEvent[]): void {
    for (const e of events) {
      if (e.type === 'block') {
        if (e.role !== 'THOUGHT') this.place(e.id)
        if (e.streaming) {
          this.streamingRoles.set(e.id, e.role)
        } else {
          if (e.role === 'THOUGHT') this.place(e.id)
          this.entries.set(e.id, { id: e.id, role: e.role, markdown: e.markdown, ...(e.choices ? { choices: e.choices } : {}) })
        }
      } else if (e.type === 'blockMarkdown') {
        const role = this.entries.get(e.id)?.role ?? this.streamingRoles.get(e.id) ?? 'AGENT'
        this.streamingRoles.delete(e.id)
        this.place(e.id)
        const entry: SnapshotEntry = { id: e.id, role, markdown: e.markdown }
        if (role === 'AGENT' && e.messageId) entry.messageId = e.messageId
        if (e.choices && e.choices.length > 0) entry.choices = e.choices
        this.entries.set(e.id, entry)
      } else if (e.type === 'attachments') {
        this.chips.set(e.id, e.chips)
      } else if (e.type === 'group') {
        this.place(e.id)
        if (!this.groups.has(e.id)) this.groups.set(e.id, new Map())
      } else if (e.type === 'toolCall') {
        const groupId = e.toolCall.groupId
        this.place(groupId)
        const group = this.groups.get(groupId) ?? new Map<string, ToolCallPayload>()
        // rawInput は保存しない。
        const toolCall: ToolCallPayload = { ...e.toolCall }
        delete toolCall.rawInput
        group.set(toolCall.id, toolCall)
        this.groups.set(groupId, group)
      }
    }
  }

  /** ローカルスナップショットの内容をそのまま積む（`messageId` を保ったまま）。 */
  seed(entries: SnapshotEntry[]): void {
    for (const entry of entries) {
      this.place(entry.id)
      if (entry.role === 'TOOL_GROUP') {
        this.groups.set(entry.id, new Map((entry.toolCalls ?? []).map((tc) => [tc.id, { ...tc, groupId: entry.id }])))
        continue
      }
      const { chips, ...rest } = entry
      this.entries.set(entry.id, { ...rest })
      if (chips) this.chips.set(entry.id, chips)
    }
  }

  replaceWith(entries: SnapshotEntry[]): void {
    this.reset()
    this.seed(entries)
  }

  isEmpty(): boolean {
    return this.entries.size === 0 && this.groups.size === 0
  }

  reset(): void {
    this.order = []
    this.entries.clear()
    this.groups.clear()
    this.chips.clear()
    this.streamingRoles.clear()
  }

  snapshotEntries(): SnapshotEntry[] {
    const result: SnapshotEntry[] = []
    for (const id of this.order) {
      const group = this.groups.get(id)
      if (group) {
        if (group.size > 0) result.push({ id, role: 'TOOL_GROUP', markdown: '', toolCalls: Array.from(group.values()) })
        continue
      }
      const entry = this.entries.get(id)
      if (!entry) continue // まだ確定していない（ストリーミング中の）ブロック
      const chips = this.chips.get(id)
      result.push(chips && chips.length > 0 ? { ...entry, chips } : entry)
    }
    return result
  }

  title(): string {
    for (const entry of this.entries.values()) {
      if (entry.role === 'USER') return entry.markdown.slice(0, 60)
    }
    return 'New session'
  }
}
