import { app } from 'electron'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import path from 'node:path'

/**
 * ACP トラフィックログとエージェントの stderr。data-model.md §5 /
 * decisions.md N-2-6「診断情報画面」の材料になる。
 * SAC 方式のフォーマット: `{ms} {OUT|IN} {raw JSON}`。
 */

function logsDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  return dir
}

const RING_BUFFER_LIMIT = 500

export class SessionLogger {
  private readonly stream: WriteStream
  private readonly stderrRing: string[] = []

  constructor(readonly sessionId: string) {
    const file = path.join(logsDir(), `${Date.now()}_${sessionId}.log`)
    this.stream = createWriteStream(file, { flags: 'a' })
  }

  logRpc(direction: 'OUT' | 'IN', raw: string): void {
    this.stream.write(`${Date.now()} ${direction} ${raw}\n`)
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
