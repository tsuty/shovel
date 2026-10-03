import { randomUUID } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { sbxSpawnInteractive } from '../sbx/cli'
import { projectsStore, commandHistoryStore } from '../persistence/store'
import type { Project } from '@shared/types/project'
import type { CommandHistory } from '@shared/types/command'

/**
 * コマンド実行パネルのバックエンド。入力されたコマンドを `sbx exec -i` でサンドボックス内の
 * `/bin/sh -lc` に渡して実行し、出力を流す。
 */

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[a-zA-Z]/g

interface RunState {
  child: ChildProcessWithoutNullStreams
  projectId: string
}

const runs = new Map<string, RunState>()

export interface CommandCallbacks {
  onOutput: (stream: 'stdout' | 'stderr', text: string) => void
  onExit: (code: number | null) => void
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
  runs.set(runId, { child, projectId })

  child.stdout.on('data', (d: Buffer) => callbacks.onOutput('stdout', stripAnsi(d.toString('utf8'))))
  child.stderr.on('data', (d: Buffer) => callbacks.onOutput('stderr', stripAnsi(d.toString('utf8'))))
  child.on('close', (code) => {
    runs.delete(runId)
    callbacks.onExit(code)
  })

  return runId
}

export function sendInput(runId: string, text: string): void {
  const run = runs.get(runId)
  if (!run) return
  run.child.stdin.write(text)
}

export function cancelRun(runId: string): void {
  const run = runs.get(runId)
  if (!run) return
  run.child.kill()
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
