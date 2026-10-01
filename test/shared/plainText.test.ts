import { markdownToPlainText, sentenceAround } from '@shared/plainText'

describe('markdownToPlainText', () => {
  it('見出し・引用・リストの記号を落とす', () => {
    expect(markdownToPlainText('# 見出し\n> 引用\n- 項目\n1. 番号')).toBe('見出し\n引用\n項目\n番号')
  })

  it('リンク・画像は表示テキストだけ残す', () => {
    expect(markdownToPlainText('[詳細](https://example.com) と ![図](a.png)')).toBe('詳細 と 図')
  })

  it('コードフェンスの行を落とし、中身のコードは残す', () => {
    expect(markdownToPlainText('```ts\nconst a = 1\n```')).toBe('\nconst a = 1\n')
  })

  it('強調・打ち消し・インラインコードの記号を落とす', () => {
    expect(markdownToPlainText('**太字** と *斜体* と ~~消し~~ と `code`')).toBe('太字 と 斜体 と 消し と code')
  })

  it('識別子中のアンダースコアは強調として扱わない', () => {
    expect(markdownToPlainText('snake_case_name')).toBe('snake_case_name')
  })

  it('タスクリストの記号を落とす', () => {
    expect(markdownToPlainText('- [ ] 未完了\n- [x] 完了')).toBe('未完了\n完了')
  })

  it('表の区切り行と列区切りを落とす', () => {
    expect(markdownToPlainText('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('  a   b  \n\n  1   2  ')
  })

  it('生 HTML タグを落とす', () => {
    expect(markdownToPlainText('a <b>bold</b> c')).toBe('a bold c')
  })
})

describe('sentenceAround', () => {
  it('マッチを含む一文だけを切り出す', () => {
    const text = '最初の文。検索語を含む文です。最後の文。'
    const index = text.indexOf('検索語')
    expect(sentenceAround(text, index, 3)).toEqual({ before: '', match: '検索語', after: 'を含む文です。' })
  })

  it('英文はピリオド＋空白で区切る', () => {
    const text = 'First sentence. The keyword is here. Last.'
    const index = text.indexOf('keyword')
    expect(sentenceAround(text, index, 7)).toEqual({ before: 'The ', match: 'keyword', after: ' is here.' })
  })

  it('改行は一文に含めない', () => {
    const text = '一行目\n二行目の語\n三行目'
    const index = text.indexOf('語')
    expect(sentenceAround(text, index, 1)).toEqual({ before: '二行目の', match: '語', after: '' })
  })

  it('長すぎる前後は省略記号で詰める', () => {
    const text = 'あ'.repeat(100) + '語' + 'い'.repeat(200)
    const result = sentenceAround(text, 100, 1)
    expect(result.before).toBe('…' + 'あ'.repeat(60))
    expect(result.after).toBe('い'.repeat(120) + '…')
  })

  it('連続した空白を1つに畳む', () => {
    const text = 'a   b\tc 語'
    expect(sentenceAround(text, text.indexOf('語'), 1).before).toBe('a b c ')
  })
})
