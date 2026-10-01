import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { SbxExecResult, SbxLsEntry } from './types'
import { SbxCommandError } from './types'
import { SBX_NOT_FOUND_MARKER } from '@shared/sbxErrors'

/** `spawn` の 'error' を、renderer で案内文言に差し替えられるマーカー付きの Error へ変換する。 */
function toFriendlyError(err: NodeJS.ErrnoException): Error {
  if (err.code === 'ENOENT') return new Error(SBX_NOT_FOUND_MARKER)
  return err
}

/** `sbx` CLI の呼び出し。引数ベクタを直接渡し（shell: false）、stdout と stderr を分離する。 */

const SBX_BIN = 'sbx'

function run(args: string[], opts: { input?: string; cwd?: string } = {}): Promise<SbxExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(SBX_BIN, args, { shell: false, cwd: opts.cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    child.on('error', (err) => reject(toFriendlyError(err)))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    if (opts.input !== undefined) {
      child.stdin.end(opts.input)
    }
  })
}

async function runOk(args: string[], opts: { input?: string; cwd?: string } = {}): Promise<SbxExecResult> {
  const result = await run(args, opts)
  if (result.code !== 0) {
    throw new SbxCommandError(`sbx ${args.join(' ')} failed with code ${result.code}`, result)
  }
  return result
}

export async function sbxLs(): Promise<SbxLsEntry[]> {
  const result = await runOk(['ls', '--json'])
  const parsed = JSON.parse(result.stdout) as { sandboxes: SbxLsEntry[] }
  return parsed.sandboxes ?? []
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

/** `sbx diagnose` の出力から ANSI エスケープシーケンスを除く。 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, '')
}

export async function sbxDiagnose(): Promise<string> {
  // 終了コードに関わらず出力テキストを返す。
  const result = await run(['diagnose'])
  const parts = [stripAnsi(result.stdout.trim())]
  if (result.stderr.trim()) parts.push('--- stderr ---', stripAnsi(result.stderr.trim()))
  return parts.join('\n')
}

export interface SbxCreateOptions {
  sbxAgent: string
  hostPath: string
  sandboxName: string
  onOutput?: (line: string, stream: 'stdout' | 'stderr') => void
}

/** `sbx create` の進捗を行単位で流す。 */
export function sbxCreate(opts: SbxCreateOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['create', '--name', opts.sandboxName, opts.sbxAgent, opts.hostPath]
    const child = spawn(SBX_BIN, args, { shell: false })
    let stderr = ''
    const forwardLines = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      const text = data.toString('utf8')
      if (stream === 'stderr') stderr += text
      if (!opts.onOutput) return
      for (const line of text.split(/\r\n|\n/)) {
        if (line.length > 0) opts.onOutput(line, stream)
      }
    }
    child.stdout.on('data', forwardLines('stdout'))
    child.stderr.on('data', forwardLines('stderr'))
    child.on('error', (err) => reject(toFriendlyError(err)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new SbxCommandError(`sbx create failed with code ${code}`, { code, stdout: '', stderr }))
    })
  })
}

export async function sbxRm(sandboxName: string): Promise<void> {
  await runOk(['rm', '--force', sandboxName])
}

export async function sbxStop(sandboxName: string): Promise<void> {
  await runOk(['stop', sandboxName])
}

/** 非対話でコマンドを実行し、完了を待つ。 */
export async function sbxExecCapture(
  sandboxName: string,
  command: string[],
  opts: { cwd?: string } = {}
): Promise<SbxExecResult> {
  const args = ['exec']
  if (opts.cwd) args.push('-w', opts.cwd)
  args.push(sandboxName, ...command)
  return run(args)
}

/** 生存確認。終了コードのみで判定する。 */
export async function sbxLivenessCheck(sandboxName: string): Promise<boolean> {
  const result = await sbxExecCapture(sandboxName, ['echo', 'shovel-liveness-check'])
  return result.code === 0
}

/** サンドボックス内のワークスペースパスを実測する。 */
export async function sbxMeasureSandboxPath(sandboxName: string): Promise<string> {
  const result = await sbxExecCapture(sandboxName, ['pwd'])
  if (result.code !== 0) {
    throw new SbxCommandError(`sbx exec ${sandboxName} pwd failed`, result)
  }
  return result.stdout.trim()
}

/** `-i` 付きの対話的な子プロセスを起動する（`-t` は付けない）。 */
export function sbxSpawnInteractive(
  sandboxName: string,
  command: string[],
  opts: { cwd?: string } = {}
): ChildProcessWithoutNullStreams {
  const args = ['exec', '-i']
  if (opts.cwd) args.push('-w', opts.cwd)
  args.push(sandboxName, ...command)
  const child = spawn(SBX_BIN, args, { shell: false })
  // 'error' で main プロセスが落ちないよう、リスナーを付けておく。
  child.on('error', (err) => {
    console.error(`[sbx] failed to spawn "sbx ${args.join(' ')}":`, err)
  })
  return child
}

export async function sbxSecretSet(service: string, value: string): Promise<void> {
  await runOk(['secret', 'set', service], { input: value })
}
