import { randomUUID } from 'node:crypto'
import type {
  ContentBlock,
  Diff,
  Plan,
  RequestPermissionRequest,
  SessionUpdate,
  StopReason,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
  ToolKind
} from '@agentclientprotocol/sdk'
import type {
  AttachmentChip,
  PermissionOption,
  ToolCallKind,
  ToolCallPayload,
  ToolCallStatus,
  TranscriptEvent
} from '@shared/types/transcript'

/**
 * ACP の `session/update` / `session/request_permission` を
 * `TranscriptEvent` へ翻訳する。decisions.md N-1 「ACP → イベントへの変換ロジックは
 * 仕様として継承し、TypeScript で再実装する」。
 *
 * 1つの `SessionTranslator` が1タブ（1 ACP セッション）に対応する。
 * ブロックの id・グループの開閉など、ターンをまたぐ状態をここで保持する。
 */
interface OpenBlock {
  id: string
  messageId: string | null
  buffer: string
}

interface OpenUserBlock extends OpenBlock {
  /** replay で拾い直した添付チップ（`attachments` イベントは置き換えなので累積して送る）。 */
  chips: AttachmentChip[]
}

export class SessionTranslator {
  private currentAgent: OpenBlock | null = null
  private currentThought: OpenBlock | null = null
  private currentUser: OpenUserBlock | null = null
  private openGroupId: string | null = null
  private replaying = false
  /** これまでに描いたツールコール。`tool_call_update` を前回の値に重ねるのに使う。 */
  private readonly toolCalls = new Map<string, ToolCallPayload>()

  /**
   * @param sandboxPath replay された添付の `file://` URI をプロジェクト相対パスの
   *   チップへ戻すのに使う（`prompt()` が送る URI の逆変換）。
   */
  constructor(private readonly sandboxPath: string) {}

  /**
   * `session/load` は過去の会話を `session/update` として流し直す
   * （decisions.md C-1/C-2）。replay 中だけ `user_message_chunk` を
   * 描画対象にする: ライブのターンでは `userPrompt()` が既にユーザーの
   * 発言を描いており、エージェントがそれをエコーし返した場合に二重に
   * なってしまうため。
   */
  setReplayMode(on: boolean): void {
    this.replaying = on
  }

  /**
   * ユーザーが送信したプロンプトを、エージェントの返信を待たずにその場で
   * 描画する。ui.md §7: 添付は USER ブロックにチップとして可視化する
   * （内容は運ばず、パスのみ）。
   */
  userPrompt(text: string, attachments: AttachmentChip[] = []): TranscriptEvent[] {
    const events = [...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeThought(), ...this.finalizeUser()]
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
      case 'available_commands_update':
      case 'current_mode_update':
      case 'config_option_update':
      case 'session_info_update':
      case 'usage_update':
      case 'plan_update':
      case 'plan_removed':
      case 'compaction_update':
      case 'compaction_summary_chunk':
        // これらはセッションのメタ状態（モード・configOptions・使用量など）
        // であり、main 側の SessionRuntime が別途キャッシュを更新する。
        // トランスクリプト本文には流さない。
        return []
      default:
        // 未知のバリアントはログに残して無視する（architecture.md §3）。
        console.warn('[acp] unknown session/update variant', (update as { sessionUpdate?: string }).sessionUpdate)
        return []
    }
  }

  handleStop(_stopReason: StopReason): TranscriptEvent[] {
    return [...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeThought(), ...this.finalizeUser()]
  }

  reset(): TranscriptEvent[] {
    this.currentAgent = null
    this.currentThought = null
    this.currentUser = null
    this.openGroupId = null
    this.toolCalls.clear()
    return []
  }

  /**
   * ストリーミング中はプレーンテキストで表示し、ブロック確定後に Markdown
   * で描画し直す（decisions.md N-1「必ず継承する挙動」）。`blockMarkdown` が
   * その確定タイミングを運ぶ。
   */
  private finalizeAgent(): TranscriptEvent[] {
    if (!this.currentAgent) return []
    const { id, buffer, messageId } = this.currentAgent
    this.currentAgent = null
    return [
      {
        type: 'blockMarkdown',
        id,
        markdown: buffer,
        choices: extractChoices(id, buffer),
        messageId: messageId ?? undefined
      }
    ]
  }

  private finalizeThought(): TranscriptEvent[] {
    if (!this.currentThought) return []
    const { id, buffer } = this.currentThought
    this.currentThought = null
    return [{ type: 'blockMarkdown', id, markdown: buffer }]
  }

  private finalizeUser(): TranscriptEvent[] {
    if (!this.currentUser) return []
    const { id, buffer } = this.currentUser
    this.currentUser = null
    return [{ type: 'blockMarkdown', id, markdown: buffer }]
  }

  /**
   * replay（session/load）中のユーザー発言。添付は `resource_link` のまま返って
   * くるとは限らず、claude-agent-acp は `[@name](file://…)` という Markdown の
   * メンションに変換したテキストとして流し直す。どちらもライブ送信時と同じ
   * チップに戻し、本文からは取り除く（リンク文字列がそのまま USER ブロックに
   * 出ないように）。プロジェクト外を指すものはチップにできないので本文に残す。
   */
  private appendUserChunk(content: ContentBlock, messageId: string | null): TranscriptEvent[] {
    const { text, chips } = this.extractUserAttachments(content)
    const events: TranscriptEvent[] = []
    if (!this.currentUser || messageId !== this.currentUser.messageId) {
      events.push(...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeThought(), ...this.finalizeUser())
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

  private appendAgentChunk(content: ContentBlock, messageId: string | null): TranscriptEvent[] {
    const text = contentBlockToText(content)
    const events: TranscriptEvent[] = []
    if (!this.currentAgent || messageId !== this.currentAgent.messageId) {
      events.push(...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeUser())
      const id = randomUUID()
      this.currentAgent = { id, messageId, buffer: '' }
      events.push({ type: 'block', id, role: 'AGENT', markdown: '', streaming: true })
    }
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
    this.currentThought.buffer += text
    events.push({ type: 'stream', id: this.currentThought.id, text })
    return events
  }

  private upsertToolCall(payload: ToolCall | ToolCallUpdate): TranscriptEvent[] {
    const events: TranscriptEvent[] = []
    const previous = this.toolCalls.get(payload.toolCallId)
    // 既知のツールコールの更新は、元のグループのまま差し替える（グループが
    // 閉じた後に届いた更新で、同じ行が新しいグループに重複して出ないように）。
    if (!previous && this.openGroupId === null) {
      this.openGroupId = randomUUID()
      events.push({ type: 'group', id: this.openGroupId, timed: true, closed: false })
    }
    const groupId = previous?.groupId ?? this.openGroupId!
    const toolCall = previous ? mergeToolCallUpdate(previous, payload) : toolCallPayload(payload, groupId)
    this.toolCalls.set(payload.toolCallId, toolCall)
    events.push({ type: 'toolCall', toolCall })
    return events
  }

  private renderPlan(plan: Plan): TranscriptEvent[] {
    const lines = plan.entries.map((entry) => {
      const box = entry.status === 'completed' ? '[x]' : '[ ]'
      return `- ${box} ${entry.content}`
    })
    return [
      {
        type: 'block',
        id: randomUUID(),
        role: 'PLAN',
        markdown: lines.join('\n'),
        streaming: false
      }
    ]
  }

  private closeOpenGroup(): TranscriptEvent[] {
    if (this.openGroupId === null) return []
    const id = this.openGroupId
    this.openGroupId = null
    return [{ type: 'group', id, timed: true, closed: true }]
  }
}

/** claude-agent-acp が `resource_link` を変換したメンション（`[@foo.md](file:///…)`）。 */
const ATTACHMENT_MENTION = /\[@[^\]]*\]\((file:\/\/[^)]*)\)/g

const TASK_LIST_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/

/**
 * reference/Specification.md「Markdown task lists in agent responses are
 * treated as interactive choices」の実装: 確定したエージェントの返信に
 * `- [ ] 選択肢` 形式の行があれば `choices` として抜き出す。原文の Markdown
 * 自体は変更しない（チェックボックス表示は renderer 側の役割）。
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
      return '\n\n*[image]*\n\n'
    case 'audio':
      return '\n\n*[audio]*\n\n'
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
  // ui.md §5「その他 → 標準の折り畳みアンカー」「search → ヒット一覧は展開部に」
  // 「fetch → 取得内容のみ末尾のキャレットで展開」。ACP はこれらを diff とは別の
  // `type: "content"` ブロックとして運んでくるので、結合してそのまま展開領域に流す。
  const textParts = (payload.content ?? [])
    .filter((c): c is ToolCallContent & { type: 'content' } => c.type === 'content')
    .map((c) => contentBlockToText(c.content))
  const content = textParts.length > 0 ? textParts.join('\n') : undefined
  return {
    id: payload.toolCallId,
    groupId,
    kind: payload.kind ? TOOL_KIND_MAP[payload.kind] : 'other',
    title: 'title' in payload && payload.title ? payload.title : payload.toolCallId,
    status: (payload.status as ToolCallStatus | undefined) ?? 'pending',
    locations: (payload.locations ?? []).map((l) => ({ path: l.path, line: l.line ?? undefined })),
    diffs,
    rawInput: payload.rawInput,
    content
  }
}

/**
 * ACP の `tool_call_update` は「変わったフィールドだけ」を送ってくる。丸ごと
 * 置き換えると、status だけの更新で kind が other に、タイトルが id に戻って
 * しまうため、送られてきたフィールドだけを前回の値に重ねる。
 */
function mergeToolCallUpdate(previous: ToolCallPayload, payload: ToolCall | ToolCallUpdate): ToolCallPayload {
  const fresh = toolCallPayload(payload, previous.groupId)
  return {
    ...previous,
    kind: payload.kind ? fresh.kind : previous.kind,
    title: 'title' in payload && payload.title ? fresh.title : previous.title,
    status: payload.status ? fresh.status : previous.status,
    locations: payload.locations ? fresh.locations : previous.locations,
    diffs: payload.content ? fresh.diffs : previous.diffs,
    content: payload.content ? fresh.content : previous.content,
    rawInput: payload.rawInput !== undefined ? fresh.rawInput : previous.rawInput
  }
}

function diffToPayload(diff: Diff): ToolCallPayload['diffs'][number] {
  const oldLines = diff.oldText ? diff.oldText.split('\n').length : 0
  const newLines = diff.newText.split('\n').length
  return {
    path: diff.path,
    oldText: diff.oldText ?? undefined,
    newText: diff.newText,
    added: diff.oldText === undefined || diff.oldText === null ? newLines : Math.max(0, newLines - oldLines),
    removed: diff.oldText === undefined || diff.oldText === null ? 0 : Math.max(0, oldLines - newLines)
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
  const title = toolCall.title ?? toolCall.toolCallId
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
