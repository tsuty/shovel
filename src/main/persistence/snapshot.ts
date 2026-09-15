import { app } from 'electron'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SessionSnapshot } from '@shared/types/session'

/**
 * セッションのトランスクリプトスナップショット。data-model.md §3 / F-2。
 * 「表示を速くし、エージェントが履歴を持たないときの劣化を防ぐ派生物」であり、
 * 消えても動作は壊れない。保存先はプロジェクトツリーの外
 * （`userData/snapshots`）、書き込みは一時ファイル経由のアトミックな move。
 */

const SCHEMA_VERSION = 1 as const

function snapshotDir(): string {
  return path.join(app.getPath('userData'), 'snapshots')
}

function snapshotPath(sessionId: string): string {
  return path.join(snapshotDir(), `${sessionId}.json`)
}

export async function saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
  const dir = snapshotDir()
  await mkdir(dir, { recursive: true })
  const finalPath = snapshotPath(snapshot.sessionId)
  const tmpPath = path.join(dir, `.${snapshot.sessionId}.${randomUUID()}.tmp`)
  await writeFile(tmpPath, JSON.stringify(snapshot), 'utf8')
  await rename(tmpPath, finalPath)
}

export async function loadSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
  try {
    const raw = await readFile(snapshotPath(sessionId), 'utf8')
    const parsed = JSON.parse(raw) as SessionSnapshot
    // 移行経路の無いバージョンは「履歴なし」として破棄する（読み込み失敗で
    // 接続そのものを壊さないため）。
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export async function deleteSnapshot(sessionId: string): Promise<void> {
  await rm(snapshotPath(sessionId), { force: true })
}

/**
 * flows.md §6「名前変更: ACP に session/rename が無いため、shovel 側に
 * タイトルの上書きを保存し…」。永続化済みのスナップショットがあれば、その
 * `title` も書き換えておく（履歴一覧が次のターンを待たずに新しい名前を
 * 表示できるように）。スナップショットがまだ無いセッションは何もしない
 * （呼び出し側の `sessionTitleStore` への保存だけで、次回保存時に反映される）。
 */
export async function renameSnapshotTitle(sessionId: string, title: string): Promise<void> {
  const existing = await loadSnapshot(sessionId)
  if (!existing) return
  await saveSnapshot({ ...existing, title })
}

export async function listSnapshotsForProject(projectId: string): Promise<SessionSnapshot[]> {
  const dir = snapshotDir()
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const snapshots: SessionSnapshot[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.startsWith('.')) continue
    try {
      const raw = await readFile(path.join(dir, entry), 'utf8')
      const parsed = JSON.parse(raw) as SessionSnapshot
      if (parsed.schemaVersion === SCHEMA_VERSION && parsed.projectId === projectId) {
        snapshots.push(parsed)
      }
    } catch {
      // 壊れたスナップショットは無視する。
    }
  }
  return snapshots.sort((a, b) => b.savedAt - a.savedAt)
}
