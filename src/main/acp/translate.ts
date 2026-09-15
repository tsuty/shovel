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

export class SessionTranslator {
  private currentAgent: OpenBlock | null = null
  private currentThought: OpenBlock | null = null
  private openGroupId: string | null = null
  private readonly toolCallGroups = new Map<string, string>()

  /** ユーザーが送信したプロンプトを、エージェントの返信を待たずにその場で描画する。 */
  userPrompt(text: string): TranscriptEvent[] {
    const events = [...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeThought()]
    events.push({
      type: 'block',
      id: randomUUID(),
      role: 'USER',
      markdown: text,
      streaming: false
    })
    return events
  }

  handleSessionUpdate(update: SessionUpdate): TranscriptEvent[] {
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        // ライブなターンでは userPrompt() が既に描画済み。session/load の
        // replay 時のみここに来る可能性があるが、現時点では表示のみに留める
        // （V-4 が解決してから replay 経路を本格実装する）。
        return []
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
    return [...this.closeOpenGroup(), ...this.finalizeAgent(), ...this.finalizeThought()]
  }

  reset(): TranscriptEvent[] {
    this.currentAgent = null
    this.currentThought = null
    this.openGroupId = null
    this.toolCallGroups.clear()
    return []
  }

  /**
   * ストリーミング中はプレーンテキストで表示し、ブロック確定後に Markdown
   * で描画し直す（decisions.md N-1「必ず継承する挙動」）。`blockMarkdown` が
   * その確定タイミングを運ぶ。
   */
  private finalizeAgent(): TranscriptEvent[] {
    if (!this.currentAgent) return []
    const { id, buffer } = this.currentAgent
    this.currentAgent = null
    return [{ type: 'blockMarkdown', id, markdown: buffer }]
  }

  private finalizeThought(): TranscriptEvent[] {
    if (!this.currentThought) return []
    const { id, buffer } = this.currentThought
    this.currentThought = null
    return [{ type: 'blockMarkdown', id, markdown: buffer }]
  }

  private appendAgentChunk(content: ContentBlock, messageId: string | null): TranscriptEvent[] {
    const text = contentBlockToText(content)
    const events: TranscriptEvent[] = []
    if (!this.currentAgent || messageId !== this.currentAgent.messageId) {
      events.push(...this.closeOpenGroup(), ...this.finalizeAgent())
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
      events.push(...this.finalizeThought())
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
    if (this.openGroupId === null) {
      this.openGroupId = randomUUID()
      events.push({ type: 'group', id: this.openGroupId, timed: true, closed: false })
    }
    this.toolCallGroups.set(payload.toolCallId, this.openGroupId)
    events.push({ type: 'toolCall', toolCall: toolCallPayload(payload, this.openGroupId) })
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
  return {
    id: payload.toolCallId,
    groupId,
    kind: payload.kind ? TOOL_KIND_MAP[payload.kind] : 'other',
    title: 'title' in payload && payload.title ? payload.title : payload.toolCallId,
    status: (payload.status as ToolCallStatus | undefined) ?? 'pending',
    locations: (payload.locations ?? []).map((l) => ({ path: l.path, line: l.line ?? undefined })),
    diffs,
    rawInput: payload.rawInput
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
