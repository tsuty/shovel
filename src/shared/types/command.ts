/** コマンド実行パネルの IPC 契約。ui.md §12 / decisions.md N-4。 */

export interface CommandOutputChunk {
  runId: string
  stream: 'stdout' | 'stderr'
  text: string
}

export interface CommandExit {
  runId: string
  code: number | null
}
