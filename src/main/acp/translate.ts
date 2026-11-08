import { randomUUID } from 'node:crypto'
import type {
  CompactionSummaryChunk,
  CompactionUpdate,
  ContentBlock,
  Diff,
  Notice,
  Plan,
  RequestPermissionRequest,
  SessionUpdate,
  StopReason,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
  ToolKind
} from '@agentclientprotocol/sdk'
import type { CompactionState } from '@shared/types/session'
import type {
  AskQuestion,
  AttachmentChip,
  PermissionOption,
  ToolCallKind,
  ToolCallPayload,
  ToolCallStatus,
  TranscriptEvent,
  TranscriptImage
} from '@shared/types/transcript'
import { diffRowsFromTexts } from '@shared/diff'
import { toTranscriptImage } from './images'

/**
 * ACP の `session/update` / `session/request_permission` を `TranscriptEvent` へ翻訳する。
 * 1つの `SessionTranslator` が1タブ（1 ACP セッション）に対応し、ブロックの id・グループの
 * 開閉など、ターンをまたぐ状態を保持する。
 */
interface OpenBlock {
  id: string
  messageId: string | null
  buffer: string
  /** `settleOpenBlocks()` で Markdown として描き、その後に追記が無い。 */
  settled?: boolean
}

/** 描画中のコンテキスト圧縮1件（ACP の `compactionId` ごと）。 */
interface CompactionEntry {
  id: string
  summary: string
  state: CompactionState
}

interface OpenAgentBlock extends OpenBlock {
  /** この返信に含まれていた画像（`images` イベントは置き換えなので累積して送る）。 */
  images: TranscriptImage[]
}

interface OpenUserBlock extends OpenBlock {
  /** replay で拾い直した添付チップ（`attachments` イベントは置き換えなので累積して送る）。 */
  chips: AttachmentChip[]
}

export class SessionTranslator {
  private currentAgent: OpenAgentBlock | null = null
  private currentThought: OpenBlock | null = null
  private currentUser: OpenUserBlock | null = null
  private openGroupId: string | null = null
  private replaying = false
  /** これまでに描いたツールコール。`tool_call_update` を前回の値に重ねるのに使う。 */
  private readonly toolCalls = new Map<string, ToolCallPayload>()
  /** このターンの PLAN ブロックの id。次の `plan` はこのブロックを置き換える。 */
  private currentPlanId: string | null = null
  /** ACP の `compactionId` → 描画中の圧縮。 */
  private readonly compactions = new Map<string, CompactionEntry>()

  /**
   * @param sandboxPath replay された添付の `file://` URI をプロジェクト相対パスの
   *   チップへ戻すのに使う（`prompt()` が送る URI の逆変換）。
   */
  constructor(private readonly sandboxPath: string) {}

  /** replay 中だけ `user_message_chunk` を USER ブロックとして描画する。 */
  setReplayMode(on: boolean): void {
    this.replaying = on
  }

  /**
   * ユーザーが送信したプロンプトを、エージェントの返信を待たずに描画する。
   * 添付は USER ブロックにチップとして載せる。
   */
  userPrompt(text: string, attachments: AttachmentChip[] = []): TranscriptEvent[] {
    const events = [...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeThought(), ...this.finalizeUser()]
    this.currentPlanId = null
    const id = randomUUID()
    events.push({
      type: 'block',
      id,
      role: 'USER',
      markdown: text,
      streaming: false
    })
    if (attachments.length > 0) {
      events.push({ type: 'attachments', id, chips: attachments })
    }
    return events
  }

  handleSessionUpdate(update: SessionUpdate): TranscriptEvent[] {
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        // ライブなターンでは userPrompt() が既に描画済みなので捨てる。
        // replay 中（session/load）だけ USER ブロックとして描き直す。
        if (!this.replaying) return []
        return this.appendUserChunk(update.content, update.messageId ?? null)
      case 'agent_message_chunk':
        return this.appendAgentChunk(update.content, update.messageId ?? null)
      case 'agent_thought_chunk':
        return this.appendThoughtChunk(update.content, update.messageId ?? null)
      case 'tool_call':
        return this.upsertToolCall(update)
      case 'tool_call_update':
        return this.upsertToolCall(update)
      case 'plan':
        return this.renderPlan(update)
      case 'notice':
        return this.renderNotice(update)
      case 'compaction_update':
        return this.updateCompaction(update)
      case 'compaction_summary_chunk':
        return this.appendCompactionSummary(update)
      case 'available_commands_update':
      case 'current_mode_update':
      case 'config_option_update':
      case 'session_info_update':
      case 'usage_update':
        // メタ状態（モード・configOptions・使用量など）はトランスクリプトには流さない。
        return []
      default:
        // 未知のバリアントはログに残して無視する。
        console.warn('[acp] unknown session/update variant', (update as { sessionUpdate?: string }).sessionUpdate)
        return []
    }
  }

  /** ターンを閉じる。`end_turn` 以外で終わったときは、その理由を末尾に1行足す。 */
  handleStop(stopReason: StopReason): TranscriptEvent[] {
    this.currentPlanId = null
    const events = [
      ...this.closeOpenGroup(),
      ...this.finalizeAgent(),
      ...this.finalizeThought(),
      ...this.finalizeUser(),
      ...this.cancelUnfinishedCompactions()
    ]
    if (stopReason !== 'end_turn') events.push({ type: 'stopReason', id: randomUUID(), reason: stopReason })
    return events
  }

  /** 開いているブロックとツールコールのグループを、ターンを閉じずに確定する。 */
  closeOpenBlocks(): TranscriptEvent[] {
    return [...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeThought(), ...this.finalizeUser()]
  }

  /**
   * 開いている返信と思考ログを、ブロックを閉じずにここまでの全文で Markdown として描く。続きのチャンクは
   * 同じブロックに足す（`blockReopen` を出してから追記する）。ツールコールのグループは閉じる。
   */
  settleOpenBlocks(): TranscriptEvent[] {
    const events = this.closeOpenGroup()
    for (const block of [this.currentAgent, this.currentThought]) {
      if (!block || block.settled) continue
      block.settled = true
      events.push(block === this.currentAgent ? this.agentMarkdownEvent(this.currentAgent) : { type: 'blockMarkdown', id: block.id, markdown: block.buffer })
    }
    return events
  }

  /** `settleOpenBlocks()` で描いたブロックに続きを足す前の `blockReopen`。 */
  private reopenIfSettled(block: OpenBlock): TranscriptEvent[] {
    if (!block.settled) return []
    block.settled = false
    return [{ type: 'blockReopen', id: block.id }]
  }

  private agentMarkdownEvent(block: OpenAgentBlock): TranscriptEvent {
    return {
      type: 'blockMarkdown',
      id: block.id,
      markdown: block.buffer,
      choices: extractChoices(block.id, block.buffer),
      messageId: block.messageId ?? undefined
    }
  }

  reset(): TranscriptEvent[] {
    this.currentAgent = null
    this.currentThought = null
    this.currentUser = null
    this.openGroupId = null
    this.toolCalls.clear()
    this.currentPlanId = null
    this.compactions.clear()
    return []
  }

  /**
   * ストリーミング中はプレーンテキストで表示し、ブロック確定時に `blockMarkdown` で
   * Markdown として描き直す。
   */
  private finalizeAgent(): TranscriptEvent[] {
    const block = this.currentAgent
    if (!block) return []
    this.currentAgent = null
    return block.settled ? [] : [this.agentMarkdownEvent(block)]
  }

  private finalizeThought(): TranscriptEvent[] {
    const block = this.currentThought
    if (!block) return []
    this.currentThought = null
    return block.settled ? [] : [{ type: 'blockMarkdown', id: block.id, markdown: block.buffer }]
  }

  private finalizeUser(): TranscriptEvent[] {
    if (!this.currentUser) return []
    const { id, buffer } = this.currentUser
    this.currentUser = null
    return [{ type: 'blockMarkdown', id, markdown: buffer }]
  }

  /**
   * replay 中のユーザー発言。`resource_link` と `[@name](file://…)` 形式のメンションを
   * 添付チップに戻して本文から取り除く。プロジェクト外を指すものは本文に残す。
   */
  private appendUserChunk(content: ContentBlock, messageId: string | null): TranscriptEvent[] {
    const { text, chips } = this.extractUserAttachments(content)
    const events: TranscriptEvent[] = []
    if (!this.currentUser || messageId !== this.currentUser.messageId) {
      events.push(...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeThought(), ...this.finalizeUser())
      // replay にはターンの区切り（stop）が無いので、ユーザーの発言をターンの始まりとみなす。
      this.currentPlanId = null
      const id = randomUUID()
      this.currentUser = { id, messageId, buffer: '', chips: [] }
      events.push({ type: 'block', id, role: 'USER', markdown: '', streaming: true })
    }
    const fresh = chips.filter((chip) => !this.currentUser!.chips.some((c) => c.key === chip.key))
    if (fresh.length > 0) {
      this.currentUser.chips = [...this.currentUser.chips, ...fresh]
      events.push({ type: 'attachments', id: this.currentUser.id, chips: this.currentUser.chips })
    }
    if (text) {
      this.currentUser.buffer += text
      events.push({ type: 'stream', id: this.currentUser.id, text })
    }
    return events
  }

  private extractUserAttachments(content: ContentBlock): { text: string; chips: AttachmentChip[] } {
    if (content.type === 'resource_link' || content.type === 'resource') {
      const uri = content.type === 'resource_link' ? content.uri : content.resource.uri
      const chip = this.chipFromUri(uri)
      return chip ? { text: '', chips: [chip] } : { text: contentBlockToText(content), chips: [] }
    }
    if (content.type !== 'text') return { text: contentBlockToText(content), chips: [] }
    const chips: AttachmentChip[] = []
    const text = content.text.replace(ATTACHMENT_MENTION, (mention, uri: string) => {
      const chip = this.chipFromUri(uri)
      if (!chip) return mention
      chips.push(chip)
      return ''
    })
    return { text, chips }
  }

  /** `prompt()` が組み立てる `file://{sandboxPath}/{relPath}` の逆変換。 */
  private chipFromUri(uri: string): AttachmentChip | null {
    if (!uri.startsWith('file://')) return null
    const absPath = uri.slice('file://'.length)
    const root = this.sandboxPath.endsWith('/') ? this.sandboxPath : `${this.sandboxPath}/`
    if (!absPath.startsWith(root)) return null
    const relPath = absPath.slice(root.length)
    if (!relPath) return null
    return { key: relPath, label: relPath.split('/').pop() ?? relPath, path: relPath }
  }

  /** 画像は本文に混ぜず、ブロックの画像として積む。 */
  private appendAgentChunk(content: ContentBlock, messageId: string | null): TranscriptEvent[] {
    const events: TranscriptEvent[] = []
    if (!this.currentAgent || messageId !== this.currentAgent.messageId) {
      events.push(...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeUser())
      const id = randomUUID()
      this.currentAgent = { id, messageId, buffer: '', images: [] }
      events.push({ type: 'block', id, role: 'AGENT', markdown: '', streaming: true })
    }
    events.push(...this.reopenIfSettled(this.currentAgent))
    if (content.type === 'image') {
      this.currentAgent.images = [...this.currentAgent.images, toTranscriptImage(content.data, content.mimeType)]
      events.push({ type: 'images', id: this.currentAgent.id, images: this.currentAgent.images })
      return events
    }
    const text = contentBlockToText(content)
    this.currentAgent.buffer += text
    events.push({ type: 'stream', id: this.currentAgent.id, text })
    return events
  }

  private appendThoughtChunk(content: ContentBlock, messageId: string | null): TranscriptEvent[] {
    const text = contentBlockToText(content)
    const events: TranscriptEvent[] = []
    if (!this.currentThought || messageId !== this.currentThought.messageId) {
      events.push(...this.finalizeThought(), ...this.finalizeUser())
      const id = randomUUID()
      this.currentThought = { id, messageId, buffer: '' }
      events.push({ type: 'block', id, role: 'THOUGHT', markdown: '', streaming: true })
    }
    events.push(...this.reopenIfSettled(this.currentThought))
    this.currentThought.buffer += text
    events.push({ type: 'stream', id: this.currentThought.id, text })
    return events
  }

  private upsertToolCall(payload: ToolCall | ToolCallUpdate): TranscriptEvent[] {
    const events: TranscriptEvent[] = []
    const previous = this.toolCalls.get(payload.toolCallId)
    // 既知のツールコールの更新は、元のグループのまま差し替える。
    if (!previous && this.openGroupId === null) {
      events.push(...this.finalizeAgent())
      this.openGroupId = randomUUID()
      events.push({ type: 'group', id: this.openGroupId, timed: true, closed: false })
    }
    const groupId = previous?.groupId ?? this.openGroupId!
    const toolCall = previous ? mergeToolCallUpdate(previous, payload) : toolCallPayload(payload, groupId)
    this.toolCalls.set(payload.toolCallId, toolCall)
    events.push({ type: 'toolCall', toolCall })
    return events
  }

  /**
   * `plan` は毎回計画の全体を運ぶ。同じターンの PLAN ブロックがあればその場で置き換え、
   * 無ければ新しいブロックを足す。
   */
  private renderPlan(plan: Plan): TranscriptEvent[] {
    const markdown = plan.entries
      .map((entry) => `- ${entry.status === 'completed' ? '[x]' : '[ ]'} ${entry.content}`)
      .join('\n')
    if (this.currentPlanId !== null) return [{ type: 'blockMarkdown', id: this.currentPlanId, markdown }]
    if (plan.entries.length === 0) return []
    const id = randomUUID()
    this.currentPlanId = id
    return [{ type: 'block', id, role: 'PLAN', markdown, streaming: false }]
  }

  private renderNotice(notice: Notice): TranscriptEvent[] {
    return [
      {
        type: 'agentNotice',
        id: randomUUID(),
        severity: notice.severity,
        title: notice.title,
        description: notice.description ?? undefined
      }
    ]
  }

  /**
   * 初めての `compactionId` なら、その位置に圧縮のエントリを作る（開いているブロックとグループは閉じる）。
   * 既知の id なら、その場で中身を差し替える。
   */
  private openCompaction(compactionId: string): { entry: CompactionEntry; events: TranscriptEvent[] } {
    const existing = this.compactions.get(compactionId)
    if (existing) return { entry: existing, events: [] }
    const events = [...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeThought()]
    const entry: CompactionEntry = { id: randomUUID(), summary: '', state: { status: 'in_progress' } }
    this.compactions.set(compactionId, entry)
    return { entry, events }
  }

  /** `summary` と `error` は、省略なら据え置き、null なら消去、値があれば置き換え。 */
  private updateCompaction(update: CompactionUpdate): TranscriptEvent[] {
    const { entry, events } = this.openCompaction(update.compactionId)
    entry.state = { ...entry.state, status: update.status }
    if (update.summary !== undefined) entry.summary = (update.summary ?? []).map(contentBlockToText).join('')
    if (update.error !== undefined) entry.state = { status: entry.state.status, ...(update.error ? { error: update.error } : {}) }
    events.push(compactionEvent(entry))
    return events
  }

  private appendCompactionSummary(chunk: CompactionSummaryChunk): TranscriptEvent[] {
    const { entry, events } = this.openCompaction(chunk.compactionId)
    entry.summary += contentBlockToText(chunk.content)
    events.push(compactionEvent(entry))
    return events
  }

  /** ターンが終わっても `in_progress` のままの圧縮は中止扱いにする。 */
  private cancelUnfinishedCompactions(): TranscriptEvent[] {
    const events: TranscriptEvent[] = []
    for (const entry of this.compactions.values()) {
      if (entry.state.status !== 'in_progress') continue
      entry.state = { ...entry.state, status: 'cancelled' }
      events.push(compactionEvent(entry))
    }
    return events
  }

  private closeOpenGroup(): TranscriptEvent[] {
    if (this.openGroupId === null) return []
    const id = this.openGroupId
    this.openGroupId = null
    return [{ type: 'group', id, timed: true, closed: true }]
  }
}

function compactionEvent(entry: CompactionEntry): TranscriptEvent {
  return { type: 'compaction', id: entry.id, summary: entry.summary, state: { ...entry.state } }
}

/** claude-agent-acp が `resource_link` を変換したメンション（`[@foo.md](file:///…)`）。 */
const ATTACHMENT_MENTION = /\[@[^\]]*\]\((file:\/\/[^)]*)\)/g

const TASK_LIST_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/

/**
 * 確定したエージェントの返信から `- [ ] 選択肢` 形式の行を `choices` として抜き出す。
 * 原文の Markdown は変更しない。
 */
function extractChoices(blockId: string, markdown: string): { id: string; label: string }[] | undefined {
  const choices = markdown
    .split('\n')
    .map((line) => line.match(TASK_LIST_LINE))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m, index) => ({ id: `${blockId}:${index}`, label: m[2]!.trim() }))
  return choices.length > 0 ? choices : undefined
}

function contentBlockToText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'resource_link':
      return `[${block.name}](${block.uri})`
    case 'image':
      return `\n\n*[image ${block.mimeType}]*\n\n`
    case 'audio':
      return `\n\n*[audio ${block.mimeType}]*\n\n`
    case 'resource':
      return '\n\n*[resource]*\n\n'
    default:
      return ''
  }
}

const TOOL_KIND_MAP: Record<ToolKind, ToolCallKind> = {
  read: 'read',
  edit: 'edit',
  delete: 'delete',
  move: 'move',
  search: 'search',
  execute: 'execute',
  think: 'think',
  fetch: 'fetch',
  switch_mode: 'switch_mode',
  other: 'other'
}

function toolCallPayload(payload: ToolCall | ToolCallUpdate, groupId: string): ToolCallPayload {
  const diffs = (payload.content ?? [])
    .filter((c): c is ToolCallContent & { type: 'diff' } & Diff => c.type === 'diff')
    .map((diff) => diffToPayload(diff))
  // diff 以外の `type: "content"` ブロックを結合して展開領域に流す。画像は別に取り出す。
  const contentBlocks = (payload.content ?? [])
    .filter((c): c is ToolCallContent & { type: 'content' } => c.type === 'content')
    .map((c) => c.content)
  const textParts = contentBlocks.filter((c) => c.type !== 'image').map(contentBlockToText)
  const content = textParts.length > 0 ? textParts.join('\n') : undefined
  const images = contentBlocks.flatMap((c) => (c.type === 'image' ? [toTranscriptImage(c.data, c.mimeType)] : []))
  return {
    id: payload.toolCallId,
    groupId,
    kind: payload.kind ? TOOL_KIND_MAP[payload.kind] : 'other',
    title: toolCallTitle(payload) ?? payload.toolCallId,
    status: (payload.status as ToolCallStatus | undefined) ?? 'pending',
    locations: (payload.locations ?? []).map((l) => ({ path: l.path, line: l.line ?? undefined })),
    diffs,
    rawInput: payload.rawInput,
    content,
    ...(images.length > 0 ? { images } : {}),
    ask: !payload.kind || payload.kind === 'other' ? askQuestions(payload.rawInput) : undefined
  }
}

/**
 * `AskUserQuestion` の形の入力（`questions` の各要素が `question` と、`label` を持つ `options` を持つ）
 * から質問を取り出す。名前やタイトルではなく入力の形で見分ける。文か選択肢の無い質問は飛ばし、
 * 1つも残らなければ（入力がまだ届ききっていないときも）undefined。
 */
export function askQuestions(rawInput: unknown): AskQuestion[] | undefined {
  if (!rawInput || typeof rawInput !== 'object') return undefined
  const questions = (rawInput as Record<string, unknown>).questions
  if (!Array.isArray(questions)) return undefined
  const result = questions.flatMap((item): AskQuestion[] => {
    if (!item || typeof item !== 'object') return []
    const q = item as Record<string, unknown>
    if (typeof q.question !== 'string' || q.question === '' || !Array.isArray(q.options)) return []
    const options = q.options.flatMap((option): AskQuestion['options'] => {
      if (!option || typeof option !== 'object') return []
      const o = option as Record<string, unknown>
      if (typeof o.label !== 'string' || o.label === '') return []
      return [{ label: o.label, description: nonEmpty(o.description), preview: nonEmpty(o.preview) }]
    })
    if (options.length === 0) return []
    return [{ header: nonEmpty(q.header), question: q.question, multiSelect: q.multiSelect === true, options }]
  })
  return result.length > 0 ? result : undefined
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** 表示するタイトル。`title` が無ければツール名（`name`）、どちらも無ければ undefined。 */
function toolCallTitle(payload: ToolCall | ToolCallUpdate): string | undefined {
  return payload.title || payload.name || undefined
}

/** `tool_call_update` で送られてきたフィールドだけを前回の値に重ねる。 */
function mergeToolCallUpdate(previous: ToolCallPayload, payload: ToolCall | ToolCallUpdate): ToolCallPayload {
  const fresh = toolCallPayload(payload, previous.groupId)
  const kind = payload.kind ? fresh.kind : previous.kind
  const ask = payload.rawInput !== undefined ? askQuestions(payload.rawInput) : previous.ask
  return {
    ...previous,
    kind,
    // タイトルが届かなければ前回の値を残す。ただし前回が id の仮置きなら、ツール名で置き換える。
    title: toolCallTitle(payload) && (payload.title || previous.title === previous.id) ? fresh.title : previous.title,
    status: payload.status ? fresh.status : previous.status,
    locations: payload.locations ? fresh.locations : previous.locations,
    diffs: payload.content ? fresh.diffs : previous.diffs,
    content: payload.content ? fresh.content : previous.content,
    images: payload.content ? fresh.images : previous.images,
    rawInput: payload.rawInput !== undefined ? fresh.rawInput : previous.rawInput,
    ask: kind === 'other' ? ask : undefined
  }
}

function diffToPayload(diff: Diff): ToolCallPayload['diffs'][number] {
  const rows = diffRowsFromTexts(diff.oldText ?? '', diff.newText)
  return {
    path: diff.path,
    oldText: diff.oldText ?? undefined,
    newText: diff.newText,
    added: rows.filter((row) => row.kind === 'add').length,
    removed: rows.filter((row) => row.kind === 'remove').length
  }
}

export function permissionRequestToEvent(
  permissionId: string,
  request: RequestPermissionRequest
): TranscriptEvent {
  return {
    type: 'permission',
    id: permissionId,
    toolCallId: request.toolCall.toolCallId,
    headline: permissionHeadline(request.toolCall),
    bodyMarkdown: permissionBody(request.toolCall),
    flat: request.toolCall.kind !== 'switch_mode',
    options: request.options.map(permissionOptionToPayload)
  }
}

function permissionOptionToPayload(option: {
  optionId: string
  name: string
  kind: string
}): PermissionOption {
  return {
    optionId: option.optionId,
    name: option.name,
    kind: option.kind as PermissionOption['kind']
  }
}

function permissionHeadline(toolCall: ToolCallUpdate): string {
  const title = toolCallTitle(toolCall) ?? toolCall.toolCallId
  const diffs = (toolCall.content ?? []).filter(
    (c): c is ToolCallContent & { type: 'diff' } & Diff => c.type === 'diff'
  )
  const diff = diffs[0]
  if (diff) {
    const payload = diffToPayload(diff)
    return `${title} (+${payload.added} -${payload.removed})`
  }
  return title
}

function permissionBody(toolCall: ToolCallUpdate): string {
  if (toolCall.rawInput && typeof toolCall.rawInput === 'object') {
    const rawInput = toolCall.rawInput as Record<string, unknown>
    if (typeof rawInput.command === 'string') {
      return '```\n' + rawInput.command + '\n```'
    }
  }
  return ''
}
