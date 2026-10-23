import { describe, expect, it } from 'vitest'
import { extractOutline } from '../../src/renderer/main-window/markdownOutline'

describe('extractOutline', () => {
  it('picks ATX and Setext headings with their line numbers', () => {
    const md = ['# 見出し1', '', '本文', '', 'Setext 2', '---', '', '### 見出し3'].join('\n')
    expect(extractOutline(md)).toEqual([
      { level: 1, text: '見出し1', line: 1 },
      { level: 2, text: 'Setext 2', line: 5 },
      { level: 3, text: '見出し3', line: 8 }
    ])
  })

  it('ignores # lines inside fenced code', () => {
    const md = ['```bash', '# コメント', '```', '## 本物'].join('\n')
    expect(extractOutline(md)).toEqual([{ level: 2, text: '本物', line: 4 }])
  })

  it('strips inline markup and replaces emoji shortcodes', () => {
    expect(extractOutline('# **太字** と `code` と [リンク](x.md) :smile:')).toEqual([
      { level: 1, text: '太字 と code と リンク 😄', line: 1 }
    ])
  })

  it('keeps headings with the same text apart', () => {
    expect(extractOutline('## 概要\n\n## 概要').map((item) => item.line)).toEqual([1, 3])
  })

  it('includes headings inside details, blockquotes and lists', () => {
    const md = ['<details>', '<summary>開く</summary>', '', '## 中', '', '</details>', '', '> # 引用', '', '- ### リスト'].join(
      '\n'
    )
    expect(extractOutline(md)).toEqual([
      { level: 2, text: '中', line: 4 },
      { level: 1, text: '引用', line: 8 },
      { level: 3, text: 'リスト', line: 10 }
    ])
  })

  it('returns nothing when there are no headings', () => {
    expect(extractOutline('本文だけ')).toEqual([])
  })
})
