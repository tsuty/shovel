import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { SessionTranslator } from '@main/acp/translate'
import { SnapshotAccumulator } from '@main/acp/snapshotRecord'
import { initialTranscriptState, transcriptReducer, type TranscriptState } from '@renderer/main-window/transcriptState'
import { snapshotEntriesToEvents } from '@shared/snapshotEvents'
import type { TranscriptEvent } from '@shared/types/transcript'

const reduce = (events: TranscriptEvent[], state: TranscriptState = initialTranscriptState): TranscriptState =>
  events.reduce(transcriptReducer, state)

describe('transcriptReducer', () => {
  it('ストリーミング中のブロックに追記し、確定で Markdown を差し替える', () => {
    const state = reduce([
      { type: 'block', id: 'a', role: 'AGENT', markdown: '', streaming: true },
      { type: 'stream', id: 'a', text: 'Hel' },
      { type: 'stream', id: 'a', text: 'lo' }
    ])
    expect(state.blocks.a).toMatchObject({ markdown: 'Hello', streaming: true })
    const done = reduce([{ type: 'blockMarkdown', id: 'a', markdown: 'Hello!', choices: [{ id: 'c', label: 'x' }] }], state)
    expect(done.blocks.a).toMatchObject({ markdown: 'Hello!', streaming: false, choices: [{ id: 'c', label: 'x' }] })
  })

  it('ストリーミング中の思考は本体に並べず、確定したら折り畳みブロックとして末尾に移す', () => {
    const state = reduce([
      { type: 'block', id: 't', role: 'THOUGHT', markdown: '', streaming: true },
      { type: 'stream', id: 't', text: '考え中' },
      { type: 'block', id: 'a', role: 'AGENT', markdown: '答え', streaming: false }
    ])
    expect(state.liveThought).toEqual({ id: 't', markdown: '考え中' })
    expect(state.order).toEqual([{ kind: 'block', id: 'a' }])
    const done = reduce([{ type: 'blockMarkdown', id: 't', markdown: '考え中。' }], state)
    expect(done.liveThought).toBeNull()
    expect(done.order).toEqual([
      { kind: 'block', id: 'a' },
      { kind: 'block', id: 't' }
    ])
    expect(done.blocks.t).toMatchObject({ role: 'THOUGHT', markdown: '考え中。', streaming: false })
  })

  it('確定済みの思考（スナップショット由来）は最初から本体に並べる', () => {
    const state = reduce([{ type: 'block', id: 't', role: 'THOUGHT', markdown: 'x', streaming: false }])
    expect(state.liveThought).toBeNull()
    expect(state.order).toEqual([{ kind: 'block', id: 't' }])
  })

  it('グループは初出の位置に1度だけ並べ、閉じた状態は更新する', () => {
    const state = reduce([
      { type: 'group', id: 'g', timed: true, closed: false },
      { type: 'block', id: 'a', role: 'AGENT', markdown: '', streaming: false },
      { type: 'group', id: 'g', timed: true, closed: true }
    ])
    expect(state.order).toEqual([
      { kind: 'group', id: 'g' },
      { kind: 'block', id: 'a' }
    ])
    expect(state.groups.g).toEqual({ id: 'g', closed: true })
  })

  it('ツールコールは id で上書きし、新しいものは末尾に足す', () => {
    const tc = { groupId: 'g', kind: 'read' as const, title: 't', locations: [], diffs: [] }
    const state = reduce([
      { type: 'toolCall', toolCall: { ...tc, id: '1', status: 'pending' } },
      { type: 'toolCall', toolCall: { ...tc, id: '2', status: 'pending' } },
      { type: 'toolCall', toolCall: { ...tc, id: '1', status: 'completed' } }
    ])
    expect(state.toolCallsByGroup.g?.map((c) => [c.id, c.status])).toEqual([
      ['1', 'completed'],
      ['2', 'pending']
    ])
  })

  it('権限要求を pending で積み、解決で状態と選択肢を記録する', () => {
    const state = reduce([
      { type: 'permission', id: 'p', toolCallId: 'tc', headline: 'h', bodyMarkdown: '', flat: true, options: [] },
      { type: 'permissionResolved', id: 'p', status: 'selected', optionId: 'allow' }
    ])
    expect(state.permissions.p).toMatchObject({ status: 'selected', chosenOptionId: 'allow' })
  })

  it('知らない id への stream / blockMarkdown / attachments / permissionResolved は無視する', () => {
    const events: TranscriptEvent[] = [
      { type: 'stream', id: 'x', text: 'a' },
      { type: 'blockMarkdown', id: 'x', markdown: 'a' },
      { type: 'attachments', id: 'x', chips: [] },
      { type: 'permissionResolved', id: 'x', status: 'cancelled' }
    ]
    expect(reduce(events)).toEqual(initialTranscriptState)
  })

  it('notice は SYSTEM ブロックとして並べる', () => {
    const state = reduce([{ type: 'notice', id: 'n', key: 'replayAdopted' }])
    expect(state.blocks.n).toMatchObject({ role: 'SYSTEM', noticeKey: 'replayAdopted' })
  })

  it('reset で空に戻す', () => {
    const state = reduce([{ type: 'block', id: 'a', role: 'AGENT', markdown: 'x', streaming: false }])
    expect(transcriptReducer(state, { type: 'reset', sessionId: 's' })).toEqual(initialTranscriptState)
  })
})

describe('ライブ表示とスナップショットからの復元表示', () => {
  function liveTurn(translator: SessionTranslator): TranscriptEvent[] {
    const updates = [
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '方針を考える' }, messageId: 't1' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '調べます。' }, messageId: 'm1' },
      { sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'Read a.ts', kind: 'read', status: 'pending' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'completed' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '- [ ] 案A\n- [ ] 案B' }, messageId: 'm2' }
    ] as SessionUpdate[]
    return [
      ...translator.userPrompt('a.ts を見て', [{ key: 'a.ts', label: 'a.ts', path: 'a.ts' }]),
      ...updates.flatMap((u) => translator.handleSessionUpdate(u)),
      ...translator.handleStop('end_turn')
    ]
  }

  it('保存して読み戻した表示は、ライブで描いた表示と同じ並び・内容になる', () => {
    const events = liveTurn(new SessionTranslator('/w'))
    const live = reduce(events)

    const acc = new SnapshotAccumulator()
    acc.track(events)
    const restored = reduce(snapshotEntriesToEvents(acc.snapshotEntries()))

    expect(restored.order).toEqual(live.order)
    expect(restored.blocks).toEqual(live.blocks)
    expect(restored.toolCallsByGroup).toEqual(
      Object.fromEntries(
        Object.entries(live.toolCallsByGroup).map(([id, calls]) => [id, calls.map(({ rawInput: _, ...rest }) => rest)])
      )
    )
    expect(Object.values(restored.groups).every((g) => g.closed)).toBe(true)
  })
})
