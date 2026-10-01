import type {
  AttachmentChip,
  BlockRole,
  PermissionOption,
  ToolCallPayload,
  TranscriptEvent
} from '@shared/types/transcript'

export interface RenderChoice {
  id: string
  label: string
}

export interface RenderBlock {
  id: string
  role: BlockRole
  markdown: string
  streaming: boolean
  chips?: AttachmentChip[]
  choices?: RenderChoice[]
  /** SYSTEM ブロックのうち、`notice` イベント由来のもの。文言は i18n の `transcript.notice.{key}`。 */
  noticeKey?: string
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

export type OrderEntry = { kind: 'block'; id: string } | { kind: 'group'; id: string }

/**
 * ui.md §6「`agent_thought_chunk` はチャットに流さない。入力欄の上の専用
 * エリアに直近数行だけを更新表示する」。ストリーミング中の思考はここに
 * 置き、確定（`blockMarkdown`）したタイミングで初めて通常の `order` へ
 * 折り畳みブロックとして送り込む。
 */
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
  toast: string | null
  liveThought: LiveThought | null
}

export const initialTranscriptState: TranscriptState = {
  order: [],
  blocks: {},
  groups: {},
  toolCallsByGroup: {},
  permissions: {},
  toast: null,
  liveThought: null
}

export function transcriptReducer(state: TranscriptState, event: TranscriptEvent): TranscriptState {
  switch (event.type) {
    case 'reset':
      return initialTranscriptState
    case 'block':
      // 専用エリアに出すのはストリーミング中の思考だけ。スナップショットから
      // 戻した確定済みの思考は、最初から折り畳みブロックとして並べる。
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
        // 確定した瞬間に専用エリアから外し、折り畳みブロックとしてトランス
        // クリプト本体へ格納する（ui.md §6「ターン終了時にこのエリアは消え、
        // トランスクリプト下部の折り畳みに格納される」）。
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
          [event.id]: { ...block, markdown: event.markdown, streaming: false, choices: event.choices }
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
    case 'attachments': {
      const block = state.blocks[event.id]
      if (!block) return state
      return { ...state, blocks: { ...state.blocks, [event.id]: { ...block, chips: event.chips } } }
    }
    case 'agent':
    case 'theme':
    case 'turnEnd':
    case 'sessionMeta':
      return state
  }
}
