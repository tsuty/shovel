import type { Bookmark } from '@shared/types/browser'

/**
 * プロジェクト ID ごとのブックマーク（旧形式）を、ホストのパスごとに組み替える。
 *
 * - `existing`: すでにパスごとに保存されている一覧。先に並べる。
 * - `legacy`: プロジェクト ID → ブックマーク。登録の無い ID の分は捨てる。
 * - `hostPathOf`: プロジェクト ID → キーにするパス（`hostPathKey` 済み）。
 *
 * 同じパスに複数のプロジェクトがあった場合はつなげ、同じ URL は最初の 1 件だけ残す。
 */
export function mergeLegacyBookmarks(
  existing: Record<string, Bookmark[]>,
  legacy: Record<string, Bookmark[]>,
  hostPathOf: (projectId: string) => string | undefined
): Record<string, Bookmark[]> {
  const merged: Record<string, Bookmark[]> = {}
  for (const [key, list] of Object.entries(existing)) merged[key] = [...list]
  for (const [projectId, list] of Object.entries(legacy)) {
    const key = hostPathOf(projectId)
    if (key === undefined || !Array.isArray(list)) continue
    const target = merged[key] ?? []
    for (const bookmark of list) {
      if (!target.some((b) => b.url === bookmark.url)) target.push(bookmark)
    }
    if (target.length > 0) merged[key] = target
  }
  return merged
}
