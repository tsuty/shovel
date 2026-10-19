import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { sentenceAround } from '@shared/plainText'
import {
  FILE_SEARCH_MAX_RESULTS,
  type FileNameMatch,
  type FileSearchResult,
  type FileSearchResults
} from '@shared/types/filer'
import { decodeText } from './textEncoding'

/**
 * ファイラーの検索。ホスト側の Node `fs` でフォルダを浅い階層から順にたどり、
 * ファイル名と、UTF-8 のテキストファイルのコンテンツに、大文字小文字を無視した部分一致をかける。
 */

/** これより大きいファイルは読まない（ログやデータのダンプで固まらないように）。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024

function isSkippedDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

/** ファイル名の一致箇所を探す。無ければ null。 */
export function findNameMatch(name: string, needle: string): Omit<FileNameMatch, 'relPath'> | null {
  const lower = name.toLowerCase()
  // toLowerCase で長さが変わる文字が混ざるときは元の文字列のまま探す。
  const start = (lower.length === name.length ? lower : name).indexOf(needle)
  return start < 0 ? null : { start, length: needle.length }
}

/** ファイルのコンテンツから最初の一致を探す。無ければ null。 */
export function findFirstMatch(content: string, needle: string): Omit<FileSearchResult, 'relPath'> | null {
  const lower = content.toLowerCase()
  // toLowerCase で長さが変わる文字が混ざるときは元の文字列のまま探す。
  const haystack = lower.length === content.length ? lower : content
  const index = haystack.indexOf(needle)
  if (index < 0) return null
  const lineStart = content.lastIndexOf('\n', index - 1) + 1
  const newline = content.indexOf('\n', index)
  const lineText = content.slice(lineStart, newline === -1 ? content.length : newline)
  let line = 1
  for (let i = content.indexOf('\n'); i !== -1 && i < index; i = content.indexOf('\n', i + 1)) line++
  return {
    line,
    column: index - lineStart + 1,
    length: needle.length,
    snippet: sentenceAround(lineText, index - lineStart, needle.length)
  }
}

/**
 * `rootAbs`（プロジェクトルート）配下の `scopeRelPath` を探す。`isLatest` が false になったら
 * 途中でやめて null を返す（新しい検索に追い越されたとき）。ファイル名・コンテンツとも最大件数に
 * 達したらそこで終える。
 */
export async function searchDirectory(
  rootAbs: string,
  scopeRelPath: string,
  query: string,
  isLatest: () => boolean
): Promise<FileSearchResults | null> {
  const needle = query.trim().toLowerCase()
  const names: FileNameMatch[] = []
  const contents: FileSearchResult[] = []
  if (!needle) return { names, contents }

  const queue = [scopeRelPath]
  while (queue.length > 0) {
    const dirRel = queue.shift()!
    let entries
    try {
      entries = await readdir(path.join(rootAbs, dirRel), { withFileTypes: true })
    } catch {
      // 読めないフォルダは飛ばす。
      continue
    }
    if (!isLatest()) return null
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const relPath = dirRel ? `${dirRel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name)) queue.push(relPath)
        continue
      }
      if (!entry.isFile()) continue
      if (names.length < FILE_SEARCH_MAX_RESULTS) {
        const nameMatch = findNameMatch(entry.name, needle)
        if (nameMatch) names.push({ relPath, ...nameMatch })
      }
      if (contents.length < FILE_SEARCH_MAX_RESULTS) {
        const match = await searchContent(path.join(rootAbs, relPath), needle)
        if (!isLatest()) return null
        if (match) contents.push({ relPath, ...match })
      }
      if (names.length >= FILE_SEARCH_MAX_RESULTS && contents.length >= FILE_SEARCH_MAX_RESULTS) {
        return { names, contents }
      }
    }
  }
  return { names, contents }
}

/** 1ファイルのコンテンツから最初の一致を探す。読まないファイル・消えた・読めないファイルは null。 */
async function searchContent(absPath: string, needle: string): Promise<Omit<FileSearchResult, 'relPath'> | null> {
  try {
    if ((await stat(absPath)).size > MAX_FILE_BYTES) return null
    const decoded = decodeText(await readFile(absPath))
    if (decoded.kind !== 'text' || (decoded.encoding !== 'UTF-8' && decoded.encoding !== 'UTF-8 BOM')) return null
    return findFirstMatch(decoded.content, needle)
  } catch {
    return null
  }
}
