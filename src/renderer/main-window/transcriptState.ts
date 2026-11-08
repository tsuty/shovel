import type {
  AttachmentChip,
  BlockRole,
  ElicitationAction,
  ElicitationField,
  ElicitationValue,
  PermissionOption,
  ToolCallPayload,
  TranscriptEvent,
  TranscriptImage
} from '@shared/types/transcript'
import type { CompactionState } from '@shared/types/session'

export interface RenderChoice {
  id: string
  label: string
}

export interface RenderBlock {
  id: string
  role: BlockRole
  markdown: string
  streaming: boolean
  /** ストリーミング中、先頭のこの長さまでは Markdown で描く（`blockReopen` の時点の長さ）。 */
  renderedLength?: number
  chips?: AttachmentChip[]
  choices?: RenderChoice[]
  /** SYSTEM ブロックのうち、`notice` イベント由来のもの。文言は i18n の `transcript.notice.{key}`。 */
  noticeKey?: string
  /** SYSTEM ブロックのうち、エージェントの `notice` 由来のもの。`markdown` はその見出し（プレーンテキスト）。 */
  agentNotice?: { severity: string; description?: string }
  /** SYSTEM ブロックのうち、ターンの停止理由（ACP の `stopReason`）を示すもの。 */
  stopReason?: string
  /** AGENT ブロックに含まれていた画像。 */
  images?: TranscriptImage[]
  /** COMPACTION ブロックの状態。`markdown` は要約の本文。 */
  compaction?: CompactionState
}

export interface RenderGroup {
  id: string
  closed: boolean
}

export interface RenderPermission {
  id: string
  toolCallId: string
  headline: string
  bodyMarkdown: string
  flat: boolean
  options: PermissionOption[]
  status: 'pending' | 'selected' | 'cancelled'
  chosenOptionId?: string
}

export interface RenderElicitation {
  id: string
  message: string
  title?: string
  description?: string
  fields: ElicitationField[]
  status: 'pending' | ElicitationAction
  /** `accept` で送った内容。 */
  content?: Record<string, ElicitationValue>
}

export type OrderEntry =
  | { kind: 'block'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'elicitation'; id: string }

/** ストリーミング中の思考。確定（`blockMarkdown`）したら `order` へ折り畳みブロックとして移す。 */
export interface LiveThought {
  id: string
  markdown: string
}

export interface TranscriptState {
  order: OrderEntry[]
  blocks: Record<string, RenderBlock>
  groups: Record<string, RenderGroup>
  toolCallsByGroup: Record<string, ToolCallPayload[]>
  permissions: Record<string, RenderPermission>
  elicitations: Record<string, RenderElicitation>
  toast: string | null
  liveThought: LiveThought | null
}

export const initialTranscriptState: TranscriptState = {
  order: [],
  blocks: {},
  groups: {},
  toolCallsByGroup: {},
  permissions: {},
  elicitations: {},
  toast: null,
  liveThought: null
}

export function transcriptReducer(state: TranscriptState, event: TranscriptEvent): TranscriptState {
  switch (event.type) {
    case 'reset':
      return initialTranscriptState
    case 'block':
      // スナップショットから戻した確定済みの思考は、最初から折り畳みブロックとして並べる。
      if (event.role === 'THOUGHT' && event.streaming) {
        return { ...state, liveThought: { id: event.id, markdown: event.markdown } }
      }
      return {
        ...state,
        order: [...state.order, { kind: 'block', id: event.id }],
        blocks: {
          ...state.blocks,
          [event.id]: {
            id: event.id,
            role: event.role,
            markdown: event.markdown,
            streaming: event.streaming,
            choices: event.choices
          }
        }
      }
    case 'stream': {
      if (state.liveThought?.id === event.id) {
        return { ...state, liveThought: { ...state.liveThought, markdown: state.liveThought.markdown + event.text } }
      }
      const block = state.blocks[event.id]
      if (!block) return state
      return {
        ...state,
        blocks: { ...state.blocks, [event.id]: { ...block, markdown: block.markdown + event.text } }
      }
    }
    case 'blockMarkdown': {
      if (state.liveThought?.id === event.id) {
        // 確定したら専用エリアから外し、折り畳みブロックとしてトランスクリプト本体へ移す。
        return {
          ...state,
          liveThought: null,
          order: [...state.order, { kind: 'block', id: event.id }],
          blocks: {
            ...state.blocks,
            [event.id]: { id: event.id, role: 'THOUGHT', markdown: event.markdown, streaming: false }
          }
        }
      }
      const block = state.blocks[event.id]
      if (!block) return state
      return {
        ...state,
        blocks: {
          ...state.blocks,
          [event.id]: { ...block, markdown: event.markdown, streaming: false, renderedLength: undefined, choices: event.choices }
        }
      }
    }
    case 'blockReopen': {
      const block = state.blocks[event.id]
      if (!block || block.streaming) return state
      return {
        ...state,
        blocks: {
          ...state.blocks,
          [event.id]: { ...block, streaming: true, renderedLength: block.markdown.length, choices: undefined }
        }
      }
    }
    case 'group': {
      const existing = state.groups[event.id]
      const order = existing ? state.order : [...state.order, { kind: 'group' as const, id: event.id }]
      return {
        ...state,
        order,
        groups: { ...state.groups, [event.id]: { id: event.id, closed: event.closed } }
      }
    }
    case 'toolCall': {
      const groupId = event.toolCall.groupId
      const existing = state.toolCallsByGroup[groupId] ?? []
      const idx = existing.findIndex((tc) => tc.id === event.toolCall.id)
      const next = idx >= 0 ? existing.map((tc, i) => (i === idx ? event.toolCall : tc)) : [...existing, event.toolCall]
      return { ...state, toolCallsByGroup: { ...state.toolCallsByGroup, [groupId]: next } }
    }
    case 'permission':
      return {
        ...state,
        permissions: {
          ...state.permissions,
          [event.id]: {
            id: event.id,
            toolCallId: event.toolCallId,
            headline: event.headline,
            bodyMarkdown: event.bodyMarkdown,
            flat: event.flat,
            options: event.options,
            status: 'pending'
          }
        }
      }
    case 'permissionResolved': {
      const existing = state.permissions[event.id]
      if (!existing) return state
      return {
        ...state,
        permissions: {
          ...state.permissions,
          [event.id]: { ...existing, status: event.status, chosenOptionId: event.optionId }
        }
      }
    }
    case 'elicitation':
      return {
        ...state,
        order: [...state.order, { kind: 'elicitation', id: event.id }],
        elicitations: {
          ...state.elicitations,
          [event.id]: {
            id: event.id,
            message: event.message,
            title: event.title,
            description: event.description,
            fields: event.fields,
            status: 'pending'
          }
        }
      }
    case 'elicitationResolved': {
      const existing = state.elicitations[event.id]
      if (!existing) return state
      return {
        ...state,
        elicitations: {
          ...state.elicitations,
          [event.id]: { ...existing, status: event.action, content: event.content }
        }
      }
    }
    case 'toast':
      return { ...state, toast: event.text }
    case 'notice':
      return {
        ...state,
        order: [...state.order, { kind: 'block', id: event.id }],
        blocks: {
          ...state.blocks,
          [event.id]: { id: event.id, role: 'SYSTEM', markdown: '', streaming: false, noticeKey: event.key }
        }
      }
    case 'agentNotice':
      return {
        ...state,
        order: [...state.order, { kind: 'block', id: event.id }],
        blocks: {
          ...state.blocks,
          [event.id]: {
            id: event.id,
            role: 'SYSTEM',
            markdown: event.title,
            streaming: false,
            agentNotice: { severity: event.severity, description: event.description }
          }
        }
      }
    case 'stopReason':
      return {
        ...state,
        order: [...state.order, { kind: 'block', id: event.id }],
        blocks: {
          ...state.blocks,
          [event.id]: { id: event.id, role: 'SYSTEM', markdown: '', streaming: false, stopReason: event.reason }
        }
      }
    case 'compaction': {
      const block: RenderBlock = {
        id: event.id,
        role: 'COMPACTION',
        markdown: event.summary,
        streaming: false,
        compaction: event.state
      }
      const order = state.blocks[event.id] ? state.order : [...state.order, { kind: 'block' as const, id: event.id }]
      return { ...state, order, blocks: { ...state.blocks, [event.id]: block } }
    }
    case 'attachments': {
      const block = state.blocks[event.id]
      if (!block) return state
      return { ...state, blocks: { ...state.blocks, [event.id]: { ...block, chips: event.chips } } }
    }
    case 'images': {
      const block = state.blocks[event.id]
      if (!block) return state
      return { ...state, blocks: { ...state.blocks, [event.id]: { ...block, images: event.images } } }
    }
    case 'agent':
    case 'theme':
    case 'turnEnd':
    case 'sessionMeta':
    case 'title':
    case 'afterTurn':
      return state
  }
}
