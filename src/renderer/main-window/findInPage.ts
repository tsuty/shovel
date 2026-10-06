/**
 * ページ内検索（Cmd/Ctrl+F）の文字列照合。DOM に依存しない部分だけをここに置く。
 *
 * テキストノードの文字列を連結して照合し、ヒット位置を「何番目のノードの何文字目」に戻す。
 * shiki のトークンやインライン要素でテキストノードが細切れになっていても、語が見つかるようにするため。
 */

export interface TextPosition {
  /** `segments` の添字。 */
  segment: number
  offset: number
}

export interface TextMatch {
  start: TextPosition
  end: TextPosition
}

/** 大文字小文字を区別せずに `query` を探す。空なら空配列。 */
export function findTextMatches(segments: readonly string[], query: string): TextMatch[] {
  if (!query) return []
  const joined = segments.join('')
  const haystack = joined.toLowerCase()
  const needle = query.toLowerCase()
  // 小文字化で長さが変わる文字（例: İ）を含むと位置がずれるので、そのときは区別して探す。
  const caseFold = haystack.length === joined.length && needle.length === query.length
  const text = caseFold ? haystack : joined
  const target = caseFold ? needle : query

  const starts: number[] = []
  let total = 0
  for (const segment of segments) {
    starts.push(total)
    total += segment.length
  }

  const matches: TextMatch[] = []
  for (let index = text.indexOf(target); index !== -1; index = text.indexOf(target, index + target.length)) {
    matches.push({ start: locate(starts, index, false), end: locate(starts, index + target.length, true) })
  }
  return matches
}

/**
 * 連結後の位置をノード内の位置に戻す。ノードの境目にあたる位置は、
 * 始点なら後ろのノードの先頭、終点なら前のノードの末尾として扱う（空のノードは選ばない）。
 */
function locate(starts: readonly number[], position: number, isEnd: boolean): TextPosition {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const start = starts[mid] ?? 0
    const before = isEnd ? start < position : start <= position
    if (before) low = mid
    else high = mid - 1
  }
  return { segment: low, offset: position - (starts[low] ?? 0) }
}
