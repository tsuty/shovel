import { app } from 'electron'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { mkdir, readdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { safeProjectSegment } from './persistence/snapshot'

/** ACP トラフィックログとエージェントの stderr。フォーマット: `{ms} {OUT|IN} {raw JSON}`。 */

function logsRootDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

/** プロジェクトごとのログディレクトリ（`userData/logs/{projectId}`）。無ければ作る。 */
export function logsDir(projectId: string): string {
  const dir = path.join(logsRootDir(), safeProjectSegment(projectId))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 以前の保存形式（`logs/{ms}_{projectId}_{sessionId}.log`）の旧ファイル名。 */
const FLAT_LOG_RE = /^(\d+)_([^_]+)_(.+\.log)$/

/**
 * 旧形式（`userData/logs` 直下）のログを、プロジェクトごとのディレクトリへ
 * `{ms}_{sessionId}.log` として移す。移し先に同名があれば触らない。
 */
export async function migrateFlatLogs(): Promise<void> {
  const root = logsRootDir()
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return
  }
  for (const name of names) {
    const m = FLAT_LOG_RE.exec(name)
    if (!m) continue
    try {
      const from = path.join(root, name)
      if (!(await stat(from)).isFile()) continue
      const dir = path.join(root, safeProjectSegment(m[2]!))
      const to = path.join(dir, `${m[1]}_${m[3]}`)
      if (await stat(to).then(() => true, () => false)) continue
      await mkdir(dir, { recursive: true })
      await rename(from, to)
    } catch (err) {
      console.warn(`[log] could not migrate ${name}; leaving it in place`, err)
    }
  }
}

const RING_BUFFER_LIMIT = 500

export class SessionLogger {
  private readonly stream: WriteStream
  private readonly stderrRing: string[] = []

  /** プロジェクトのディレクトリに `{ms}_{sessionId}.log` として書く。 */
  constructor(
    readonly sessionId: string,
    readonly projectId: string
  ) {
    const file = path.join(logsDir(projectId), `${Date.now()}_${sessionId}.log`)
    this.stream = createWriteStream(file, { flags: 'a' })
  }

  logRpc(direction: 'OUT' | 'IN', raw: string): void {
    this.stream.write(`${Date.now()} ${direction} ${raw}\n`)
  }

  /** デバッグ用の補足（`{ms} DEBUG {text}`）。 */
  logDebug(text: string): void {
    this.stream.write(`${Date.now()} DEBUG ${text}\n`)
  }

  logStderr(text: string): void {
    this.stream.write(`${Date.now()} STDERR ${text}\n`)
    this.stderrRing.push(text)
    if (this.stderrRing.length > RING_BUFFER_LIMIT) this.stderrRing.shift()
  }

  recentStderr(): string {
    return this.stderrRing.join('\n')
  }

  close(): void {
    this.stream.end()
  }
}
