/**
 * decisions.md C-6: ローカルセッション検索は生 JSON ではなく、
 * `SnapshotEntry.markdown` から Markdown 記法を落とした平文に対して行い、
 * 結果もその平文から一文を抜粋して見せる。完全な Markdown パーサではなく、
 * 「検索とスニペットの読みやすさ」に効く記法だけを正規表現で落とす。
 */
export function markdownToPlainText(markdown: string): string {
  return (
    markdown
      // コードフェンスの開始・終了行（中身のコードは残す）
      .replace(/^\s*(?:```|~~~)[^\n]*$/gm, '')
      // 画像・リンクは表示テキストだけ残す
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // 生 HTML タグ
      .replace(/<\/?[a-zA-Z][^>\n]*>/g, '')
      // 見出し・引用
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      // タスクリスト・箇条書き・番号付きリストの記号
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
      // 表の区切り行と列区切り
      .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|?)+\s*$/gm, '')
      .replace(/\|/g, ' ')
      // 水平線
      .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
      // 強調・打ち消し・インラインコード
      .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1$2')
      .replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, '$1$2')
      .replace(/`([^`\n]*)`/g, '$1')
  )
}

const SENTENCE_END = /[。．！？!?\n]|\.(?=\s)/g
const MAX_BEFORE = 60
const MAX_AFTER = 120

/**
 * 平文の中から、`index`〜`index + length` を含む一文を切り出す。長すぎる
 * 一文は前後を省略記号で詰める。
 */
export function sentenceAround(
  text: string,
  index: number,
  length: number
): { before: string; match: string; after: string } {
  let start = 0
  let end = text.length
  SENTENCE_END.lastIndex = 0
  for (let m = SENTENCE_END.exec(text); m; m = SENTENCE_END.exec(text)) {
    if (m.index < index) {
      start = m.index + 1
    } else if (m.index >= index + length) {
      // 句読点は一文に含める（改行は含めない）
      end = m[0] === '\n' ? m.index : m.index + 1
      break
    }
  }
  const squash = (s: string): string => s.replace(/\s+/g, ' ')
  let before = squash(text.slice(start, index)).trimStart()
  let after = squash(text.slice(index + length, end)).trimEnd()
  if (before.length > MAX_BEFORE) before = '…' + before.slice(before.length - MAX_BEFORE)
  if (after.length > MAX_AFTER) after = after.slice(0, MAX_AFTER) + '…'
  return { before, match: squash(text.slice(index, index + length)), after }
}
