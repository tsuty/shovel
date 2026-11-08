import type { SessionUpdate } from '@agentclientprotocol/sdk'

/** ターンの外で届いたとき、エージェントが作業しているとみなす更新。 */
const WORK_UPDATES = new Set<SessionUpdate['sessionUpdate']>([
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan'
])

export interface AfterTurnHandlers {
  /** ターンの外で作業が始まった。 */
  onStart: () => void
  /** ターンの外の作業が途切れた（または次のターン・タブを閉じる前にまとめて終えた）。 */
  onSettle: () => void
}

/**
 * ターンの外（`session/prompt` の応答の後）に届く更新を見張る。作業の更新が届いたら `onStart`、
 * `settleMs` の間なにも届かなければ `onSettle` を呼ぶ。
 */
export class AfterTurnTracker {
  /** ターン中（プロンプトを送ってから、ループがその `stop` を処理するまで）。 */
  private turnOpen = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    private readonly settleMs: number,
    private readonly handlers: AfterTurnHandlers
  ) {}

  /** プロンプトを送る直前。ターンの外の作業が続いていれば先に終える。 */
  turnStarted(): void {
    this.flush()
    this.turnOpen = true
  }

  /** ターンの `stop` を処理した、またはプロンプトが失敗した。 */
  turnEnded(): void {
    this.turnOpen = false
  }

  /** ループが処理した更新。 */
  update(update: SessionUpdate): void {
    if (this.disposed || this.turnOpen || !WORK_UPDATES.has(update.sessionUpdate)) return
    if (this.timer === null) this.handlers.onStart()
    else clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.settleMs)
  }

  /** ターンの外の作業が続いていれば、待たずに終える。 */
  flush(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
    this.handlers.onSettle()
  }

  /** 以降は何も呼ばない。 */
  dispose(): void {
    this.disposed = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
