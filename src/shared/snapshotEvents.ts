import type { SnapshotEntry } from './types/session'
import type { TranscriptEvent } from './types/transcript'

/** ローカルスナップショットの各エントリを、描画用の確定済みイベントに戻す。 */
export function snapshotEntriesToEvents(entries: SnapshotEntry[]): TranscriptEvent[] {
  const events: TranscriptEvent[] = []
  for (const entry of entries) {
    if (entry.role === 'TOOL_GROUP') {
      events.push({ type: 'group', id: entry.id, timed: false, closed: true })
      for (const toolCall of entry.toolCalls ?? []) events.push({ type: 'toolCall', toolCall: { ...toolCall, groupId: entry.id } })
      continue
    }
    if (entry.role === 'SYSTEM' && entry.stopReason) {
      events.push({ type: 'stopReason', id: entry.id, reason: entry.stopReason })
      continue
    }
    if (entry.role === 'COMPACTION') {
      events.push({ type: 'compaction', id: entry.id, summary: entry.markdown, state: entry.compaction ?? { status: 'completed' } })
      continue
    }
    events.push({
      type: 'block',
      id: entry.id,
      role: entry.role,
      markdown: entry.markdown,
      streaming: false,
      ...(entry.choices ? { choices: entry.choices } : {})
    })
    if (entry.chips && entry.chips.length > 0) events.push({ type: 'attachments', id: entry.id, chips: entry.chips })
    if (entry.images && entry.images.length > 0) events.push({ type: 'images', id: entry.id, images: entry.images })
  }
  return events
}
