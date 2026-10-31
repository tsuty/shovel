import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { RestoredTab, SavedPane, SavedTab } from '@shared/types/session'
import { isWebUrl } from '@shared/browserUrl'
import { openTabsStore, projectsStore } from '../persistence/store'
import { parseRecordName, readLocalRecord } from '../persistence/snapshot'

/**
 * プロジェクトのウィンドウで開いていたタブの保存と復元。
 * 復元では、消えたファイル・記録のタブと、開けない URL のブラウザのタブを何も言わずに外す。
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
    const pane = paneOf(saved)
    switch (saved.kind) {
      case 'file':
        return (await isExistingFile(saved.relPath)) ? { kind: 'file', relPath: saved.relPath, pane } : null
      case 'browser':
        return isWebUrl(saved.url) ? { kind: 'browser', url: saved.url, title: String(saved.title), pane } : null
      case 'record': {
        const parsed = parseRecordName(saved.fileName)
        if (!parsed) return null
        const snapshot = await readLocalRecord(projectId, saved.fileName)
        if (!snapshot) return null
        const attachedFile = await attachedFileOf(saved)
        if (parsed.kind === 'current') {
          // 一度も送信していないセッションの記録は開き直さない。
          if (snapshot.entries.length === 0) return null
          return { kind: 'history', snapshot, attachedFile, pane }
        }
        return {
          kind: 'history',
          snapshot,
          readOnly: { kind: parsed.kind, timestamp: parsed.epochMillis ?? 0, fileName: saved.fileName },
          attachedFile,
          pane
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
          attachedFile: await attachedFileOf(saved),
          pane
        }
      default:
        return null
    }
  }

  /** ペインの情報。形が崩れていれば捨てる。 */
  function paneOf(saved: { pane?: SavedPane }): SavedPane | undefined {
    const { pane } = saved
    if (!pane || !Number.isInteger(pane.index) || pane.index < 0 || !(typeof pane.weight === 'number' && pane.weight > 0)) {
      return undefined
    }
    return {
      index: pane.index,
      weight: pane.weight,
      ...(pane.active === true ? { active: true } : {}),
      ...(pane.focused === true ? { focused: true } : {})
    }
  }

  const restored = await Promise.all(openTabsStore.get(projectId).map((saved) => restoreOne(saved).catch(() => null)))
  return restored.filter((tab): tab is RestoredTab => tab !== null)
}
