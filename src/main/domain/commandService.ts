import { randomUUID } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { sbxSpawnInteractive } from '../sbx/cli'
import { projectsStore, commandHistoryStore } from '../persistence/store'
import type { Project } from '@shared/types/project'

/**
 * コマンド実行パネル（下付き）。decisions.md N-4: `sbx exec -i`（TTY なし）＋
 * 入力欄＋中断ボタン。`vim` 等の全画面アプリは動かない。ユーザーが打つコマンドは
 * シェル構文（`&&` 等）を使いたいはずなので、サンドボックス**内**の `/bin/sh -lc`
 * に丸ごと渡す。host 側では `spawn(..., { shell: false })` のままであり
 * （architecture.md §3 の禁止事項はホストでシェル文字列を組み立てないことを指す）、
 * シェル解釈はサンドボックス内で完結する。
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

export function commandHistory(projectId: string): string[] {
  return commandHistoryStore.get(projectId)
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '')
}
