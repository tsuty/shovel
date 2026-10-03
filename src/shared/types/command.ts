/** コマンド実行パネルの IPC 契約。 */

export interface CommandOutputChunk {
  runId: string
  stream: 'stdout' | 'stderr'
  text: string
}

export interface CommandExit {
  runId: string
  code: number | null
}

/** コマンド履歴。`pinned` はピン留め（最大10件・並びは固定）、`recent` は MRU の直近20件。両者は重複しない。 */
export interface CommandHistory {
  pinned: string[]
  recent: string[]
}
