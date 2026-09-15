import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { SbxExecResult, SbxLsEntry } from './types'
import { SbxCommandError } from './types'

/**
 * `sbx` CLI との唯一の接点。architecture.md §3 / §7 の規則を守る:
 *   - 引数ベクタを直接組み立て、シェルを介さない（shell: false 固定）
 *   - stdout と stderr を分離する
 * すべての呼び出しはこのモジュールを経由させ、`spawn('sbx', ...)` を
 * 他の場所に書かない。
 */

const SBX_BIN = 'sbx'

function run(args: string[], opts: { input?: string; cwd?: string } = {}): Promise<SbxExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(SBX_BIN, args, { shell: false, cwd: opts.cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    child.on('error', (err) => reject(err))
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

export async function sbxDiagnose(): Promise<string> {
  // sbx diagnose は前提条件が欠けているとき非 0 で終了しうるが、その出力こそ
  // 利用者に見せたい内容なので、終了コードに関わらずテキストを返す。
  const result = await run(['diagnose'])
  const parts = [result.stdout.trim()]
  if (result.stderr.trim()) parts.push('--- stderr ---', result.stderr.trim())
  return parts.join('\n')
}

export interface SbxCreateOptions {
  sbxAgent: string
  hostPath: string
  sandboxName: string
  onOutput?: (line: string, stream: 'stdout' | 'stderr') => void
}

/** `sbx create` はイメージ取得で数分かかりうるため、進捗を行単位で流す。 */
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
    child.on('error', reject)
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

/** 非対話でコマンドを実行し、完了を待つ（生存確認・`pwd` の実測・git 実行など）。 */
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

/** 生存確認。終了コードのみで判定する（architecture.md §3）。 */
export async function sbxLivenessCheck(sandboxName: string): Promise<boolean> {
  const result = await sbxExecCapture(sandboxName, ['echo', 'shovel-liveness-check'])
  return result.code === 0
}

/** サンドボックス内のワークスペースパスを実測する（architecture.md §4）。 */
export async function sbxMeasureSandboxPath(sandboxName: string): Promise<string> {
  const result = await sbxExecCapture(sandboxName, ['pwd'])
  if (result.code !== 0) {
    throw new SbxCommandError(`sbx exec ${sandboxName} pwd failed`, result)
  }
  return result.stdout.trim()
}

/**
 * `-i` 付きの対話的な子プロセスを起動する。ACP 接続（stdio を JSON-RPC に）と
 * コマンド実行パネル（TTY なしの対話コンソール）の両方から使う。
 * `-t` は付けない（N-4: TTY の有無が境界）。
 */
export function sbxSpawnInteractive(
  sandboxName: string,
  command: string[],
  opts: { cwd?: string } = {}
): ChildProcessWithoutNullStreams {
  const args = ['exec', '-i']
  if (opts.cwd) args.push('-w', opts.cwd)
  args.push(sandboxName, ...command)
  return spawn(SBX_BIN, args, { shell: false })
}

export async function sbxSecretSet(service: string, value: string): Promise<void> {
  await runOk(['secret', 'set', service], { input: value })
}
