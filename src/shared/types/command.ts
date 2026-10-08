/** コマンド実行パネルの IPC 契約。 */

export interface CommandOutputChunk {
  runId: string
  stream: 'stdout' | 'stderr'
  text: string
}

/** TTY モードの出力。PTY を通ったバイト列のまま。 */
export interface CommandTtyOutput {
  runId: string
  data: Uint8Array
}

export interface CommandExit {
  runId: string
  code: number | null
  /** TTY モードで、サンドボックスに `python3` が無く始められなかったとき true。 */
  ttyUnavailable?: boolean
}

/** コマンド履歴。`pinned` はピン留め（最大10件・並びは固定）、`recent` は MRU の直近20件。両者は重複しない。 */
export interface CommandHistory {
  pinned: string[]
  recent: string[]
}
