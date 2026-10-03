import Store from 'electron-store'
import type { Project } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
import type { AcpRegistryEntry } from '@shared/acpVersion'
import type { CommandHistory } from '@shared/types/command'

/** `electron-store`（JSON）に保存する設定・プロジェクト・履歴。 */
export type { AppSettings }

interface StoreSchema {
  projects: Project[]
  settings: AppSettings
  sessionTitleOverrides: Record<string, string>
  commandHistory: Record<string, string[]>
  /** ピン留めしたコマンド。`commandHistory` とは重複しない。 */
  pinnedCommands: Record<string, string[]>
  sidebar: { widths: Record<string, number> }
  lastPickedDirectory: string | null
  /** ACP レジストリから読んだ、パッケージ名ごとの表示名と最新バージョン。 */
  acpRegistryEntries: Record<string, AcpRegistryEntry>
}

const defaults: StoreSchema = {
  projects: [],
  settings: {
    locale: null,
    theme: 'system',
    autoAttachActiveFile: false,
    transcriptFontSize: 14,
    editorFontSize: 14,
    sendKey: 'enter'
  },
  sessionTitleOverrides: {},
  commandHistory: {},
  pinnedCommands: {},
  sidebar: { widths: {} },
  lastPickedDirectory: null,
  acpRegistryEntries: {}
}

const store = new Store<StoreSchema>({ defaults })

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
  // 読み出し時に、欠けている設定項目を既定値で埋める。
  get(): AppSettings {
    return { ...defaults.settings, ...store.get('settings') }
  },
  set(patch: Partial<AppSettings>): AppSettings {
    const next = { ...defaults.settings, ...store.get('settings'), ...patch }
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

/** コマンド履歴。プロジェクト単位・コマンド文字列のみ・MRU・最新20件。 */
export const COMMAND_HISTORY_LIMIT = 20
/** ピン留めの上限。ピン留めは `COMMAND_HISTORY_LIMIT` の外で、押し出されない。 */
export const PINNED_COMMAND_LIMIT = 10

export const commandHistoryStore = {
  get(projectId: string): CommandHistory {
    return {
      pinned: store.get('pinnedCommands')[projectId] ?? [],
      recent: (store.get('commandHistory')[projectId] ?? []).slice(0, COMMAND_HISTORY_LIMIT)
    }
  },
  push(projectId: string, command: string): void {
    // ピン留め済みのコマンドはピン側の位置のまま動かさない。
    if ((store.get('pinnedCommands')[projectId] ?? []).includes(command)) return
    const map = store.get('commandHistory')
    const list = map[projectId] ?? []
    const next = [command, ...list.filter((c) => c !== command)].slice(0, COMMAND_HISTORY_LIMIT)
    map[projectId] = next
    store.set('commandHistory', map)
  },
  remove(projectId: string, command: string): CommandHistory {
    const map = store.get('commandHistory')
    map[projectId] = (map[projectId] ?? []).filter((c) => c !== command)
    store.set('commandHistory', map)
    return this.get(projectId)
  },
  /** 履歴からピン留めへ移す（末尾に追加）。上限に達していたら何もしない。 */
  pin(projectId: string, command: string): CommandHistory {
    const pinnedMap = store.get('pinnedCommands')
    const pinned = pinnedMap[projectId] ?? []
    if (pinned.includes(command) || pinned.length >= PINNED_COMMAND_LIMIT) return this.get(projectId)
    pinnedMap[projectId] = [...pinned, command]
    store.set('pinnedCommands', pinnedMap)
    const map = store.get('commandHistory')
    map[projectId] = (map[projectId] ?? []).filter((c) => c !== command)
    store.set('commandHistory', map)
    return this.get(projectId)
  },
  /** ピン留めを外し、履歴の先頭に戻す（削除はしない）。 */
  unpin(projectId: string, command: string): CommandHistory {
    const pinnedMap = store.get('pinnedCommands')
    const pinned = pinnedMap[projectId] ?? []
    if (!pinned.includes(command)) return this.get(projectId)
    pinnedMap[projectId] = pinned.filter((c) => c !== command)
    store.set('pinnedCommands', pinnedMap)
    const map = store.get('commandHistory')
    map[projectId] = [command, ...(map[projectId] ?? []).filter((c) => c !== command)].slice(0, COMMAND_HISTORY_LIMIT)
    store.set('commandHistory', map)
    return this.get(projectId)
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

/**
 * フォルダ選択ダイアログで前回開いていた場所。Electron 43 以降は `defaultPath` を
 * 渡さないと毎回ダウンロードフォルダから開くため、自前で覚えておく。
 */
export const pickDirectoryStore = {
  get(): string | null {
    return store.get('lastPickedDirectory')
  },
  set(dir: string): void {
    store.set('lastPickedDirectory', dir)
  }
}

/** ACP レジストリで見た表示名と最新バージョンの控え（decisions.md N-2-5b）。 */
export const acpRegistryStore = {
  get(packageName: string): AcpRegistryEntry | undefined {
    return store.get('acpRegistryEntries')[packageName]
  },
  set(packageName: string, entry: AcpRegistryEntry): void {
    const map = store.get('acpRegistryEntries')
    map[packageName] = entry
    store.set('acpRegistryEntries', map)
  }
}
