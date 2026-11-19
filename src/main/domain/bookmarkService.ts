import { isWebUrl } from '@shared/browserUrl'
import type { Bookmark } from '@shared/types/browser'
import { bookmarksStore, projectsStore } from '../persistence/store'
import { mergeLegacyBookmarks } from './bookmarkMigration'
import { hostPathKey } from './pathTranslate'

/** ブラウザのブックマークの読み書き。プロジェクトのホストのパスごとに持つ。 */

let migrated = false

/** 旧形式（プロジェクト ID ごと）が残っていれば、パスごとに移してから消す。 */
function migrateLegacyOnce(): void {
  if (migrated) return
  migrated = true
  const legacy = bookmarksStore.getLegacy()
  if (!legacy) return
  const projects = projectsStore.list()
  const merged = mergeLegacyBookmarks(bookmarksStore.getAll(), legacy, (projectId) => {
    const project = projects.find((p) => p.id === projectId)
    return project ? hostPathKey(project.hostPath) : undefined
  })
  bookmarksStore.replaceAll(merged)
  bookmarksStore.deleteLegacy()
}

function keyForProject(projectId: string): string | undefined {
  const project = projectsStore.list().find((p) => p.id === projectId)
  return project ? hostPathKey(project.hostPath) : undefined
}

export function listBookmarks(projectId: string): Bookmark[] {
  migrateLegacyOnce()
  const key = keyForProject(projectId)
  return key === undefined ? [] : bookmarksStore.get(key)
}

/** 一覧をまるごと置き換える。開けない URL・形の崩れた項目は捨てる。 */
export function saveBookmarks(projectId: string, bookmarks: Bookmark[]): Bookmark[] {
  migrateLegacyOnce()
  const key = keyForProject(projectId)
  if (key === undefined) return []
  const valid = (Array.isArray(bookmarks) ? bookmarks : []).flatMap((b) =>
    typeof b.id === 'string' && typeof b.title === 'string' && typeof b.url === 'string' && isWebUrl(b.url)
      ? [{ id: b.id, title: b.title, url: b.url }]
      : []
  )
  bookmarksStore.set(key, valid)
  return valid
}
