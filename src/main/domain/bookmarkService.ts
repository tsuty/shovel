import { isWebUrl } from '@shared/browserUrl'
import type { Bookmark } from '@shared/types/browser'
import { bookmarksStore, projectsStore } from '../persistence/store'

/** ブラウザのブックマークの読み書き（プロジェクトごと）。 */

export function listBookmarks(projectId: string): Bookmark[] {
  return bookmarksStore.get(projectId)
}

/** 一覧をまるごと置き換える。開けない URL・形の崩れた項目は捨てる。 */
export function saveBookmarks(projectId: string, bookmarks: Bookmark[]): Bookmark[] {
  if (!projectsStore.list().some((p) => p.id === projectId)) return []
  const valid = (Array.isArray(bookmarks) ? bookmarks : []).flatMap((b) =>
    typeof b.id === 'string' && typeof b.title === 'string' && typeof b.url === 'string' && isWebUrl(b.url)
      ? [{ id: b.id, title: b.title, url: b.url }]
      : []
  )
  bookmarksStore.set(projectId, valid)
  return valid
}
