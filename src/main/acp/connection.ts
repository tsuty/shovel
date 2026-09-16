import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  ActiveSessionMessage,
  ClientContext,
  ContentBlock,
  InitializeResponse,
  LoadSessionResponse,
  PromptResponse,
  ResumeSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState
} from '@agentclientprotocol/sdk'
import type { AgentEntry, Project } from '@shared/types/project'
import type {
  ConfigOption,
  SessionCapabilities,
  SessionMeta,
  SessionMode,
  SessionUsage,
  SnapshotEntry
} from '@shared/types/session'
import type { TranscriptEvent } from '@shared/types/transcript'
import { sbxLivenessCheck, sbxSpawnInteractive } from '../sbx/cli'
import { SessionLogger } from '../log'
import { buildAcpStream } from './stream'
import { loadAcpSdk } from './sdk'
import { permissionRequestToEvent, SessionTranslator } from './translate'
import { saveSnapshot } from '../persistence/snapshot'
import { sessionTitleStore } from '../persistence/store'
import { AUTH_REQUIRED_MARKER } from '@shared/authMarker'
import { RESTORE_UNSUPPORTED_MARKER } from '@shared/restoreMarker'

/** `initialize` のアイドルタイムアウト（既定 180 秒）。architecture.md §3。 */
const INITIALIZE_IDLE_TIMEOUT_MS = 180_000

function isAuthRequiredError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === -32000
}
/** `session/prompt` を除く、その他のリクエストの締切。architecture.md §3。 */
const REQUEST_DEADLINE_MS = 120_000

export interface SessionRuntimeCallbacks {
  onEvent: (event: TranscriptEvent) => void
  onMetaChanged: (meta: SessionMeta) => void
  onFatalError: (message: string) => void
}

export interface OpenedSession {
  readonly sessionId: string
  readonly meta: SessionMeta
  readonly logger: SessionLogger
  /**
   * ui.md §7: 添付はプロジェクトルートからの相対パスの配列で渡す。
   * `resource_link` の ContentBlock としてサンドボックス内の絶対パスへ変換して送る
   * （中身は読まない。エージェント自身がサンドボックス内でファイルを読む）。
   */
  prompt(text: string, attachmentRelPaths?: string[]): Promise<void>
  cancel(): Promise<void>
  setMode(modeId: string): Promise<void>
  setConfigOption(configId: string, value: string | boolean): Promise<void>
  resolvePermission(permissionId: string, optionId: string): void
  /**
   * ui.md §3「タブ内コンテンツ上部の ↻ は、今の接続を再利用して session/new
   * を送る」。接続の確立（プロセス起動 + npx によるアダプタ取得）は高価
   * なので、`sbx exec` プロセスと `initialize` 済みの `ClientContext` は
   * そのまま使い回し、ACP セッションだけを新しく張り直す。
   */
  refresh(): Promise<void>
  close(): void
}

class IdleWatchdog {
  private lastActivityAt = Date.now()
  bump(): void {
    this.lastActivityAt = Date.now()
  }
  idleMs(): number {
    return Date.now() - this.lastActivityAt
  }
}

/**
 * サンドボックス内の ACP アダプタへ接続し、1つの ACP セッションを開始する。
 * flows.md §3「ウィンドウを開く 〜 ACP 接続」の手順を実装する:
 *   1. 生存確認（終了コードのみで判定）
 *   2. `sbx exec -i` でプロセス起動、stdout/stderr を分離
 *   3. initialize（アイドルタイムアウト）
 *   4. session/new（`restore` が指定されたときは session/load か session/resume）
 *
 * 戻り値の `sessionId` は shovel 独自に払い出す ID であり、ACP プロトコル上の
 * `SessionId`（`session/new` の応答で初めて分かる）とは別物として扱う。
 * タブは接続開始時点で ID を必要とするため、ACP セッションが確立する前から
 * 安定した識別子を持てるようにこの層で吸収する。以降の ACP 呼び出しは
 * `ActiveSession` オブジェクトが自身の ACP sessionId を内部で保持するため、
 * shovel 側で変換して回す必要はない。
 */
export async function openAcpSession(
  sessionId: string,
  project: Project,
  agent: AgentEntry,
  callbacks: SessionRuntimeCallbacks,
  restore?: RestoreRequest
): Promise<OpenedSession> {
  const alive = await sbxLivenessCheck(project.sandboxName)
  if (!alive) {
    throw new Error(
      `サンドボックス "${project.sandboxName}" に到達できません。停止しているか削除されている可能性があります。`
    )
  }

  const acp = await loadAcpSdk()
  const logger = new SessionLogger(sessionId)
  const child = sbxSpawnInteractive(project.sandboxName, ['npx', '-y', agent.acpPackage], {
    cwd: project.sandboxPath
  })

  const watchdog = new IdleWatchdog()
  const stream = buildAcpStream({
    child,
    logger,
    ndJsonStream: acp.ndJsonStream,
    onStdoutActivity: () => watchdog.bump()
  })

  const translator = new SessionTranslator()
  const snapshotAcc = new SnapshotAccumulator()
  const pendingPermissions = new Map<string, (optionId: string | null) => void>()
  /** 復元した `ManualSession` を ACP セッション id で引くための表。 */
  const manualSessions = new Map<string, ManualSession>()
  /**
   * いま開いている ACP セッション id。スナップショットに書き戻しておくことで、
   * 次回この履歴を選んだときに `session/load` / `session/resume` へ渡せる。
   */
  let currentAcpSessionId: string | null = null

  async function persistSnapshot(): Promise<void> {
    if (snapshotAcc.isEmpty()) return
    await saveSnapshot({
      schemaVersion: 1,
      sessionId,
      acpSessionId: currentAcpSessionId ?? undefined,
      projectId: project.id,
      // flows.md §6: 名前変更の上書きがあれば、エージェント発の内容から
      // 推定したタイトルより優先する。
      title: sessionTitleStore.get(sessionId) ?? snapshotAcc.title(),
      savedAt: Date.now(),
      entries: snapshotAcc.snapshotEntries()
    }).catch(() => {
      // スナップショットは表示高速化のための派生物。書き込み失敗で接続は壊さない。
    })
  }

  const clientApp = acp
    .client({ name: 'shovel' })
    .onRequest(acp.CLIENT_METHODS.session_request_permission, async ({ params, signal }) => {
      return handlePermissionRequest(params, callbacks, translator, pendingPermissions, signal)
    })
    .onRequest(acp.CLIENT_METHODS.fs_read_text_file, () => {
      throw acp.RequestError.methodNotFound(acp.CLIENT_METHODS.fs_read_text_file)
    })
    .onRequest(acp.CLIENT_METHODS.fs_write_text_file, () => {
      throw acp.RequestError.methodNotFound(acp.CLIENT_METHODS.fs_write_text_file)
    })
    .onRequest(acp.CLIENT_METHODS.terminal_create, () => {
      throw acp.RequestError.methodNotFound(acp.CLIENT_METHODS.terminal_create)
    })
    .onRequest(acp.CLIENT_METHODS.terminal_output, () => {
      throw acp.RequestError.methodNotFound(acp.CLIENT_METHODS.terminal_output)
    })
    .onRequest(acp.CLIENT_METHODS.terminal_release, () => {
      throw acp.RequestError.methodNotFound(acp.CLIENT_METHODS.terminal_release)
    })
    .onRequest(acp.CLIENT_METHODS.terminal_wait_for_exit, () => {
      throw acp.RequestError.methodNotFound(acp.CLIENT_METHODS.terminal_wait_for_exit)
    })
    .onRequest(acp.CLIENT_METHODS.terminal_kill, () => {
      throw acp.RequestError.methodNotFound(acp.CLIENT_METHODS.terminal_kill)
    })
    .onRequest(acp.CLIENT_METHODS.elicitation_create, () => {
      throw acp.RequestError.methodNotFound(acp.CLIENT_METHODS.elicitation_create)
    })
    // `session/new` のセッションは SDK 内部のルータが ActiveSession のキューへ
    // 積んでくれる（そのルータは Handled.no を返すので、ここにも同じ通知が
    // 届く）。復元したセッションにはその仕組みが使えないため、ここで拾って
    // ManualSession のキューへ流す。表に無い sessionId は ActiveSession 側の
    // ものなので、二重処理にならないよう黙って捨てる。
    .onNotification(acp.CLIENT_METHODS.session_update, ({ params }) => {
      const manual = manualSessions.get(params.sessionId)
      if (!manual) return
      manual.enqueue({ kind: 'session_update', notification: params, update: params.update })
    })

  interface StartedSession {
    session: SessionHandle
    modes: SessionModeState | null | undefined
    configOptions: SessionConfigOption[] | null | undefined
    /** `session/load` が呼び出し中に流し込んできた過去分。 */
    replayed: ActiveSessionMessage[]
    /**
     * ローカルスナップショットを描き起こす必要があるか。`session/resume` は
     * 過去を流し直さないため true、`session/load` は replay が正なので false。
     */
    seedFromSnapshot: boolean
  }

  async function startNewSession(ctx: ClientContext): Promise<StartedSession> {
    const session = await ctx.buildSession(project.sandboxPath).start()
    return {
      session,
      modes: session.modes,
      configOptions: session.newSessionResponse.configOptions,
      replayed: [],
      seedFromSnapshot: false
    }
  }

  /**
   * decisions.md C-1/C-2 の復元戦略表:
   *   - `resume` 対応 + ローカルスナップショットあり → `session/resume`。
   *     過去の流し直しが無いぶん速く、表示はスナップショットが受け持つ。
   *   - `load` 対応 → `session/load`。過去を `session/update` として
   *     流し直してもらい、それをそのまま描く（描いた結果を保存し直すので
   *     スナップショットが古くても辻褄が合う）。
   *   - どちらも非対応 → 復元できない。呼び出し側は読み取り専用の履歴表示に
   *     とどめる。
   */
  async function startRestoredSession(
    ctx: ClientContext,
    caps: SessionCapabilities,
    target: RestoreRequest
  ): Promise<StartedSession> {
    const useResume = caps.resume && target.entries.length > 0
    if (!useResume && !caps.load) throw new Error(RESTORE_UNSUPPORTED_MARKER)

    const acpSessionId = target.acpSessionId
    const manual = new ManualSession(acpSessionId, ctx, acp.AGENT_METHODS.session_prompt, () =>
      manualSessions.delete(acpSessionId)
    )
    manualSessions.set(acpSessionId, manual)

    if (useResume) {
      const response: ResumeSessionResponse = await withDeadline(
        ctx.request(acp.AGENT_METHODS.session_resume, {
          sessionId: acpSessionId,
          cwd: project.sandboxPath
        }),
        REQUEST_DEADLINE_MS
      )
      return {
        session: manual,
        modes: response.modes,
        configOptions: response.configOptions,
        replayed: [],
        seedFromSnapshot: true
      }
    }

    translator.setReplayMode(true)
    try {
      const response: LoadSessionResponse = await withDeadline(
        ctx.request(acp.AGENT_METHODS.session_load, {
          sessionId: acpSessionId,
          cwd: project.sandboxPath,
          mcpServers: []
        }),
        REQUEST_DEADLINE_MS
      )
      return {
        session: manual,
        modes: response.modes,
        configOptions: response.configOptions,
        replayed: manual.drainQueued(),
        seedFromSnapshot: false
      }
    } catch (err) {
      translator.setReplayMode(false)
      throw err
    }
  }

  let releaseConnection: () => void = () => {}
  const closeSignal = new Promise<void>((resolve) => {
    releaseConnection = resolve
  })

  let ready: {
    ctx: ClientContext
    session: SessionHandle
  } | null = null
  let metaState: MutableMetaState | null = null
  const readyPromise = new Promise<{ ctx: ClientContext; session: SessionHandle }>(
    (resolveReady, rejectReady) => {
      const connectionPromise = clientApp.connectWith(stream, async (ctx) => {
        try {
          const initResponse = await raceIdleTimeout(
            ctx.request(acp.AGENT_METHODS.initialize, {
              protocolVersion: 1,
              clientCapabilities: {
                fs: { readTextFile: false, writeTextFile: false },
                terminal: false
              },
              clientInfo: { name: 'shovel', version: app.getVersion() }
            }),
            watchdog,
            INITIALIZE_IDLE_TIMEOUT_MS
          )

          const started = restore
            ? await startRestoredSession(ctx, readCapabilities(initResponse), restore)
            : await startNewSession(ctx)
          const session = started.session
          currentAcpSessionId = session.sessionId
          const readyValue = { ctx, session }
          ready = readyValue
          metaState = initialMetaState(started.modes, started.configOptions)
          resolveReady(readyValue)

          // `session/resume` は過去を流し直さないので、ローカルスナップショットを
          // 描き起こす。同時に蓄積にも積み直しておかないと、次のターンを保存
          // したときに過去分が消える。
          if (started.seedFromSnapshot && restore) {
            const seeded = snapshotEntriesToEvents(restore.entries)
            snapshotAcc.track(seeded)
            for (const event of seeded) callbacks.onEvent(event)
          }

          // `session/load` が流し込んできた過去分をここで描き切る。翻訳が
          // 終わるまで replay モードを保つ（`user_message_chunk` の扱いが
          // ライブと replay で変わるため）。最後に stop を1つ通して開いた
          // ままのブロックを閉じ、復元後の内容でスナップショットを取り直す
          // （decisions.md C-1/C-2 の「完了後に新しいスナップショットを保存」）。
          if (started.replayed.length > 0) {
            for (const message of started.replayed) {
              handleSessionMessage(message, translator, callbacks, metaState, snapshotAcc, () => {})
            }
            handleSessionMessage(
              { kind: 'stop', response: { stopReason: 'end_turn' }, stopReason: 'end_turn' },
              translator,
              callbacks,
              metaState,
              snapshotAcc,
              () => void persistSnapshot()
            )
          }
          translator.setReplayMode(false)

          void runUpdateLoop(session, translator, callbacks, metaState, snapshotAcc, () => void persistSnapshot())
        } catch (err) {
          rejectReady(err)
          throw err
        }
        await closeSignal
      })
      connectionPromise.catch((err: unknown) => {
        for (const resolve of pendingPermissions.values()) resolve(null)
        pendingPermissions.clear()
        callbacks.onFatalError(errorMessage(err))
      })
    }
  )

  let resolvedSession: SessionHandle
  try {
    resolvedSession = (await readyPromise).session
  } catch (err) {
    child.kill()
    logger.close()
    // flows.md §1-2: 「接続やターンが認証エラーで失敗したら、同じ認証画面を
    // 出す」。事前チェック（authService.checkAuthStatus）だけに頼ると、
    // トークン期限切れのケースを取りこぼすため、ここでも検知する。
    if (isAuthRequiredError(err)) throw new Error(AUTH_REQUIRED_MARKER)
    throw err
  }
  let currentSession = resolvedSession
  const resolvedMetaState = metaState as MutableMetaState | null
  if (!resolvedMetaState) throw new Error('unreachable: metaState must be set once readyPromise resolves')
  const meta: SessionMeta = {
    sessionId,
    projectId: project.id,
    modes: resolvedMetaState.modes,
    currentModeId: resolvedMetaState.currentModeId,
    configOptions: resolvedMetaState.configOptions,
    usage: resolvedMetaState.usage
  }
  callbacks.onMetaChanged(meta)

  return {
    sessionId,
    meta,
    logger,
    async prompt(text: string, attachmentRelPaths: string[] = []) {
      const chips = attachmentRelPaths.map((relPath) => ({
        key: relPath,
        label: relPath.split('/').pop() ?? relPath,
        path: relPath
      }))
      const events = translator.userPrompt(text, chips)
      snapshotAcc.track(events)
      for (const event of events) callbacks.onEvent(event)

      const promptBlocks: ContentBlock[] = attachmentRelPaths.map((relPath) => ({
        type: 'resource_link',
        uri: `file://${path.posix.join(project.sandboxPath, relPath)}`,
        name: relPath.split('/').pop() ?? relPath
      }))
      promptBlocks.push({ type: 'text', text })
      await currentSession.prompt(promptBlocks)
    },
    async cancel() {
      if (!ready) return
      await ready.ctx.notify(acp.AGENT_METHODS.session_cancel, { sessionId: currentSession.sessionId })
    },
    async setMode(modeId: string) {
      if (!ready) return
      await withDeadline(
        ready.ctx.request(acp.AGENT_METHODS.session_set_mode, {
          sessionId: currentSession.sessionId,
          modeId
        }),
        REQUEST_DEADLINE_MS
      )
    },
    async setConfigOption(configId: string, value: string | boolean) {
      if (!ready) return
      const params =
        typeof value === 'boolean'
          ? { sessionId: currentSession.sessionId, configId, type: 'boolean' as const, value }
          : { sessionId: currentSession.sessionId, configId, value }
      await withDeadline(
        ready.ctx.request(acp.AGENT_METHODS.session_set_config_option, params),
        REQUEST_DEADLINE_MS
      )
    },
    resolvePermission(permissionId: string, optionId: string) {
      const resolve = pendingPermissions.get(permissionId)
      if (resolve) {
        pendingPermissions.delete(permissionId)
        resolve(optionId)
      }
    },
    async refresh() {
      if (!ready) return
      await persistSnapshot()
      currentSession.dispose()
      snapshotAcc.reset()
      translator.reset()

      const newSession = await ready.ctx.buildSession(project.sandboxPath).start()
      currentSession = newSession
      currentAcpSessionId = newSession.sessionId
      const newMetaState = initialMetaState(newSession.modes, newSession.newSessionResponse.configOptions)
      resolvedMetaState.modes = newMetaState.modes
      resolvedMetaState.currentModeId = newMetaState.currentModeId
      resolvedMetaState.configOptions = newMetaState.configOptions
      // 新しいセッションでは使用量はまだ届いていない。前のセッションの値を
      // 引きずらないよう明示的にクリアする（undefined = 未受信、ui.md §8）。
      resolvedMetaState.usage = undefined

      callbacks.onEvent({ type: 'reset', sessionId })
      callbacks.onEvent({ ...resolvedMetaState, type: 'sessionMeta' })
      void runUpdateLoop(newSession, translator, callbacks, resolvedMetaState, snapshotAcc, () => void persistSnapshot())
    },
    close() {
      void persistSnapshot()
      child.kill()
      releaseConnection()
      logger.close()
    }
  }
}

/**
 * `runUpdateLoop` から見たセッションの最小インターフェース。
 *
 * SDK の高レベル API（`ctx.buildSession().start()` が返す `ActiveSession`）は
 * `session/new` 専用で、`session/load` / `session/resume` で開いたセッションを
 * 受け取る口が無い（更新を流し込む `attachSession` が private）。そこで
 * 「更新を1件ずつ取り出せるもの」だけを要求する形に薄く抽象化し、
 * `ActiveSession` はそのまま、復元したセッションは `ManualSession` が満たす。
 */
interface SessionHandle {
  readonly sessionId: string
  nextUpdate(): Promise<ActiveSessionMessage>
  prompt(blocks: ContentBlock[]): Promise<PromptResponse>
  dispose(): void
}

/**
 * `session/load` / `session/resume` で開いたセッション用の `SessionHandle`。
 * `session/update` 通知を自前のキューへ積み、`ActiveSession` と同じ
 * 「`nextUpdate()` で1件ずつ」の形に揃える。`session/prompt` の応答は
 * `ActiveSession` と同様、`stop` メッセージとしてキューへ流す。
 */
class ManualSession implements SessionHandle {
  private readonly queued: ActiveSessionMessage[] = []
  private waiting: ((message: ActiveSessionMessage) => void) | null = null
  private disposed = false

  constructor(
    readonly sessionId: string,
    private readonly ctx: ClientContext,
    private readonly promptMethod: string,
    private readonly onDispose: () => void
  ) {}

  enqueue(message: ActiveSessionMessage): void {
    if (this.disposed) return
    const waiting = this.waiting
    if (waiting) {
      this.waiting = null
      waiting(message)
      return
    }
    this.queued.push(message)
  }

  /**
   * いまキューに溜まっている分をすべて取り出して空にする。
   * `session/load` が呼び出し中に流し込んでくる replay を「ここまでが過去分」
   * と確定させるために使う（以降に届くものはライブの更新）。
   */
  drainQueued(): ActiveSessionMessage[] {
    return this.queued.splice(0, this.queued.length)
  }

  nextUpdate(): Promise<ActiveSessionMessage> {
    const queued = this.queued.shift()
    if (queued) return Promise.resolve(queued)
    // dispose 済みなら永久に解決しない Promise を返す。runUpdateLoop は
    // ActiveSession の場合と同じく「もう更新は来ない」状態で止まればよい。
    if (this.disposed) return new Promise<ActiveSessionMessage>(() => {})
    return new Promise<ActiveSessionMessage>((resolve) => {
      this.waiting = resolve
    })
  }

  async prompt(blocks: ContentBlock[]): Promise<PromptResponse> {
    const response = (await this.ctx.request(this.promptMethod, {
      sessionId: this.sessionId,
      prompt: blocks
    })) as PromptResponse
    this.enqueue({ kind: 'stop', response, stopReason: response.stopReason })
    return response
  }

  dispose(): void {
    this.disposed = true
    this.waiting = null
    this.queued.length = 0
    this.onDispose()
  }
}

/**
 * `initialize` の応答からエージェントの対応状況を読む。
 * `load` だけ `agentCapabilities.loadSession`（boolean）で、他は
 * `sessionCapabilities.*` に「あれば対応」という形で載る（schema 上の経緯で
 * 非対称。SDK の型定義どおり）。
 */
function readCapabilities(response: unknown): SessionCapabilities {
  const agentCapabilities = (response as InitializeResponse | undefined)?.agentCapabilities
  const sessionCapabilities = agentCapabilities?.sessionCapabilities
  return {
    load: agentCapabilities?.loadSession === true,
    resume: sessionCapabilities?.resume != null,
    list: sessionCapabilities?.list != null,
    delete: sessionCapabilities?.delete != null
  }
}

/** 過去のセッションを復元して開くときの指定。`sessionManager` が組み立てる。 */
export interface RestoreRequest {
  /** エージェント側のセッション id（スナップショットに保存してある）。 */
  acpSessionId: string
  /**
   * ローカルスナップショットの中身。`session/resume`（replay 無し）を選んだ
   * ときにこれを描き、かつスナップショットの蓄積にも積み直す。積み直さないと
   * 次のターンを保存したときに過去分が消えてしまう。
   */
  entries: SnapshotEntry[]
}

/** スナップショットの1件を、描画用の確定済みブロックに戻す。 */
function snapshotEntriesToEvents(entries: SnapshotEntry[]): TranscriptEvent[] {
  return entries.map((entry) => ({
    type: 'block' as const,
    id: entry.id,
    role: entry.role,
    markdown: entry.markdown,
    streaming: false
  }))
}

interface MutableMetaState {
  modes: SessionMode[]
  currentModeId?: string
  configOptions: ConfigOption[]
  usage?: SessionUsage
}

/**
 * data-model.md §3: トランスクリプトのスナップショットをキャッシュとして
 * 保持する。確定済み（ストリーミング中でない）ブロックだけを id で upsert する
 * ので、途中経過は残らず最終テキストだけが積み上がる。
 */
class SnapshotAccumulator {
  private readonly entries = new Map<string, SnapshotEntry>()

  track(events: TranscriptEvent[]): void {
    for (const e of events) {
      if (e.type === 'block' && !e.streaming) {
        this.entries.set(e.id, { id: e.id, role: e.role, markdown: e.markdown })
      } else if (e.type === 'blockMarkdown') {
        const existing = this.entries.get(e.id)
        this.entries.set(e.id, { id: e.id, role: existing?.role ?? 'AGENT', markdown: e.markdown })
      }
    }
  }

  isEmpty(): boolean {
    return this.entries.size === 0
  }

  reset(): void {
    this.entries.clear()
  }

  snapshotEntries(): SnapshotEntry[] {
    return Array.from(this.entries.values())
  }

  title(): string {
    for (const entry of this.entries.values()) {
      if (entry.role === 'USER') return entry.markdown.slice(0, 60)
    }
    return 'New session'
  }
}

/** 1件の更新（または `stop`）を翻訳して renderer へ流す。replay とライブで共用する。 */
function handleSessionMessage(
  message: ActiveSessionMessage,
  translator: SessionTranslator,
  callbacks: SessionRuntimeCallbacks,
  metaState: MutableMetaState,
  snapshotAcc: SnapshotAccumulator,
  onStop: () => void
): void {
  {
    if (message.kind === 'stop') {
      const events = translator.handleStop(message.stopReason)
      snapshotAcc.track(events)
      for (const event of events) callbacks.onEvent(event)
      onStop()
      return
    }
    const update = message.update
    if (update.sessionUpdate === 'current_mode_update') {
      metaState.currentModeId = update.currentModeId
      callbacks.onEvent({ ...metaState, type: 'sessionMeta' })
      return
    }
    if (update.sessionUpdate === 'config_option_update') {
      metaState.configOptions = update.configOptions.map(configOptionToPayload)
      callbacks.onEvent({ ...metaState, type: 'sessionMeta' })
      return
    }
    if (update.sessionUpdate === 'usage_update') {
      metaState.usage = {
        used: update.used,
        size: update.size,
        costAmount: update.cost?.amount,
        costCurrency: update.cost?.currency
      }
      callbacks.onEvent({ ...metaState, type: 'sessionMeta' })
      return
    }
    const events = translator.handleSessionUpdate(update)
    snapshotAcc.track(events)
    for (const event of events) callbacks.onEvent(event)
  }
}

async function runUpdateLoop(
  session: SessionHandle,
  translator: SessionTranslator,
  callbacks: SessionRuntimeCallbacks,
  metaState: MutableMetaState,
  snapshotAcc: SnapshotAccumulator,
  onStop: () => void
): Promise<void> {
  // prompt() 呼び出し自体はここでは行わない。OpenedSession.prompt() が
  // session.prompt() を起動し、その完了は下のループへ `stop` メッセージとして
  // 流れてくる（ActiveSession の設計: 完了は nextUpdate() にも queue される）。
  for (;;) {
    let message: ActiveSessionMessage
    try {
      message = await session.nextUpdate()
    } catch {
      // セッションが閉じられた（dispose/接続終了）。ループを終える。
      return
    }
    handleSessionMessage(message, translator, callbacks, metaState, snapshotAcc, onStop)
  }
}

async function handlePermissionRequest(
  params: RequestPermissionRequest,
  callbacks: SessionRuntimeCallbacks,
  translator: SessionTranslator,
  pending: Map<string, (optionId: string | null) => void>,
  signal: AbortSignal
): Promise<RequestPermissionResponse> {
  const permissionId = randomUUID()
  callbacks.onEvent(permissionRequestToEvent(permissionId, params))

  const optionId = await new Promise<string | null>((resolve) => {
    pending.set(permissionId, resolve)
    signal.addEventListener('abort', () => {
      pending.delete(permissionId)
      resolve(null)
    })
  })

  if (optionId === null) {
    callbacks.onEvent({ type: 'permissionResolved', id: permissionId, status: 'cancelled' })
    return { outcome: { outcome: 'cancelled' } }
  }
  callbacks.onEvent({ type: 'permissionResolved', id: permissionId, status: 'selected', optionId })
  return { outcome: { outcome: 'selected', optionId } }
}

function initialMetaState(
  modeState: SessionModeState | null | undefined,
  options: SessionConfigOption[] | null | undefined
): MutableMetaState {
  const modes: SessionMode[] = (modeState?.availableModes ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description ?? undefined
  }))
  return {
    modes,
    currentModeId: modeState?.currentModeId,
    configOptions: (options ?? []).map(configOptionToPayload)
  }
}

function configOptionToPayload(option: SessionConfigOption): ConfigOption {
  if (option.type === 'boolean') {
    return {
      configId: option.id,
      category: option.category ?? 'other',
      label: option.name,
      description: option.description ?? undefined,
      kind: 'boolean',
      currentValue: String(option.currentValue)
    }
  }
  const rawOptions = option.options as Array<
    { value: string; name: string; description?: string | null } | { group: string; name: string; options: Array<{ value: string; name: string; description?: string | null }> }
  >
  const flatOptions = rawOptions.flatMap((o) => ('group' in o ? o.options : [o]))
  return {
    configId: option.id,
    category: option.category ?? 'other',
    label: option.name,
    description: option.description ?? undefined,
    kind: 'select',
    currentValue: option.currentValue,
    options: flatOptions.map((o) => ({
      value: o.value,
      label: o.name,
      description: o.description ?? undefined
    }))
  }
}

async function raceIdleTimeout<T>(promise: Promise<T>, watchdog: IdleWatchdog, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const interval = setInterval(() => {
      if (settled) return
      if (watchdog.idleMs() > timeoutMs) {
        settled = true
        clearInterval(interval)
        reject(new Error(`接続がタイムアウトしました（${Math.round(timeoutMs / 1000)}秒間応答がありません）`))
      }
    }, 1000)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearInterval(interval)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearInterval(interval)
        reject(err)
      }
    )
  })
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('request timed out')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
