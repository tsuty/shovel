import Store from 'electron-store'
import type { Project } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'

/**
 * `electron-store`（JSON）に保存するもの。data-model.md §5 / decisions.md F-2。
 * SQLite は使わない。セッションのスナップショット本体は個別 JSON ファイル
 * （snapshot.ts）に持ち、ここには置かない。
 */
export type { AppSettings }

interface StoreSchema {
  projects: Project[]
  settings: AppSettings
  sessionTitleOverrides: Record<string, string>
  commandHistory: Record<string, string[]>
  sidebar: { widths: Record<string, number> }
}

const defaults: StoreSchema = {
  projects: [],
  settings: {
    locale: null,
    theme: 'system',
    autoAttachActiveFile: false,
    transcriptFontSize: 14
  },
  sessionTitleOverrides: {},
  commandHistory: {},
  sidebar: { widths: {} }
}

// electron-store の型定義は CommonJS デフォルトエクスポートと相性が悪いため any 経由にする。
const store = new (Store as any)({ defaults }) as {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K]
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void
}

export const projectsStore = {
  list(): Project[] {
    return store.get('projects')
  },
  save(projects: Project[]): void {
    store.set('projects', projects)
  },
  upsert(project: Project): void {
    const list = store.get('projects')
    const idx = list.findIndex((p) => p.id === project.id)
    if (idx >= 0) list[idx] = project
    else list.push(project)
    store.set('projects', list)
  },
  remove(id: string): void {
    store.set(
      'projects',
      store.get('projects').filter((p) => p.id !== id)
    )
  }
}

export const settingsStore = {
  get(): AppSettings {
    return store.get('settings')
  },
  set(patch: Partial<AppSettings>): AppSettings {
    const next = { ...store.get('settings'), ...patch }
    store.set('settings', next)
    return next
  }
}

export const sessionTitleStore = {
  get(sessionId: string): string | undefined {
    return store.get('sessionTitleOverrides')[sessionId]
  },
  set(sessionId: string, title: string): void {
    const map = store.get('sessionTitleOverrides')
    map[sessionId] = title
    store.set('sessionTitleOverrides', map)
  },
  remove(sessionId: string): void {
    const map = store.get('sessionTitleOverrides')
    delete map[sessionId]
    store.set('sessionTitleOverrides', map)
  }
}

export const commandHistoryStore = {
  get(projectId: string): string[] {
    return store.get('commandHistory')[projectId] ?? []
  },
  push(projectId: string, command: string): void {
    const map = store.get('commandHistory')
    const list = map[projectId] ?? []
    const next = [command, ...list.filter((c) => c !== command)].slice(0, 100)
    map[projectId] = next
    store.set('commandHistory', map)
  }
}

export const sidebarStore = {
  getWidths(): Record<string, number> {
    return store.get('sidebar').widths
  },
  setWidth(panel: string, width: number): void {
    const sidebar = store.get('sidebar')
    sidebar.widths[panel] = width
    store.set('sidebar', sidebar)
  }
}
