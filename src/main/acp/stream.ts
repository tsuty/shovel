import { Readable, Writable } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AnyMessage, Stream } from '@agentclientprotocol/sdk'
import type { SessionLogger } from '../log'

const CARRIAGE_RETURN = 0x0d

/**
 * `\r` バイトを取り除く。architecture.md §3: 「行分割は \r\n と \n の
 * 両方を許容する」。ACP SDK の `ndJsonStream` は `\n` のみで区切り、末尾の
 * `\r` を落とさない（line-buffer.js を確認済み）ため、`\r` を含む行を渡すと
 * 各行の末尾に不可視の `\r` が残り `JSON.parse` が失敗する。JSON 文字列内に
 * 生の `\r` バイトが現れることは仕様上ない（エスケープが必須）ため、
 * ストリーム全体から無条件に取り除いても安全。
 */
function stripCarriageReturns(): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    transform(chunk, controller) {
      let hasCR = false
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === CARRIAGE_RETURN) {
          hasCR = true
          break
        }
      }
      if (!hasCR) {
        controller.enqueue(chunk)
        return
      }
      const filtered = new Uint8Array(chunk.length)
      let j = 0
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i] as number
        if (byte !== CARRIAGE_RETURN) filtered[j++] = byte
      }
      controller.enqueue(filtered.subarray(0, j))
    }
  })
}

/** stdout のバイトが届くたびに呼ばれる。initialize のアイドルタイムアウト計測に使う。 */
function trackActivity(onActivity: () => void): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    transform(chunk, controller) {
      onActivity()
      controller.enqueue(chunk)
    }
  })
}

export interface BuildAcpStreamOptions {
  child: ChildProcessWithoutNullStreams
  logger: SessionLogger
  ndJsonStream: (output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>) => Stream
  onStdoutActivity: () => void
  /** 受信した JSON-RPC メッセージごとに、SDK に渡す前に呼ばれる。 */
  onIncomingMessage?: (message: AnyMessage) => void
}

/**
 * 子プロセス（`sbx exec -i <sandbox> npx -y <acpPackage>`）の stdio から
 * ACP の `Stream` を組み立てる。stdout のみを ACP パーサへ渡し、stderr は
 * 別途 `SessionLogger` に流す（architecture.md §3「stdout のみを ACP パーサへ
 * 渡す。stderr は分離」）。送受信された JSON-RPC メッセージはすべて
 * `SessionLogger.logRpc` に記録する（N-2-6 の診断情報の材料）。
 */
export function buildAcpStream(opts: BuildAcpStreamOptions): Stream {
  const { child, logger, ndJsonStream, onStdoutActivity, onIncomingMessage } = opts

  child.stderr.on('data', (d: Buffer) => logger.logStderr(d.toString('utf8')))

  const rawReadable = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
  const cleanedReadable = rawReadable
    .pipeThrough(trackActivity(onStdoutActivity))
    .pipeThrough(stripCarriageReturns())
  const rawWritable = Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>

  const inner = ndJsonStream(rawWritable, cleanedReadable)

  const loggedReadable = inner.readable.pipeThrough(
    new TransformStream<AnyMessage, AnyMessage>({
      transform(message, controller) {
        logger.logRpc('IN', JSON.stringify(message))
        onIncomingMessage?.(message)
        controller.enqueue(message)
      }
    })
  )

  const innerWriter = inner.writable.getWriter()
  const loggedWritable = new WritableStream<AnyMessage>({
    write(message) {
      logger.logRpc('OUT', JSON.stringify(message))
      return innerWriter.write(message)
    },
    close() {
      return innerWriter.close()
    },
    abort(reason) {
      return innerWriter.abort(reason)
    }
  })

  return { readable: loggedReadable, writable: loggedWritable }
}
