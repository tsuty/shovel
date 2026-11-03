import type { CreateElicitationRequest, ElicitationSchema } from '@agentclientprotocol/sdk'
import type {
  ElicitationField,
  ElicitationOption,
  ElicitationReply,
  TranscriptEvent
} from '@shared/types/transcript'

/** `initialize` で広告する elicitation の対応範囲。フォームモードだけ。 */
export const ELICITATION_CAPABILITIES = { form: {} }

/** claude-agent-acp が選択肢の `preview` を入れてくる `_meta` のキー。 */
const PREVIEW_META_KEY = '_claude/askUserQuestionOption'

export type FormElicitation = CreateElicitationRequest & { mode: 'form'; requestedSchema: ElicitationSchema }

/** 描けない要求。メッセージは JSON-RPC エラーとログに使う。 */
export class UnsupportedElicitationError extends Error {}

/**
 * `elicitation/create` の要求を読み、質問カードの項目に変換する。フォームモード以外や、
 * 描けない項目（知らない型・選択肢の無い配列など）を含む要求は、項目を欠かしたまま見せずに
 * `UnsupportedElicitationError` で丸ごと断る。
 */
export function parseElicitationRequest(params: CreateElicitationRequest): ElicitationField[] {
  if (params.mode !== 'form') throw new UnsupportedElicitationError(`unsupported elicitation mode: ${params.mode}`)
  const schema = (params as Partial<FormElicitation>).requestedSchema
  if (!schema || typeof schema !== 'object') throw new UnsupportedElicitationError('requestedSchema is missing')
  const required = new Set(schema.required ?? [])
  // 型の上では必ずスキーマのオブジェクトだが、エージェントが送ってくる JSON は確かめる。
  const properties: Record<string, unknown> = schema.properties ?? {}
  return Object.entries(properties).map(([key, prop]) => {
    if (!prop || typeof prop !== 'object') throw new UnsupportedElicitationError(`property '${key}' is not a schema object`)
    return propertyToField(key, prop as Record<string, unknown>, required.has(key))
  })
}

export function elicitationToEvent(
  id: string,
  params: CreateElicitationRequest,
  fields: ElicitationField[]
): TranscriptEvent {
  const schema = (params as Partial<FormElicitation>).requestedSchema
  return {
    type: 'elicitation',
    id,
    message: params.message,
    title: optionalString(schema?.title),
    description: optionalString(schema?.description),
    fields
  }
}

/** renderer の応答を ACP の `CreateElicitationResponse` の形にする（余分なフィールドを落とす）。 */
export function replyToResponse(reply: ElicitationReply): ElicitationReply {
  return reply.action === 'accept' ? { action: 'accept', content: reply.content } : { action: reply.action }
}

function propertyToField(key: string, prop: Record<string, unknown>, required: boolean): ElicitationField {
  const base = {
    key,
    title: optionalString(prop.title),
    description: optionalString(prop.description),
    required
  }
  switch (prop.type) {
    case 'string': {
      const options = choices(prop, key)
      if (options) return { ...base, kind: 'select', default: optionalString(prop.default), options }
      return {
        ...base,
        kind: 'text',
        default: optionalString(prop.default),
        format: isStringFormat(prop.format) ? prop.format : undefined,
        minLength: optionalNumber(prop.minLength),
        maxLength: optionalNumber(prop.maxLength),
        pattern: optionalString(prop.pattern)
      }
    }
    case 'number':
    case 'integer':
      return {
        ...base,
        kind: 'number',
        integer: prop.type === 'integer',
        default: optionalNumber(prop.default),
        minimum: optionalNumber(prop.minimum),
        maximum: optionalNumber(prop.maximum)
      }
    case 'boolean':
      return { ...base, kind: 'boolean', default: typeof prop.default === 'boolean' ? prop.default : undefined }
    case 'array': {
      const items = prop.items
      const options = items && typeof items === 'object' ? choices(items as Record<string, unknown>, key) : undefined
      if (!options) throw new UnsupportedElicitationError(`property '${key}' is an array without enumerated items`)
      return {
        ...base,
        kind: 'multiSelect',
        default: Array.isArray(prop.default) ? prop.default.filter((v): v is string => typeof v === 'string') : undefined,
        options,
        minItems: optionalNumber(prop.minItems),
        maxItems: optionalNumber(prop.maxItems)
      }
    }
  }
  throw new UnsupportedElicitationError(`property '${key}' has an unsupported type: ${String(prop.type)}`)
}

/**
 * `oneOf` / `anyOf`（タイトル付き）か `enum`（タイトルなし）の選択肢。どれも無ければ undefined。
 * 読めない選択肢や空の選択肢は描けないので断る。
 */
function choices(schema: Record<string, unknown>, key: string): ElicitationOption[] | undefined {
  const titled = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : undefined
  let options: ElicitationOption[]
  if (titled) {
    options = titled.map((item) => {
      if (!item || typeof item !== 'object') throw new UnsupportedElicitationError(`property '${key}' has a choice that is not an object`)
      const option = item as Record<string, unknown>
      if (typeof option.const !== 'string') throw new UnsupportedElicitationError(`property '${key}' has a choice without a const`)
      return {
        value: option.const,
        label: typeof option.title === 'string' && option.title !== '' ? option.title : option.const,
        description: optionalString(option.description),
        preview: preview(option)
      }
    })
  } else if (Array.isArray(schema.enum)) {
    options = schema.enum.map((value) => {
      if (typeof value !== 'string') throw new UnsupportedElicitationError(`property '${key}' has an enum value that is not text`)
      return { value, label: value }
    })
  } else {
    return undefined
  }
  if (options.length === 0) throw new UnsupportedElicitationError(`property '${key}' offers no choice`)
  return options
}

function preview(option: Record<string, unknown>): string | undefined {
  const meta = option._meta
  if (!meta || typeof meta !== 'object') return undefined
  const entry = (meta as Record<string, unknown>)[PREVIEW_META_KEY]
  if (!entry || typeof entry !== 'object') return undefined
  const text = (entry as Record<string, unknown>).preview
  return typeof text === 'string' && text.trim() !== '' ? text : undefined
}

function isStringFormat(value: unknown): value is 'email' | 'uri' | 'date' | 'date-time' {
  return value === 'email' || value === 'uri' || value === 'date' || value === 'date-time'
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
