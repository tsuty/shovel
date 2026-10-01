import type { LocalRecordKind, LocalSearchResult } from '@shared/types/session'
import { markdownToPlainText, sentenceAround } from '@shared/plainText'
import { readRecordsForProject } from '../persistence/snapshot'

/**
 * プロジェクトの全ローカル記録（`.json`・`.backup`、指定があれば `.deleted` も）を対象に、
 * Markdown 記法を落とした平文へ大文字小文字を無視した部分一致をかける。
 *
 * 呼び出し元（webContents）ごとに世代番号を持ち、ファイルを1つ読むたびに自分が最新か確かめる。
 * 追い越された検索は null を返す。
 */

const MAX_RESULTS = 100

const latestSearch = new Map<number, number>()

export async function searchLocalRecords(
  callerId: number,
  projectId: string,
  query: string,
  includeDeleted: boolean
): Promise<LocalSearchResult[] | null> {
  const token = (latestSearch.get(callerId) ?? 0) + 1
  latestSearch.set(callerId, token)
  const isLatest = (): boolean => latestSearch.get(callerId) === token

  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const kinds = new Set<LocalRecordKind>(includeDeleted ? ['current', 'backup', 'deleted'] : ['current', 'backup'])
  const records = await readRecordsForProject(projectId, isLatest, kinds)
  if (!isLatest()) return null

  const results: LocalSearchResult[] = []
  for (const { summary, snapshot } of records) {
    let snippet: LocalSearchResult['snippet']
    for (const entry of snapshot.entries) {
      const plain = markdownToPlainText(entry.markdown)
      const lower = plain.toLowerCase()
      // toLowerCase で長さが変わる文字が混ざるときは元の文字列のまま探す。
      const haystack = lower.length === plain.length ? lower : plain
      const index = haystack.indexOf(needle)
      if (index >= 0) {
        snippet = sentenceAround(plain, index, needle.length)
        break
      }
    }
    if (snippet || summary.title.toLowerCase().includes(needle)) {
      results.push({ record: summary, snippet })
    }
  }
  return results.sort((a, b) => b.record.timestamp - a.record.timestamp).slice(0, MAX_RESULTS)
}
