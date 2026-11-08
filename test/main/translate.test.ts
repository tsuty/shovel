import type { RequestPermissionRequest, SessionUpdate } from '@agentclientprotocol/sdk'
import { askQuestions, permissionRequestToEvent, SessionTranslator } from '@main/acp/translate'
import type { TranscriptEvent } from '@shared/types/transcript'

const SANDBOX = '/workspace/project'

function agent(text: string, messageId?: string): SessionUpdate {
  return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text }, messageId }
}
function thought(text: string, messageId?: string): SessionUpdate {
  return { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text }, messageId }
}
function user(content: unknown, messageId?: string): SessionUpdate {
  return { sessionUpdate: 'user_message_chunk', content, messageId } as SessionUpdate
}
function toolCall(fields: Record<string, unknown>): SessionUpdate {
  return { sessionUpdate: 'tool_call', ...fields } as SessionUpdate
}
function toolCallUpdate(fields: Record<string, unknown>): SessionUpdate {
  return { sessionUpdate: 'tool_call_update', ...fields } as SessionUpdate
}

function run(translator: SessionTranslator, updates: SessionUpdate[]): TranscriptEvent[] {
  return [...updates.flatMap((u) => translator.handleSessionUpdate(u)), ...translator.handleStop('end_turn')]
}

/** 確定時点の各ブロックの role と本文を、最初に現れた順に返す。 */
function finalBlocks(events: TranscriptEvent[]): { role: string; markdown: string }[] {
  const order: string[] = []
  const roles = new Map<string, string>()
  const text = new Map<string, string>()
  for (const e of events) {
    if (e.type === 'block') {
      order.push(e.id)
      roles.set(e.id, e.role)
      text.set(e.id, e.markdown)
    } else if (e.type === 'blockMarkdown') {
      text.set(e.id, e.markdown)
    }
  }
  return order.map((id) => ({ role: roles.get(id)!, markdown: text.get(id)! }))
}

describe('SessionTranslator: エージェントの返信', () => {
  it('チャンクを1ブロックに連結し、stop で Markdown として確定する', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = run(t, [agent('Hello, ', 'm1'), agent('world', 'm1')])
    expect(events.map((e) => e.type)).toEqual(['block', 'stream', 'stream', 'blockMarkdown'])
    const last = events.at(-1)
    expect(last).toMatchObject({ type: 'blockMarkdown', markdown: 'Hello, world', messageId: 'm1' })
  })

  it('messageId が変わったら別ブロックにする', () => {
    const t = new SessionTranslator(SANDBOX)
    expect(finalBlocks(run(t, [agent('A', 'm1'), agent('B', 'm2')]))).toEqual([
      { role: 'AGENT', markdown: 'A' },
      { role: 'AGENT', markdown: 'B' }
    ])
  })

  it('タスクリストの行を choices として抜き出す', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = run(t, [agent('どれにしますか？\n- [ ] 案A\n- [x] 案B\n')])
    const done = events.find((e) => e.type === 'blockMarkdown')
    expect(done).toMatchObject({
      choices: [
        { id: expect.stringMatching(/:0$/), label: '案A' },
        { id: expect.stringMatching(/:1$/), label: '案B' }
      ]
    })
  })

  it('タスクリストが無ければ choices は付けない', () => {
    const t = new SessionTranslator(SANDBOX)
    const done = run(t, [agent('普通の返信')]).find((e) => e.type === 'blockMarkdown')
    expect(done).toMatchObject({ choices: undefined })
  })

  it('ツールコールを挟んだ後の返信は、ツールコールより後ろの別ブロックになる（messageId 無し）', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = run(t, [
      agent('調べます。'),
      toolCall({ toolCallId: 'tc1', title: 'Read a.ts', kind: 'read', status: 'completed' }),
      agent('分かりました。')
    ])
    expect(finalBlocks(events)).toEqual([
      { role: 'AGENT', markdown: '調べます。' },
      { role: 'AGENT', markdown: '分かりました。' }
    ])
  })
})

describe('SessionTranslator: 思考', () => {
  it('思考は THOUGHT ブロックとして流し、stop で確定する', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = run(t, [thought('考え中', 't1'), agent('答え', 'm1')])
    expect(finalBlocks(events)).toEqual([
      { role: 'THOUGHT', markdown: '考え中' },
      { role: 'AGENT', markdown: '答え' }
    ])
  })
})

describe('SessionTranslator: ユーザー発言', () => {
  it('userPrompt は確定済みの USER ブロックと添付チップを出す', () => {
    const t = new SessionTranslator(SANDBOX)
    const chip = { key: 'a.md', label: 'a.md', path: 'a.md' }
    const events = t.userPrompt('読んで', [chip])
    expect(events).toEqual([
      { type: 'block', id: expect.any(String), role: 'USER', markdown: '読んで', streaming: false },
      { type: 'attachments', id: expect.any(String), chips: [chip] }
    ])
  })

  it('ライブ中の user_message_chunk は描かない', () => {
    const t = new SessionTranslator(SANDBOX)
    expect(t.handleSessionUpdate(user({ type: 'text', text: 'echo' }))).toEqual([])
  })

  it('replay 中は user_message_chunk を USER ブロックとして描く', () => {
    const t = new SessionTranslator(SANDBOX)
    t.setReplayMode(true)
    expect(finalBlocks(run(t, [user({ type: 'text', text: '質問' }, 'u1'), agent('回答', 'm1')]))).toEqual([
      { role: 'USER', markdown: '質問' },
      { role: 'AGENT', markdown: '回答' }
    ])
  })

  it('replay の resource_link をプロジェクト相対パスのチップに戻す', () => {
    const t = new SessionTranslator(SANDBOX)
    t.setReplayMode(true)
    const events = t.handleSessionUpdate(
      user({ type: 'resource_link', name: 'b.ts', uri: `file://${SANDBOX}/src/b.ts` }, 'u1')
    )
    expect(events.find((e) => e.type === 'attachments')).toMatchObject({
      chips: [{ key: 'src/b.ts', label: 'b.ts', path: 'src/b.ts' }]
    })
  })

  it('replay の [@name](file://…) メンションをチップに戻し、本文から取り除く', () => {
    const t = new SessionTranslator(SANDBOX)
    t.setReplayMode(true)
    const events = run(t, [user({ type: 'text', text: `[@a.md](file://${SANDBOX}/a.md) これを読んで` }, 'u1')])
    expect(events.find((e) => e.type === 'attachments')).toMatchObject({ chips: [{ path: 'a.md' }] })
    expect(finalBlocks(events)).toEqual([{ role: 'USER', markdown: ' これを読んで' }])
  })

  it('プロジェクト外を指すメンションは本文に残す', () => {
    const t = new SessionTranslator(SANDBOX)
    t.setReplayMode(true)
    const text = '[@passwd](file:///etc/passwd) 見て'
    const events = run(t, [user({ type: 'text', text }, 'u1')])
    expect(events.some((e) => e.type === 'attachments')).toBe(false)
    expect(finalBlocks(events)).toEqual([{ role: 'USER', markdown: text }])
  })

  it('ワークスペース名が前方一致するだけの別ディレクトリはチップにしない', () => {
    const t = new SessionTranslator(SANDBOX)
    t.setReplayMode(true)
    const events = t.handleSessionUpdate(
      user({ type: 'resource_link', name: 'x', uri: `file://${SANDBOX}-other/x.md` }, 'u1')
    )
    expect(events.some((e) => e.type === 'attachments')).toBe(false)
  })
})

describe('SessionTranslator: ツールコール', () => {
  it('連続するツールコールを1つのグループにまとめ、返信が始まったらグループを閉じる', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = run(t, [
      toolCall({ toolCallId: 'a', title: 'Read', kind: 'read' }),
      toolCall({ toolCallId: 'b', title: 'Edit', kind: 'edit' }),
      agent('完了', 'm1')
    ])
    const groups = events.filter((e) => e.type === 'group')
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ closed: false })
    expect(groups[1]).toMatchObject({ id: (groups[0] as { id: string }).id, closed: true })
    const calls = events.filter((e): e is Extract<TranscriptEvent, { type: 'toolCall' }> => e.type === 'toolCall')
    expect(new Set(calls.map((c) => c.toolCall.groupId)).size).toBe(1)
  })

  it('tool_call_update は送られてきたフィールドだけを重ねる', () => {
    const t = new SessionTranslator(SANDBOX)
    t.handleSessionUpdate(
      toolCall({ toolCallId: 'a', title: 'Read a.ts', kind: 'read', status: 'pending', locations: [{ path: '/w/a.ts', line: 3 }] })
    )
    const [update] = t.handleSessionUpdate(toolCallUpdate({ toolCallId: 'a', status: 'completed' }))
    expect(update).toMatchObject({
      type: 'toolCall',
      toolCall: { id: 'a', title: 'Read a.ts', kind: 'read', status: 'completed', locations: [{ path: '/w/a.ts', line: 3 }] }
    })
  })

  it('グループが閉じた後に届いた更新は、元のグループのまま差し替える', () => {
    const t = new SessionTranslator(SANDBOX)
    const first = t.handleSessionUpdate(toolCall({ toolCallId: 'a', title: 'Run', kind: 'execute' }))
    const groupId = (first[0] as { id: string }).id
    t.handleSessionUpdate(agent('途中経過', 'm1'))
    const late = t.handleSessionUpdate(toolCallUpdate({ toolCallId: 'a', status: 'completed' }))
    expect(late).toEqual([{ type: 'toolCall', toolCall: expect.objectContaining({ groupId, status: 'completed' }) }])
  })

  it('タイトルが無ければ toolCallId、kind が無ければ other、status が無ければ pending', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = t.handleSessionUpdate(toolCall({ toolCallId: 'x' }))
    expect(events[1]).toMatchObject({ toolCall: { title: 'x', kind: 'other', status: 'pending' } })
  })

  it('diff を ToolCallDiff に変換し、追加・削除行数を数える', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = t.handleSessionUpdate(
      toolCall({
        toolCallId: 'e',
        kind: 'edit',
        content: [{ type: 'diff', path: '/w/a.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc\nd' }]
      })
    )
    expect(events[1]).toMatchObject({
      toolCall: { diffs: [{ path: '/w/a.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc\nd', added: 2, removed: 1 }] }
    })
  })

  it('新規ファイルの diff は全行を追加として数える', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = t.handleSessionUpdate(
      toolCall({ toolCallId: 'n', kind: 'edit', content: [{ type: 'diff', path: '/w/new.ts', newText: 'x\ny' }] })
    )
    expect(events[1]).toMatchObject({ toolCall: { diffs: [{ added: 2, removed: 0 }] } })
  })

  it('diff 以外の content は展開用のテキストとして結合する', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = t.handleSessionUpdate(
      toolCall({
        toolCallId: 's',
        kind: 'search',
        content: [
          { type: 'content', content: { type: 'text', text: 'hit 1' } },
          { type: 'content', content: { type: 'text', text: 'hit 2' } }
        ]
      })
    )
    expect(events[1]).toMatchObject({ toolCall: { content: 'hit 1\nhit 2' } })
  })
})

const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')

describe('SessionTranslator: 停止理由', () => {
  it('end_turn では何も足さない', () => {
    const t = new SessionTranslator(SANDBOX)
    expect(run(t, [agent('A', 'm1')]).some((e) => e.type === 'stopReason')).toBe(false)
  })

  it.each(['cancelled', 'max_tokens', 'max_turn_requests', 'refusal'] as const)('%s は末尾に stopReason を足す', (reason) => {
    const t = new SessionTranslator(SANDBOX)
    t.handleSessionUpdate(agent('A', 'm1'))
    const events = t.handleStop(reason)
    expect(events.at(-1)).toEqual({ type: 'stopReason', id: expect.any(String), reason })
    expect(events.at(-2)).toMatchObject({ type: 'blockMarkdown' })
  })
})

describe('SessionTranslator: 画像', () => {
  it('返信の画像は本文に混ぜず、ブロックの画像として累積して送る', () => {
    const t = new SessionTranslator(SANDBOX)
    const image = { type: 'image', data: PNG_BASE64, mimeType: 'image/png' }
    const events = run(t, [
      { sessionUpdate: 'agent_message_chunk', content: image, messageId: 'm1' } as SessionUpdate,
      agent('説明', 'm1'),
      { sessionUpdate: 'agent_message_chunk', content: { ...image, data: 'AAAA' }, messageId: 'm1' } as SessionUpdate
    ])
    expect(finalBlocks(events)).toEqual([{ role: 'AGENT', markdown: '説明' }])
    const images = events.filter((e) => e.type === 'images')
    expect(images.at(-1)).toMatchObject({
      images: [{ mimeType: 'image/png', data: PNG_BASE64 }, { mimeType: 'image/png' }]
    })
    expect(images.at(-1)).not.toHaveProperty('images.1.data')
  })

  it('ツールコールの結果の画像は images に取り出し、本文には入れない', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = t.handleSessionUpdate(
      toolCall({
        toolCallId: 'a',
        title: 'Screenshot',
        content: [
          { type: 'content', content: { type: 'text', text: '撮りました' } },
          { type: 'content', content: { type: 'image', data: PNG_BASE64, mimeType: 'image/png' } }
        ]
      })
    )
    const last = events.at(-1)
    expect(last).toMatchObject({
      type: 'toolCall',
      toolCall: { content: '撮りました', images: [{ mimeType: 'image/png', data: PNG_BASE64 }] }
    })
  })
})

describe('SessionTranslator: ツールコールの名前', () => {
  function lastToolCall(events: TranscriptEvent[]) {
    const e = events.filter((x): x is Extract<TranscriptEvent, { type: 'toolCall' }> => x.type === 'toolCall').at(-1)
    return e?.toolCall
  }

  it('title が無ければツール名を、どちらも無ければ toolCallId を出す', () => {
    const t = new SessionTranslator(SANDBOX)
    expect(lastToolCall(t.handleSessionUpdate(toolCall({ toolCallId: 'a', title: '', name: 'Bash' })))?.title).toBe('Bash')
    expect(lastToolCall(t.handleSessionUpdate(toolCall({ toolCallId: 'b', title: '' })))?.title).toBe('b')
  })

  it('更新で届いたツール名は、id の仮置きだけを置き換える', () => {
    const t = new SessionTranslator(SANDBOX)
    t.handleSessionUpdate(toolCall({ toolCallId: 'a', title: '' }))
    expect(lastToolCall(t.handleSessionUpdate(toolCallUpdate({ toolCallId: 'a', name: 'Read' })))?.title).toBe('Read')
    t.handleSessionUpdate(toolCall({ toolCallId: 'b', title: 'Read a.ts' }))
    expect(lastToolCall(t.handleSessionUpdate(toolCallUpdate({ toolCallId: 'b', name: 'Read' })))?.title).toBe('Read a.ts')
  })
})

describe('SessionTranslator: その他', () => {
  it('plan はチェックボックス付きの PLAN ブロックにする', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = t.handleSessionUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: '調査', status: 'completed', priority: 'high' },
        { content: '実装', status: 'pending', priority: 'medium' }
      ]
    })
    expect(events).toEqual([
      { type: 'block', id: expect.any(String), role: 'PLAN', markdown: '- [x] 調査\n- [ ] 実装', streaming: false }
    ])
  })

  it('同じターンの plan は前の PLAN ブロックを置き換え、次のターンでは新しいブロックにする', () => {
    const t = new SessionTranslator(SANDBOX)
    const plan = (status: 'pending' | 'completed'): SessionUpdate => ({
      sessionUpdate: 'plan',
      entries: [{ content: '調査', status, priority: 'high' }]
    })
    const first = run(t, [plan('pending'), agent('途中'), plan('completed')])
    expect(finalBlocks(first)).toEqual([
      { role: 'PLAN', markdown: '- [x] 調査' },
      { role: 'AGENT', markdown: '途中' }
    ])
    const second = run(t, [plan('pending')])
    expect(second[0]).toMatchObject({ type: 'block', role: 'PLAN' })
    expect(second[0]).not.toMatchObject({ id: (first[0] as { id: string }).id })
  })

  it('replay では、ユーザーの発言をターンの区切りとして plan を新しいブロックにする', () => {
    const t = new SessionTranslator(SANDBOX)
    t.setReplayMode(true)
    const plan: SessionUpdate = { sessionUpdate: 'plan', entries: [{ content: 'A', status: 'pending', priority: 'low' }] }
    const events = run(t, [user({ type: 'text', text: '1' }, 'u1'), plan, user({ type: 'text', text: '2' }, 'u2'), plan])
    expect(finalBlocks(events).map((b) => b.role)).toEqual(['USER', 'PLAN', 'USER', 'PLAN'])
  })

  it('空の plan は、まだ PLAN ブロックが無ければ何も描かない', () => {
    const t = new SessionTranslator(SANDBOX)
    expect(t.handleSessionUpdate({ sessionUpdate: 'plan', entries: [] })).toEqual([])
  })

  it('notice は agentNotice にする', () => {
    const t = new SessionTranslator(SANDBOX)
    expect(
      t.handleSessionUpdate({ sessionUpdate: 'notice', severity: 'warning', title: '上限が近い', description: '残り 10%' })
    ).toEqual([{ type: 'agentNotice', id: expect.any(String), severity: 'warning', title: '上限が近い', description: '残り 10%' }])
  })

  it('compaction は compactionId ごとに1エントリで、同じ id への更新は同じ id で送る', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = [
      ...t.handleSessionUpdate({ sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'in_progress' }),
      ...t.handleSessionUpdate({ sessionUpdate: 'compaction_summary_chunk', compactionId: 'c1', content: { type: 'text', text: '要約' } }),
      ...t.handleSessionUpdate({ sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'completed' })
    ]
    const compactions = events.filter((e) => e.type === 'compaction')
    expect(new Set(compactions.map((e) => e.id)).size).toBe(1)
    expect(compactions.at(-1)).toMatchObject({ summary: '要約', state: { status: 'completed' } })
  })

  it('compaction の summary は null で消え、error は値で置き換わる', () => {
    const t = new SessionTranslator(SANDBOX)
    t.handleSessionUpdate({
      sessionUpdate: 'compaction_update',
      compactionId: 'c1',
      status: 'in_progress',
      summary: [{ type: 'text', text: 'x' }]
    })
    const [event] = t.handleSessionUpdate({
      sessionUpdate: 'compaction_update',
      compactionId: 'c1',
      status: 'failed',
      summary: null,
      error: '失敗'
    })
    expect(event).toMatchObject({ type: 'compaction', summary: '', state: { status: 'failed', error: '失敗' } })
  })

  it('ターンが終わっても in_progress の compaction は cancelled にする', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = run(t, [{ sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'in_progress' }])
    expect(events.at(-1)).toMatchObject({ type: 'compaction', state: { status: 'cancelled' } })
  })

  it('compaction は開いている返信を閉じ、その後の返信を別のブロックにする', () => {
    const t = new SessionTranslator(SANDBOX)
    const events = run(t, [
      agent('前', 'm1'),
      { sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'completed' },
      agent('後', 'm1')
    ])
    expect(events.map((e) => e.type)).toContain('compaction')
    expect(finalBlocks(events)).toEqual([
      { role: 'AGENT', markdown: '前' },
      { role: 'AGENT', markdown: '後' }
    ])
  })

  it('メタ情報の更新はトランスクリプトに流さない', () => {
    const t = new SessionTranslator(SANDBOX)
    expect(t.handleSessionUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })).toEqual([])
  })

  it('未知のバリアントは無視する', () => {
    const t = new SessionTranslator(SANDBOX)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(t.handleSessionUpdate({ sessionUpdate: 'something_new' } as unknown as SessionUpdate)).toEqual([])
    warn.mockRestore()
  })
})

describe('askQuestions / ツールコールの ask', () => {
  const input = {
    questions: [
      {
        header: 'DB',
        question: 'どれを使う？',
        multiSelect: false,
        options: [{ label: 'PostgreSQL', description: '実績', preview: 'CREATE TABLE t ();' }, { label: '' }, 'x']
      },
      { question: '機能は？', multiSelect: true, options: [{ label: '認証' }] },
      { question: '選択肢なし', options: [] },
      { options: [{ label: 'no question' }] }
    ]
  }

  it('AskUserQuestion の形の入力から質問を取り出し、壊れた質問・選択肢は飛ばす', () => {
    expect(askQuestions(input)).toEqual([
      {
        header: 'DB',
        question: 'どれを使う？',
        multiSelect: false,
        options: [{ label: 'PostgreSQL', description: '実績', preview: 'CREATE TABLE t ();' }]
      },
      { header: undefined, question: '機能は？', multiSelect: true, options: [{ label: '認証', description: undefined, preview: undefined }] }
    ])
    expect(askQuestions({ questions: [] })).toBeUndefined()
    expect(askQuestions({ command: 'ls' })).toBeUndefined()
    expect(askQuestions(undefined)).toBeUndefined()
  })

  function lastToolCall(events: TranscriptEvent[]) {
    return events.filter((e): e is Extract<TranscriptEvent, { type: 'toolCall' }> => e.type === 'toolCall').pop()!.toolCall
  }

  it('kind が other のツールコールにだけ ask を付け、後から届いた入力でも付ける', () => {
    const translator = new SessionTranslator(SANDBOX)
    let events = translator.handleSessionUpdate(toolCall({ toolCallId: 'a', title: 'Ask', kind: 'other', status: 'pending' }))
    expect(lastToolCall(events).ask).toBeUndefined()
    events = translator.handleSessionUpdate(toolCallUpdate({ toolCallId: 'a', rawInput: input }))
    expect(lastToolCall(events).ask).toHaveLength(2)
    events = translator.handleSessionUpdate(toolCallUpdate({ toolCallId: 'a', status: 'completed' }))
    expect(lastToolCall(events).ask).toHaveLength(2)

    events = translator.handleSessionUpdate(toolCall({ toolCallId: 'b', title: 'Run', kind: 'execute', rawInput: input }))
    expect(lastToolCall(events).ask).toBeUndefined()
  })
})

describe('permissionRequestToEvent', () => {
  function request(toolCall: Record<string, unknown>): RequestPermissionRequest {
    return {
      sessionId: 's',
      toolCall: { toolCallId: 'tc', ...toolCall },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
      ]
    }
  }

  it('コマンド実行は本文にコマンドをコードブロックで出す', () => {
    const event = permissionRequestToEvent('p1', request({ title: 'Run', kind: 'execute', rawInput: { command: 'ls -la' } }))
    expect(event).toMatchObject({
      type: 'permission',
      id: 'p1',
      toolCallId: 'tc',
      headline: 'Run',
      bodyMarkdown: '```\nls -la\n```',
      flat: true,
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
      ]
    })
  })

  it('diff があれば見出しに行数の増減を付ける', () => {
    const event = permissionRequestToEvent(
      'p2',
      request({ title: 'Edit a.ts', kind: 'edit', content: [{ type: 'diff', path: 'a.ts', oldText: 'a', newText: 'a\nb' }] })
    )
    expect(event).toMatchObject({ headline: 'Edit a.ts (+1 -0)' })
  })

  it('switch_mode は flat にしない', () => {
    expect(permissionRequestToEvent('p3', request({ kind: 'switch_mode' }))).toMatchObject({ flat: false })
  })
})

describe('closeOpenBlocks', () => {
  it('finalizes an answer streamed after the turn ended, without a stop reason', () => {
    const translator = new SessionTranslator(SANDBOX)
    translator.handleStop('end_turn')
    translator.handleSessionUpdate(agent('**後から**の', 'm1'))
    translator.handleSessionUpdate(agent('回答', 'm1'))
    const closing = translator.closeOpenBlocks()
    expect(closing).toEqual([
      expect.objectContaining({ type: 'blockMarkdown', markdown: '**後から**の回答', messageId: 'm1' })
    ])
    expect(translator.closeOpenBlocks()).toEqual([])
  })

  it('finalizes an open thought', () => {
    const translator = new SessionTranslator(SANDBOX)
    translator.handleSessionUpdate(thought('考え中'))
    expect(translator.closeOpenBlocks()).toEqual([expect.objectContaining({ type: 'blockMarkdown', markdown: '考え中' })])
  })

  it('closes an open tool call group', () => {
    const translator = new SessionTranslator(SANDBOX)
    translator.handleSessionUpdate(toolCall({ toolCallId: 't1', title: 'Run', kind: 'execute', status: 'completed' }))
    expect(translator.closeOpenBlocks()).toEqual([expect.objectContaining({ type: 'group', closed: true })])
  })
})

describe('settleOpenBlocks', () => {
  it('renders the answer so far and keeps adding to the same block, even inside a code fence', () => {
    const translator = new SessionTranslator(SANDBOX)
    translator.handleStop('end_turn')
    const first = translator.handleSessionUpdate(agent('説明\n\n```ts\nconst a = 1\n', 'm1'))
    const blockId = (first.find((e) => e.type === 'block') as { id: string }).id
    expect(translator.settleOpenBlocks()).toEqual([
      expect.objectContaining({ type: 'blockMarkdown', id: blockId, markdown: '説明\n\n```ts\nconst a = 1\n' })
    ])
    const more = translator.handleSessionUpdate(agent('```\n\n続き', 'm1'))
    expect(more.filter((e) => e.type === 'block')).toEqual([])
    expect(more[0]).toEqual({ type: 'blockReopen', id: blockId })
    expect(translator.settleOpenBlocks()).toEqual([
      expect.objectContaining({ type: 'blockMarkdown', id: blockId, markdown: '説明\n\n```ts\nconst a = 1\n```\n\n続き' })
    ])
  })

  it('does not render again or reopen without new text', () => {
    const translator = new SessionTranslator(SANDBOX)
    translator.handleSessionUpdate(agent('回答', 'm1'))
    translator.settleOpenBlocks()
    expect(translator.settleOpenBlocks()).toEqual([])
    expect(translator.closeOpenBlocks()).toEqual([])
  })

  it('starts a new block for a different message as usual', () => {
    const translator = new SessionTranslator(SANDBOX)
    translator.handleSessionUpdate(agent('一つ目', 'm1'))
    translator.settleOpenBlocks()
    const next = translator.handleSessionUpdate(agent('二つ目', 'm2'))
    expect(next.map((e) => e.type)).toEqual(['block', 'stream'])
  })

  it('keeps a settled thought open for its continuation', () => {
    const translator = new SessionTranslator(SANDBOX)
    translator.handleSessionUpdate(thought('考え', 't1'))
    translator.settleOpenBlocks()
    const more = translator.handleSessionUpdate(thought('の続き', 't1'))
    expect(more.map((e) => e.type)).toEqual(['blockReopen', 'stream'])
    expect(translator.closeOpenBlocks()).toEqual([expect.objectContaining({ type: 'blockMarkdown', markdown: '考えの続き' })])
  })
})
