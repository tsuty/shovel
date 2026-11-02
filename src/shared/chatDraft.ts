/** チャットの入力欄へ足す文字。`block` は空行で区切って足し、`inline` は空白で区切って足す。 */
export interface DraftInsertion {
  text: string
  mode: 'block' | 'inline'
}

/** ブラウザの右クリックで渡す先に選べるチャット。 */
export interface ChatTarget {
  /** タブの id（`sessionId`）。 */
  id: string
  title: string
  /** そのペインで前面に表示されているか。 */
  visible: boolean
}

/** 選択した文字を Markdown の引用にし、最後の行にページの URL を添える。 */
export function quoteSelection(selection: string, url: string): string {
  const lines = selection.replace(/\r\n?/g, '\n').replace(/\s+$/, '').replace(/^\s*\n/, '').split('\n')
  const quoted = lines.map((line) => (line.trim() ? `> ${line.trimEnd()}` : '>'))
  return url ? [...quoted, '>', `> ${url}`].join('\n') : quoted.join('\n')
}

/** 入力欄の今の内容 `draft` の後ろに `insertion` を足した結果。 */
export function appendToDraft(draft: string, insertion: DraftInsertion): string {
  if (insertion.mode === 'inline') {
    const separator = draft === '' || /\s$/.test(draft) ? '' : ' '
    return `${draft}${separator}${insertion.text} `
  }
  const head = draft.replace(/\s+$/, '')
  return head ? `${head}\n\n${insertion.text}\n\n` : `${insertion.text}\n\n`
}
