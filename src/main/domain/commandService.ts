import { randomUUID } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { sbxSpawnInteractive } from '../sbx/cli'
import { NO_PYTHON_MARKER, resizeSequence, ttyCommandArgv } from '../sbx/ptyWrapper'
import { projectsStore, commandHistoryStore } from '../persistence/store'
import type { Project } from '@shared/types/project'
import type { CommandHistory } from '@shared/types/command'

/**
 * コマンド実行パネルのバックエンド。入力されたコマンドを `sbx exec -i` でサンドボックス内の
 * `/bin/sh -lc` に渡して実行し、出力を流す。TTY モードではサンドボックス内に PTY を作り、
 * 出力をバイト列のまま流す。
 */

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[a-zA-Z]/g

interface RunState {
  child: ChildProcessWithoutNullStreams
  projectId: string
  tty: boolean
}

/** TTY モードの中断で stdin を閉じてから、`sbx exec` を kill するまでの猶予。 */
const TTY_CANCEL_GRACE_MS = 3000

const runs = new Map<string, RunState>()

export interface CommandCallbacks {
  onOutput: (stream: 'stdout' | 'stderr', text: string) => void
  onExit: (code: number | null) => void
}

export interface TtyCommandCallbacks {
  onData: (data: Uint8Array) => void
  /** `ttyUnavailable` はサンドボックスに `python3` が無く、TTY モードを始められなかったとき true。 */
  onExit: (code: number | null, ttyUnavailable: boolean) => void
}

function requireProject(projectId: string): Project {
  const project = projectsStore.list().find((p) => p.id === projectId)
  if (!project) throw new Error(`project not found: ${projectId}`)
  return project
}

export function runCommand(projectId: string, command: string, callbacks: CommandCallbacks): string {
  const project = requireProject(projectId)
  commandHistoryStore.push(projectId, command)

  const child = sbxSpawnInteractive(project.sandboxName, ['/bin/sh', '-lc', command], {
    cwd: project.sandboxPath
  })
  const runId = randomUUID()
  runs.set(runId, { child, projectId, tty: false })

  child.stdout.on('data', (d: Buffer) => callbacks.onOutput('stdout', stripAnsi(d.toString('utf8'))))
  child.stderr.on('data', (d: Buffer) => callbacks.onOutput('stderr', stripAnsi(d.toString('utf8'))))
  child.on('close', (code) => {
    runs.delete(runId)
    callbacks.onExit(code)
  })

  return runId
}

/** TTY モードで実行する。出力は PTY を通ったバイト列（stdout と stderr が混ざったもの）のまま流す。 */
export function runTtyCommand(
  projectId: string,
  command: string,
  size: { cols: number; rows: number },
  callbacks: TtyCommandCallbacks
): string {
  const project = requireProject(projectId)
  commandHistoryStore.push(projectId, command)

  const child = sbxSpawnInteractive(project.sandboxName, ttyCommandArgv(command, size.cols, size.rows), {
    cwd: project.sandboxPath
  })
  const runId = randomUUID()
  runs.set(runId, { child, projectId, tty: true })

  // stderr に来るのは sbx 自身のエラーと python3 不在の目印だけ（コマンドの stderr は PTY 側に流れる）。
  let stderrText = ''
  child.stdout.on('data', (d: Buffer) => callbacks.onData(new Uint8Array(d)))
  child.stderr.on('data', (d: Buffer) => {
    const text = d.toString('utf8')
    stderrText += text
    const shown = text.replace(new RegExp(`${NO_PYTHON_MARKER}\\r?\\n?`), '')
    if (shown) callbacks.onData(new Uint8Array(Buffer.from(shown.replace(/\r?\n/g, '\r\n'), 'utf8')))
  })
  child.on('close', (code) => {
    runs.delete(runId)
    callbacks.onExit(code, stderrText.includes(NO_PYTHON_MARKER))
  })

  return runId
}

/** TTY モードの端末サイズを変える。 */
export function resizeTty(runId: string, cols: number, rows: number): void {
  const run = runs.get(runId)
  if (!run || !run.tty || !run.child.stdin.writable) return
  run.child.stdin.write(resizeSequence(cols, rows))
}

export function sendInput(runId: string, text: string): void {
  const run = runs.get(runId)
  if (!run || !run.child.stdin.writable) return
  run.child.stdin.write(text)
}

export function cancelRun(runId: string): void {
  const run = runs.get(runId)
  if (!run) return
  if (!run.tty) {
    run.child.kill()
    return
  }
  // stdin を閉じるとラッパーが子に SIGHUP を送る。それでも終わらなければ kill する。
  run.child.stdin.end()
  const timer = setTimeout(() => {
    if (runs.has(runId)) run.child.kill()
  }, TTY_CANCEL_GRACE_MS)
  run.child.once('close', () => clearTimeout(timer))
}

export function commandHistory(projectId: string): CommandHistory {
  return commandHistoryStore.get(projectId)
}

/** 履歴から1件消し、消した後の一覧を返す。 */
export function removeCommandHistory(projectId: string, command: string): CommandHistory {
  return commandHistoryStore.remove(projectId, command)
}

/** 履歴のコマンドをピン留めし、変更後の一覧を返す。 */
export function pinCommand(projectId: string, command: string): CommandHistory {
  return commandHistoryStore.pin(projectId, command)
}

/** ピン留めを外し（履歴の先頭に戻る）、変更後の一覧を返す。 */
export function unpinCommand(projectId: string, command: string): CommandHistory {
  return commandHistoryStore.unpin(projectId, command)
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '')
}
