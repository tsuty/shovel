import { compareByMessageId, describeMessageIdComparison, SnapshotAccumulator } from '@main/acp/snapshotRecord'
import type { SnapshotEntry } from '@shared/types/session'
import type { ToolCallPayload, TranscriptEvent } from '@shared/types/transcript'

function agentEntry(id: string, messageId?: string): SnapshotEntry {
  return { id, role: 'AGENT', markdown: id, ...(messageId ? { messageId } : {}) }
}
const userEntry = (id: string): SnapshotEntry => ({ id, role: 'USER', markdown: id })

describe('compareByMessageId', () => {
  it('AGENT の messageId の並びが同じなら same', () => {
    const local = [userEntry('u1'), agentEntry('a', 'm1'), userEntry('u2'), agentEntry('b', 'm2')]
    const replay = [userEntry('x1'), agentEntry('c', 'm1'), userEntry('x2'), agentEntry('d', 'm2')]
    expect(compareByMessageId(local, replay)).toBe('same')
  })

  it('同じ messageId の連続は1回に畳んで比べる', () => {
    const local = [agentEntry('a', 'm1'), agentEntry('b', 'm1'), agentEntry('c', 'm2')]
    const replay = [agentEntry('d', 'm1'), agentEntry('e', 'm2')]
    expect(compareByMessageId(local, replay)).toBe('same')
  })

  it('USER・ツールコール・思考は比較しない', () => {
    const local: SnapshotEntry[] = [userEntry('u'), { id: 't', role: 'THOUGHT', markdown: 'x' }, agentEntry('a', 'm1')]
    const replay = [agentEntry('b', 'm1')]
    expect(compareByMessageId(local, replay)).toBe('same')
  })

  it('replay にだけ続きがあれば different', () => {
    expect(compareByMessageId([agentEntry('a', 'm1')], [agentEntry('b', 'm1'), agentEntry('c', 'm2')])).toBe('different')
  })

  it('並びが違えば different', () => {
    expect(compareByMessageId([agentEntry('a', 'm1'), agentEntry('b', 'm2')], [agentEntry('c', 'm2'), agentEntry('d', 'm1')])).toBe(
      'different'
    )
  })

  it('replay が messageId を1つも持たなければ incomparable', () => {
    expect(compareByMessageId([agentEntry('a', 'm1')], [agentEntry('b')])).toBe('incomparable')
    expect(compareByMessageId([agentEntry('a', 'm1')], [])).toBe('incomparable')
  })

  it('どちらかに messageId の無い AGENT エントリがあれば different', () => {
    expect(compareByMessageId([agentEntry('a')], [agentEntry('b', 'm1')])).toBe('different')
    expect(compareByMessageId([agentEntry('a', 'm1')], [agentEntry('b', 'm1'), agentEntry('c')])).toBe('different')
  })

  it('describeMessageIdComparison は最初に食い違った位置と片側にしか無い id を返す', () => {
    const detail = describeMessageIdComparison([agentEntry('a', 'm1'), agentEntry('b', 'm2')], [agentEntry('c', 'm1'), agentEntry('d', 'm3')])
    expect(detail).toMatchObject({
      firstMismatch: { index: 1, local: 'm2', replay: 'm3' },
      onlyInLocal: ['m2'],
      onlyInReplay: ['m3']
    })
  })
})

function toolCall(id: string, groupId: string, extra: Partial<ToolCallPayload> = {}): ToolCallPayload {
  return { id, groupId, kind: 'read', title: id, status: 'completed', locations: [], diffs: [], ...extra }
}

describe('SnapshotAccumulator', () => {
  it('確定したブロックを最初に現れた順で保存する（ストリーミング中のものは保存しない）', () => {
    const acc = new SnapshotAccumulator()
    acc.track([
      { type: 'block', id: 'u', role: 'USER', markdown: '質問', streaming: false },
      { type: 'block', id: 'a', role: 'AGENT', markdown: '', streaming: true },
      { type: 'stream', id: 'a', text: '回答' }
    ])
    expect(acc.snapshotEntries()).toEqual([{ id: 'u', role: 'USER', markdown: '質問' }])
    acc.track([{ type: 'blockMarkdown', id: 'a', markdown: '回答', messageId: 'm1' }])
    expect(acc.snapshotEntries()).toEqual([
      { id: 'u', role: 'USER', markdown: '質問' },
      { id: 'a', role: 'AGENT', markdown: '回答', messageId: 'm1' }
    ])
  })

  it('ストリーミング開始時の role を確定時に使う（思考を AGENT として保存しない）', () => {
    const acc = new SnapshotAccumulator()
    acc.track([
      { type: 'block', id: 't', role: 'THOUGHT', markdown: '', streaming: true },
      { type: 'blockMarkdown', id: 't', markdown: '考え', messageId: 'x' }
    ])
    expect(acc.snapshotEntries()).toEqual([{ id: 't', role: 'THOUGHT', markdown: '考え' }])
  })

  it('思考は確定した位置に、ブロックとグループは最初に現れた位置に並べる', () => {
    const acc = new SnapshotAccumulator()
    acc.track([
      { type: 'block', id: 't', role: 'THOUGHT', markdown: '', streaming: true },
      { type: 'block', id: 'a', role: 'AGENT', markdown: '', streaming: true },
      { type: 'group', id: 'g', timed: true, closed: false },
      { type: 'toolCall', toolCall: toolCall('tc', 'g') },
      { type: 'blockMarkdown', id: 'a', markdown: '調べます。' },
      { type: 'blockMarkdown', id: 't', markdown: '考え' }
    ])
    expect(acc.snapshotEntries().map((e) => e.id)).toEqual(['a', 'g', 't'])
  })

  it('ツールコールは rawInput を落としてグループごとに保存し、更新は上書きする', () => {
    const acc = new SnapshotAccumulator()
    acc.track([
      { type: 'group', id: 'g', timed: true, closed: false },
      { type: 'toolCall', toolCall: toolCall('tc', 'g', { status: 'pending', rawInput: { big: 'x' } }) },
      { type: 'toolCall', toolCall: toolCall('tc', 'g', { status: 'completed', rawInput: { big: 'x' } }) }
    ])
    expect(acc.snapshotEntries()).toEqual([
      { id: 'g', role: 'TOOL_GROUP', markdown: '', toolCalls: [toolCall('tc', 'g', { status: 'completed' })] }
    ])
  })

  it('空のグループは保存しない', () => {
    const acc = new SnapshotAccumulator()
    acc.track([{ type: 'group', id: 'g', timed: true, closed: false }])
    expect(acc.snapshotEntries()).toEqual([])
  })

  it('添付チップを USER エントリに付けて保存する', () => {
    const acc = new SnapshotAccumulator()
    const chip = { key: 'a.md', label: 'a.md', path: 'a.md' }
    acc.track([
      { type: 'block', id: 'u', role: 'USER', markdown: '読んで', streaming: false },
      { type: 'attachments', id: 'u', chips: [chip] }
    ])
    expect(acc.snapshotEntries()).toEqual([{ id: 'u', role: 'USER', markdown: '読んで', chips: [chip] }])
  })

  it('seed した内容はそのまま書き出せ、続きを積める', () => {
    const seeded: SnapshotEntry[] = [
      { id: 'u', role: 'USER', markdown: 'q', chips: [{ key: 'a', label: 'a', path: 'a' }] },
      { id: 'g', role: 'TOOL_GROUP', markdown: '', toolCalls: [toolCall('tc', 'g')] },
      { id: 'a', role: 'AGENT', markdown: 'r', messageId: 'm1' }
    ]
    const acc = new SnapshotAccumulator()
    acc.seed(seeded)
    expect(acc.snapshotEntries()).toEqual(seeded)
    acc.track([{ type: 'block', id: 'u2', role: 'USER', markdown: 'q2', streaming: false }])
    expect(acc.snapshotEntries().map((e) => e.id)).toEqual(['u', 'g', 'a', 'u2'])
  })

  it('title は最初の USER 発言の先頭60文字、無ければ既定名', () => {
    const acc = new SnapshotAccumulator()
    expect(acc.title()).toBe('New session')
    acc.track([{ type: 'block', id: 'u', role: 'USER', markdown: 'あ'.repeat(80), streaming: false }])
    expect(acc.title()).toBe('あ'.repeat(60))
  })

  it('isEmpty / reset', () => {
    const acc = new SnapshotAccumulator()
    expect(acc.isEmpty()).toBe(true)
    const events: TranscriptEvent[] = [{ type: 'block', id: 'u', role: 'USER', markdown: 'q', streaming: false }]
    acc.track(events)
    expect(acc.isEmpty()).toBe(false)
    acc.reset()
    expect(acc.isEmpty()).toBe(true)
    expect(acc.snapshotEntries()).toEqual([])
  })
})
