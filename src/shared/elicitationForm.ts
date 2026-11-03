import type { ElicitationField, ElicitationValue } from './types/transcript'

/**
 * フォームの入力中の値。文字列・数値・単一選択は入力欄の文字列（未入力は空文字）、
 * 真偽値はチェックの有無、複数選択は選んだ値の配列で持つ。
 */
export type ElicitationFormValue = string | boolean | string[]

export type ElicitationFormValues = Record<string, ElicitationFormValue>

/** 入力の誤り。文言は i18n の `elicitation.error.{code}` から引く。 */
export interface ElicitationFieldError {
  code:
    | 'required'
    | 'minLength'
    | 'maxLength'
    | 'pattern'
    | 'email'
    | 'uri'
    | 'date'
    | 'dateTime'
    | 'number'
    | 'integer'
    | 'minimum'
    | 'maximum'
    | 'choice'
    | 'minItems'
    | 'maxItems'
  params?: Record<string, number | string>
}

/** スキーマの `default` を入れた初期値。 */
export function initialElicitationValues(fields: ElicitationField[]): ElicitationFormValues {
  const values: ElicitationFormValues = {}
  for (const field of fields) {
    switch (field.kind) {
      case 'text':
        values[field.key] = field.default ?? ''
        break
      case 'select':
        values[field.key] = field.default !== undefined && field.options.some((o) => o.value === field.default) ? field.default : ''
        break
      case 'number':
        values[field.key] = field.default !== undefined ? String(field.default) : ''
        break
      case 'boolean':
        values[field.key] = field.default ?? false
        break
      case 'multiSelect':
        values[field.key] = (field.default ?? []).filter((v) => field.options.some((o) => o.value === v))
        break
    }
  }
  return values
}

const EMAIL = /^[^\s@]+@[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

/** 項目ごとの入力の誤り。誤りのない項目はキーを持たない。 */
export function validateElicitation(
  fields: ElicitationField[],
  values: ElicitationFormValues
): Record<string, ElicitationFieldError> {
  const errors: Record<string, ElicitationFieldError> = {}
  for (const field of fields) {
    const error = validateField(field, values[field.key])
    if (error) errors[field.key] = error
  }
  return errors
}

function validateField(field: ElicitationField, value: ElicitationFormValue | undefined): ElicitationFieldError | null {
  switch (field.kind) {
    case 'text': {
      const text = typeof value === 'string' ? value : ''
      if (text === '') return field.required ? { code: 'required' } : null
      const length = [...text].length
      if (field.minLength !== undefined && length < field.minLength) return { code: 'minLength', params: { min: field.minLength } }
      if (field.maxLength !== undefined && length > field.maxLength) return { code: 'maxLength', params: { max: field.maxLength } }
      if (field.pattern !== undefined && !matchesPattern(field.pattern, text)) return { code: 'pattern' }
      if (field.format === 'email' && !EMAIL.test(text)) return { code: 'email' }
      if (field.format === 'uri' && !isUri(text)) return { code: 'uri' }
      if (field.format === 'date' && !(DATE.test(text) && !Number.isNaN(Date.parse(text)))) return { code: 'date' }
      if (field.format === 'date-time' && !(DATE_TIME.test(text) && !Number.isNaN(Date.parse(text)))) return { code: 'dateTime' }
      return null
    }
    case 'select': {
      const text = typeof value === 'string' ? value : ''
      if (text === '') return field.required ? { code: 'required' } : null
      if (!field.options.some((o) => o.value === text)) return { code: 'choice' }
      return null
    }
    case 'number': {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text === '') return field.required ? { code: 'required' } : null
      const n = Number(text)
      if (!Number.isFinite(n)) return { code: 'number' }
      if (field.integer && !Number.isInteger(n)) return { code: 'integer' }
      if (field.minimum !== undefined && n < field.minimum) return { code: 'minimum', params: { min: field.minimum } }
      if (field.maximum !== undefined && n > field.maximum) return { code: 'maximum', params: { max: field.maximum } }
      return null
    }
    case 'boolean':
      return null
    case 'multiSelect': {
      const picks = Array.isArray(value) ? value : []
      if (picks.length === 0) return field.required ? { code: 'required' } : null
      if (!picks.every((v) => field.options.some((o) => o.value === v))) return { code: 'choice' }
      if (field.minItems !== undefined && picks.length < field.minItems) return { code: 'minItems', params: { min: field.minItems } }
      if (field.maxItems !== undefined && picks.length > field.maxItems) return { code: 'maxItems', params: { max: field.maxItems } }
      return null
    }
  }
}

function matchesPattern(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(text)
  } catch {
    // 解釈できないパターンは検証しない（エージェント側でも検証される）。
    return true
  }
}

function isUri(text: string): boolean {
  try {
    new URL(text)
    return true
  } catch {
    return false
  }
}

/**
 * `accept` で送る `content`。未入力の任意項目は含めない。真偽値は常に含める。
 * 検証を通った値だけを渡す前提。
 */
export function buildElicitationContent(
  fields: ElicitationField[],
  values: ElicitationFormValues
): Record<string, ElicitationValue> {
  const content: Record<string, ElicitationValue> = {}
  for (const field of fields) {
    const value = values[field.key]
    switch (field.kind) {
      case 'text':
      case 'select':
        if (typeof value === 'string' && value !== '') content[field.key] = value
        break
      case 'number':
        if (typeof value === 'string' && value.trim() !== '') content[field.key] = Number(value.trim())
        break
      case 'boolean':
        content[field.key] = value === true
        break
      case 'multiSelect':
        // 選択肢の並び順で送る。
        if (Array.isArray(value) && value.length > 0) {
          content[field.key] = field.options.map((o) => o.value).filter((v) => value.includes(v))
        }
        break
    }
  }
  return content
}

/**
 * 送られてきた `content` をスキーマに照らして検証し直し、エージェントへ送る形に整える。
 * スキーマに無いキーは落とす。型が合わない値や検証を通らない値があれば null。
 */
export function checkElicitationContent(
  fields: ElicitationField[],
  content: Record<string, unknown>
): Record<string, ElicitationValue> | null {
  const values: ElicitationFormValues = {}
  for (const field of fields) {
    const value = content[field.key]
    if (value === undefined || value === null) continue
    const formValue = toFormValue(field, value)
    if (formValue === null) return null
    values[field.key] = formValue
  }
  if (Object.keys(validateElicitation(fields, values)).length > 0) return null
  return buildElicitationContent(fields, values)
}

function toFormValue(field: ElicitationField, value: unknown): ElicitationFormValue | null {
  switch (field.kind) {
    case 'text':
    case 'select':
      return typeof value === 'string' ? value : null
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : null
    case 'boolean':
      return typeof value === 'boolean' ? value : null
    case 'multiSelect':
      return Array.isArray(value) && value.every((v): v is string => typeof v === 'string') ? value : null
  }
}
