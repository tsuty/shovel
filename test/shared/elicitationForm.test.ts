import { describe, expect, it } from 'vitest'
import type { ElicitationField } from '@shared/types/transcript'
import {
  buildElicitationContent,
  checkElicitationContent,
  initialElicitationValues,
  validateElicitation
} from '@shared/elicitationForm'

const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' }
]

const fields: ElicitationField[] = [
  { key: 'name', required: true, kind: 'text', minLength: 2, maxLength: 4 },
  { key: 'mail', required: false, kind: 'text', format: 'email' },
  { key: 'pick', required: false, kind: 'select', options, default: 'z' },
  { key: 'n', required: false, kind: 'number', integer: true, minimum: 1, maximum: 5, default: 2 },
  { key: 'ok', required: false, kind: 'boolean' },
  { key: 'many', required: false, kind: 'multiSelect', options, default: ['c', 'x'], maxItems: 2 }
]

describe('initialElicitationValues', () => {
  it('default を入れ、選択肢に無い default は捨てる', () => {
    expect(initialElicitationValues(fields)).toEqual({
      name: '',
      mail: '',
      pick: '',
      n: '2',
      ok: false,
      many: ['c']
    })
  })
})

describe('validateElicitation', () => {
  it('必須・長さ・形式・範囲・個数を検証する', () => {
    const values = { name: '', mail: 'nope', pick: '', n: '1.5', ok: false, many: ['a', 'b', 'c'] }
    expect(validateElicitation(fields, values)).toEqual({
      name: { code: 'required' },
      mail: { code: 'email' },
      n: { code: 'integer' },
      many: { code: 'maxItems', params: { max: 2 } }
    })
    expect(validateElicitation(fields, { ...values, name: 'あいうえお', n: '9', mail: '', many: [] })).toEqual({
      name: { code: 'maxLength', params: { max: 4 } },
      n: { code: 'maximum', params: { max: 5 } }
    })
  })

  it('日付・日時・パターンを検証する', () => {
    const f: ElicitationField[] = [
      { key: 'd', required: false, kind: 'text', format: 'date' },
      { key: 't', required: false, kind: 'text', format: 'date-time' },
      { key: 'p', required: false, kind: 'text', pattern: '^[a-z]+$' },
      { key: 'bad', required: false, kind: 'text', pattern: '(' }
    ]
    expect(validateElicitation(f, { d: '2026-11-02', t: '2026-11-02T09:00:00+09:00', p: 'abc', bad: 'x' })).toEqual({})
    expect(validateElicitation(f, { d: '2026/11/02', t: '2026-11-02 09:00', p: 'A1', bad: 'x' })).toEqual({
      d: { code: 'date' },
      t: { code: 'dateTime' },
      p: { code: 'pattern' }
    })
  })

  it('選択肢に無い値は誤り', () => {
    expect(validateElicitation(fields, { name: 'ab', pick: 'z', many: ['x'] })).toEqual({
      pick: { code: 'choice' },
      many: { code: 'choice' }
    })
  })
})

describe('buildElicitationContent', () => {
  it('未入力の任意項目を省き、数値は数にし、複数選択は選択肢の順に並べる', () => {
    expect(
      buildElicitationContent(fields, { name: 'ab', mail: '', pick: 'b', n: ' 3 ', ok: false, many: ['c', 'a'] })
    ).toEqual({ name: 'ab', pick: 'b', n: 3, ok: false, many: ['a', 'c'] })
    expect(buildElicitationContent(fields, { name: 'ab', mail: '', pick: '', n: '', ok: true, many: [] })).toEqual({
      name: 'ab',
      ok: true
    })
  })
})

describe('checkElicitationContent', () => {
  it('スキーマに無いキーを落とし、検証を通った内容を返す', () => {
    expect(checkElicitationContent(fields, { name: 'ab', n: 3, many: ['b', 'a'], extra: 'x' })).toEqual({
      name: 'ab',
      n: 3,
      ok: false,
      many: ['a', 'b']
    })
  })

  it('型が合わない値や検証を通らない値があれば null', () => {
    expect(checkElicitationContent(fields, { name: 'ab', n: '3' })).toBeNull()
    expect(checkElicitationContent(fields, { name: 'ab', pick: 'z' })).toBeNull()
    expect(checkElicitationContent(fields, { mail: 'a@b' })).toBeNull()
  })
})
