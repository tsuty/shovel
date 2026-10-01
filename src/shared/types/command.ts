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
