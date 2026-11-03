import { describe, expect, it } from 'vitest'
import type { CreateElicitationRequest } from '@agentclientprotocol/sdk'
import {
  elicitationToEvent,
  parseElicitationRequest,
  replyToResponse,
  UnsupportedElicitationError
} from '@main/acp/elicitation'

function form(requestedSchema: Record<string, unknown>, message = 'Q?'): CreateElicitationRequest {
  return { mode: 'form', sessionId: 's', message, requestedSchema }
}

function refused(params: CreateElicitationRequest): string {
  try {
    parseElicitationRequest(params)
  } catch (err) {
    expect(err).toBeInstanceOf(UnsupportedElicitationError)
    return (err as Error).message
  }
  throw new Error('not refused')
}

describe('parseElicitationRequest', () => {
  it('プロパティの型ごとに項目を作る', () => {
    const fields = parseElicitationRequest(
      form({
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Name', minLength: 1, format: 'email' },
          plain: { type: 'string', enum: ['a', 'b'], default: 'b' },
          titled: {
            type: 'string',
            oneOf: [
              { const: 'x', title: 'X', description: 'about x', _meta: { '_claude/askUserQuestionOption': { preview: 'code' } } },
              { const: 'y', title: '' }
            ]
          },
          count: { type: 'integer', minimum: 0, maximum: 9, default: 3 },
          ratio: { type: 'number' },
          ok: { type: 'boolean', default: true },
          tags: { type: 'array', items: { anyOf: [{ const: 'p', title: 'P' }] }, maxItems: 1, default: ['p', 3] },
          plainTags: { type: 'array', items: { type: 'string', enum: ['q'] } }
        },
        required: ['name']
      })
    )
    expect(fields).toEqual([
      {
        key: 'name',
        title: 'Name',
        description: undefined,
        required: true,
        kind: 'text',
        default: undefined,
        format: 'email',
        minLength: 1,
        maxLength: undefined,
        pattern: undefined
      },
      {
        key: 'plain',
        title: undefined,
        description: undefined,
        required: false,
        kind: 'select',
        default: 'b',
        options: [
          { value: 'a', label: 'a' },
          { value: 'b', label: 'b' }
        ]
      },
      {
        key: 'titled',
        title: undefined,
        description: undefined,
        required: false,
        kind: 'select',
        default: undefined,
        options: [
          { value: 'x', label: 'X', description: 'about x', preview: 'code' },
          { value: 'y', label: 'y', description: undefined, preview: undefined }
        ]
      },
      { key: 'count', title: undefined, description: undefined, required: false, kind: 'number', integer: true, default: 3, minimum: 0, maximum: 9 },
      {
        key: 'ratio',
        title: undefined,
        description: undefined,
        required: false,
        kind: 'number',
        integer: false,
        default: undefined,
        minimum: undefined,
        maximum: undefined
      },
      { key: 'ok', title: undefined, description: undefined, required: false, kind: 'boolean', default: true },
      {
        key: 'tags',
        title: undefined,
        description: undefined,
        required: false,
        kind: 'multiSelect',
        default: ['p'],
        options: [{ value: 'p', label: 'P', description: undefined, preview: undefined }],
        minItems: undefined,
        maxItems: 1
      },
      {
        key: 'plainTags',
        title: undefined,
        description: undefined,
        required: false,
        kind: 'multiSelect',
        default: undefined,
        options: [{ value: 'q', label: 'q' }],
        minItems: undefined,
        maxItems: undefined
      }
    ])
  })

  it('properties が無くても空の項目で描ける', () => {
    expect(parseElicitationRequest(form({ type: 'object' }))).toEqual([])
  })

  it('フォームモード以外は断る', () => {
    const url = { mode: 'url', sessionId: 's', message: 'm', url: 'https://example.com', elicitationId: 'e' } as CreateElicitationRequest
    expect(refused(url)).toContain('url')
    expect(refused({ mode: '_custom', sessionId: 's', message: 'm' })).toContain('_custom')
  })

  it('描けない項目を含む要求は丸ごと断る', () => {
    expect(refused(form({ properties: { a: { type: 'object' } } }))).toContain("'a'")
    expect(refused(form({ properties: { a: { type: 'array', items: { type: 'string' } } } }))).toContain("'a'")
    expect(refused(form({ properties: { a: { type: 'string', enum: [] } } }))).toContain("'a'")
    expect(refused(form({ properties: { a: { type: 'string', oneOf: [{ title: 'no const' }] } } }))).toContain("'a'")
    expect(refused(form({ properties: { a: { type: 'string', enum: [1] } } }))).toContain("'a'")
  })
})

describe('elicitationToEvent', () => {
  it('スキーマの見出しを載せる', () => {
    const params = form({ type: 'object', title: 'T', properties: {} })
    expect(elicitationToEvent('e1', params, [])).toEqual({
      type: 'elicitation',
      id: 'e1',
      message: 'Q?',
      title: 'T',
      description: undefined,
      fields: []
    })
  })
})

describe('replyToResponse', () => {
  it('accept 以外では content を落とす', () => {
    expect(replyToResponse({ action: 'accept', content: { a: 1 } })).toEqual({ action: 'accept', content: { a: 1 } })
    expect(replyToResponse({ action: 'decline', content: { a: 1 } } as never)).toEqual({ action: 'decline' })
  })
})
