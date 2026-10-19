import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { RestoredTab, SavedTab } from '@shared/types/session'
import { openTabsStore, projectsStore } from '../persistence/store'
import { parseRecordName, readLocalRecord } from '../persistence/snapshot'

/**
 * プロジェクトのウィンドウで開いていたタブの保存と復元。
 * 復元では、消えたファイル・記録のタブを何も言わずに外す。
 */

export function saveOpenTabs(projectId: string, tabs: SavedTab[]): void {
  if (!projectsStore.list().some((p) => p.id === projectId)) return
  openTabsStore.set(projectId, Array.isArray(tabs) ? tabs : [])
}

export async function restoreOpenTabs(projectId: string): Promise<RestoredTab[]> {
  const project = projectsStore.list().find((p) => p.id === projectId)
  if (!project) return []

  /** プロジェクト内にある通常のファイルなら true。 */
  async function isExistingFile(relPath: string | undefined): Promise<boolean> {
    if (!relPath) return false
    const abs = path.join(project!.hostPath, relPath)
    if (path.relative(project!.hostPath, abs).startsWith('..')) return false
    return (await stat(abs).catch(() => null))?.isFile() ?? false
  }

  async function attachedFileOf(saved: { attachedFile?: string }): Promise<string | undefined> {
    return (await isExistingFile(saved.attachedFile)) ? saved.attachedFile : undefined
  }

  async function restoreOne(saved: SavedTab): Promise<RestoredTab | null> {
    switch (saved.kind) {
      case 'file':
        return (await isExistingFile(saved.relPath)) ? { kind: 'file', relPath: saved.relPath } : null
      case 'record': {
        const parsed = parseRecordName(saved.fileName)
        if (!parsed) return null
        const snapshot = await readLocalRecord(projectId, saved.fileName)
        if (!snapshot) return null
        const attachedFile = await attachedFileOf(saved)
        if (parsed.kind === 'current') {
          // 一度も送信していないセッションの記録は開き直さない。
          if (snapshot.entries.length === 0) return null
          return { kind: 'history', snapshot, attachedFile }
        }
        return {
          kind: 'history',
          snapshot,
          readOnly: { kind: parsed.kind, timestamp: parsed.epochMillis ?? 0, fileName: saved.fileName },
          attachedFile
        }
      }
      case 'agentOnly':
        return {
          kind: 'history',
          snapshot: {
            schemaVersion: 1,
            sessionId: saved.key,
            acpSessionId: saved.acpSessionId,
            projectId,
            title: saved.title,
            savedAt: saved.savedAt,
            entries: []
          },
          agentOnly: true,
          attachedFile: await attachedFileOf(saved)
        }
      default:
        return null
    }
  }

  const restored = await Promise.all(openTabsStore.get(projectId).map((saved) => restoreOne(saved).catch(() => null)))
  return restored.filter((tab): tab is RestoredTab => tab !== null)
}
