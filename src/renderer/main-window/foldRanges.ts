import type { Code, Heading, Parent, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { DETAILS_PLUGINS } from '../shared/markdownPlugins'

/** 折りたためる範囲。`from`〜`to` は文字列中の位置で、その間が畳まれる。 */
export interface FoldRange {
  /** 範囲が始まる行（1 始まり）。この行に折りたたみの印が付く。 */
  line: number
  from: number
  to: number
}

/** 各行の先頭の位置（0 番目が 1 行目）。 */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

/** 1 始まりの行の末尾（改行の手前）の位置。 */
function lineEnd(text: string, starts: number[], line: number): number {
  const next = starts[line]
  return next === undefined ? text.length : next - 1
}

/**
 * JSON の `{`〜`}` と `[`〜`]` のうち、複数行にわたるもの。括弧の内側を畳む。文字列の中の括弧は数えない。
 * 1 行に開き括弧が複数あるときは、いちばん外側（いちばん後ろで閉じる）のものを使う。
 */
export function jsonFoldRanges(text: string): FoldRange[] {
  const byLine = new Map<number, FoldRange>()
  const stack: { pos: number; line: number }[] = []
  let line = 1
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') {
      line++
      // 文字列は行をまたげないので、閉じ忘れの `"` があっても次の行からは数え直す。
      inString = false
    } else if (inString) {
      if (ch === '\\' && text[i + 1] !== '\n') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    } else if (ch === '{' || ch === '[') {
      stack.push({ pos: i, line })
    } else if (ch === '}' || ch === ']') {
      const open = stack.pop()
      if (!open || open.line === line) continue
      const current = byLine.get(open.line)
      if (!current || current.to < i) byLine.set(open.line, { line: open.line, from: open.pos + 1, to: i })
    }
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line)
}

/**
 * YAML の、続く行のほうが深く字下げされているブロック。`key:` で終わる行は、同じ字下げで続く `- ` の並びも含める。
 * 字下げの浅いコメント行と空行はブロックを途切れさせない（末尾に残ったものは含めない）。
 */
export function yamlFoldRanges(text: string): FoldRange[] {
  // 空行は字下げを -1 とする。
  const rows = text.split('\n').map((line) => {
    const content = line.trim()
    return { indent: content === '' ? -1 : line.length - line.trimStart().length, content }
  })
  const starts = lineStarts(text)
  const ranges: FoldRange[] = []
  for (const [i, { indent, content }] of rows.entries()) {
    if (indent < 0 || content.startsWith('#')) continue
    const opensKey = /:\s*(#.*)?$/.test(content)
    let last = i
    for (let j = i + 1; j < rows.length; j++) {
      const child = rows[j]
      if (!child) break
      if (child.indent < 0) continue
      if (child.indent > indent) last = j
      else if (child.content.startsWith('#')) continue
      else if (opensKey && child.indent === indent && /^-( |$)/.test(child.content)) last = j
      else break
    }
    if (last > i) ranges.push({ line: i + 1, from: lineEnd(text, starts, i + 1), to: lineEnd(text, starts, last + 1) })
  }
  return ranges
}

/** 閉じタグを持たない要素。 */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr'
])

/** 中身をタグとして読まない要素。 */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title'])

/** 位置が何行目か（1 始まり）。 */
function lineAt(starts: number[], pos: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((starts[mid] ?? 0) <= pos) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/** `<` で始まるタグの終わり（`>` の次）。属性値の引用符の中の `>` は数えない。閉じていなければ文字列の末尾。 */
function tagEnd(text: string, from: number): number {
  let quote = ''
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i + 1
    }
  }
  return text.length
}

/**
 * HTML の要素とコメントのうち、複数行にわたるもの。開きタグの `>` の後から閉じタグの手前まで（コメントは `<!--` と
 * `-->` の間）を畳む。1 行に開きタグが複数あるときは、いちばん外側のもの。閉じタグを省いた要素（`<li>` など）・
 * 空要素・`/>` で閉じたものは畳まない。`<script>` / `<style>` などの中身はタグとして読まない。
 */
export function htmlFoldRanges(text: string): FoldRange[] {
  const starts = lineStarts(text)
  const lower = text.toLowerCase()
  const byLine = new Map<number, FoldRange>()
  const add = (start: number, from: number, to: number): void => {
    const line = lineAt(starts, start)
    if (line === lineAt(starts, to)) return
    const current = byLine.get(line)
    if (!current || current.to < to) byLine.set(line, { line, from, to })
  }
  const stack: { name: string; start: number; end: number }[] = []
  let i = text.indexOf('<')
  while (i >= 0 && i < text.length) {
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4)
      if (close < 0) break
      add(i, i + 4, close)
      i = text.indexOf('<', close + 3)
      continue
    }
    const closing = text[i + 1] === '/'
    const match = /^[a-zA-Z][^\s/>]*/.exec(text.slice(closing ? i + 2 : i + 1, i + 80))
    if (!match) {
      // `<!DOCTYPE>`・`<?xml ?>` や、タグでない `<`。
      i = text.indexOf('<', text[i + 1] === '!' || text[i + 1] === '?' ? tagEnd(text, i) : i + 1)
      continue
    }
    const name = match[0].toLowerCase()
    const end = tagEnd(text, i)
    if (closing) {
      let k = stack.length - 1
      while (k >= 0 && stack[k]?.name !== name) k--
      if (k >= 0) {
        const open = stack[k]
        stack.length = k
        if (open) add(open.start, open.end, i)
      }
    } else if (!VOID_ELEMENTS.has(name) && text[end - 2] !== '/') {
      stack.push({ name, start: i, end })
      if (RAW_TEXT_ELEMENTS.has(name)) {
        const close = lower.indexOf(`</${name}`, end)
        i = close < 0 ? -1 : close
        continue
      }
    }
    i = text.indexOf('<', end)
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line)
}

const markdownProcessor = unified().use(remarkParse).use(DETAILS_PLUGINS)

/**
 * Markdown の見出しとフェンスのコードブロック。見出しは次の同じか上のレベルの見出しの手前まで（末尾の空行は除く）、
 * コードブロックは開きのフェンスの行末から閉じのフェンスまでを畳む。見出しはアウトラインと同じプラグインで解析する。
 */
export function markdownFoldRanges(text: string): FoldRange[] {
  const tree = markdownProcessor.runSync(markdownProcessor.parse(text)) as Root
  const headings: Heading[] = []
  const codes: Code[] = []
  const walk = (node: Parent): void => {
    for (const child of node.children) {
      if (child.type === 'heading') headings.push(child)
      else if (child.type === 'code') codes.push(child)
      else if ('children' in child) walk(child)
    }
  }
  walk(tree)

  const starts = lineStarts(text)
  const isBlank = (line: number): boolean => text.slice(starts[line - 1] ?? 0, lineEnd(text, starts, line)).trim() === ''
  const byLine = new Map<number, FoldRange>()

  headings.forEach((heading, index) => {
    const position = heading.position
    if (!position) return
    const next = headings.slice(index + 1).find((h) => h.depth <= heading.depth)
    let last = next?.position ? next.position.start.line - 1 : starts.length
    while (last > position.end.line && isBlank(last)) last--
    if (last <= position.end.line) return
    byLine.set(position.start.line, {
      line: position.start.line,
      from: lineEnd(text, starts, position.end.line),
      to: lineEnd(text, starts, last)
    })
  })

  for (const code of codes) {
    const position = code.position
    if (!position || position.end.line - position.start.line < 2) continue
    const offset = position.start.offset
    if (offset === undefined || !/^(```|~~~)/.test(text.slice(offset, offset + 3))) continue
    if (byLine.has(position.start.line)) continue
    byLine.set(position.start.line, {
      line: position.start.line,
      from: lineEnd(text, starts, position.start.line),
      to: lineEnd(text, starts, position.end.line)
    })
  }

  return [...byLine.values()].sort((a, b) => a.line - b.line)
}
