import type {
  BlockRole,
  PermissionOption,
  ToolCallPayload,
  TranscriptEvent
} from '@shared/types/transcript'

export interface RenderBlock {
  id: string
  role: BlockRole
  markdown: string
  streaming: boolean
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

export interface TranscriptState {
  order: OrderEntry[]
  blocks: Record<string, RenderBlock>
  groups: Record<string, RenderGroup>
  toolCallsByGroup: Record<string, ToolCallPayload[]>
  permissions: Record<string, RenderPermission>
  toast: string | null
}

export const initialTranscriptState: TranscriptState = {
  order: [],
  blocks: {},
  groups: {},
  toolCallsByGroup: {},
  permissions: {},
  toast: null
}

export function transcriptReducer(state: TranscriptState, event: TranscriptEvent): TranscriptState {
  switch (event.type) {
    case 'reset':
      return initialTranscriptState
    case 'block':
      return {
        ...state,
        order: [...state.order, { kind: 'block', id: event.id }],
        blocks: {
          ...state.blocks,
          [event.id]: { id: event.id, role: event.role, markdown: event.markdown, streaming: event.streaming }
        }
      }
    case 'stream': {
      const block = state.blocks[event.id]
      if (!block) return state
      return {
        ...state,
        blocks: { ...state.blocks, [event.id]: { ...block, markdown: block.markdown + event.text } }
      }
    }
    case 'blockMarkdown': {
      const block = state.blocks[event.id]
      if (!block) return state
      return {
        ...state,
        blocks: { ...state.blocks, [event.id]: { ...block, markdown: event.markdown, streaming: false } }
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
    case 'agent':
    case 'theme':
    case 'attachments':
    case 'turnEnd':
    case 'sessionMeta':
      return state
  }
}
