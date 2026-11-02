import { describe, expect, it } from 'vitest'
import { appendToDraft, quoteSelection } from '@shared/chatDraft'

describe('quoteSelection', () => {
  it('各行を引用にし、最後に URL を添える', () => {
    expect(quoteSelection('一行目\n二行目', 'https://example.com/a')).toBe(
      '> 一行目\n> 二行目\n>\n> https://example.com/a'
    )
  })

  it('空行は `>` だけにし、前後の空行と改行コードの違いを整える', () => {
    expect(quoteSelection('\r\na  \r\n\r\nb\r\n\r\n', 'https://example.com')).toBe('> a\n>\n> b\n>\n> https://example.com')
  })

  it('URL が無ければ引用だけ', () => {
    expect(quoteSelection('a', '')).toBe('> a')
  })
})

describe('appendToDraft', () => {
  it('block は空行で区切り、後ろにも空行を置く', () => {
    expect(appendToDraft('', { text: '> a', mode: 'block' })).toBe('> a\n\n')
    expect(appendToDraft('これを見て\n', { text: '> a', mode: 'block' })).toBe('これを見て\n\n> a\n\n')
  })

  it('inline は空白で区切る', () => {
    expect(appendToDraft('', { text: 'https://x.test', mode: 'inline' })).toBe('https://x.test ')
    expect(appendToDraft('見て', { text: 'https://x.test', mode: 'inline' })).toBe('見て https://x.test ')
    expect(appendToDraft('見て\n', { text: 'https://x.test', mode: 'inline' })).toBe('見て\nhttps://x.test ')
  })
})
