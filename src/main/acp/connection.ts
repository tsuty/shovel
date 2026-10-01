import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  ActiveSessionMessage,
  ClientContext,
  ContentBlock,
  InitializeResponse,
  ListSessionsResponse,
  LoadSessionResponse,
  PromptResponse,
  ResumeSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState,
  SessionUpdate
} from '@agentclientprotocol/sdk'
import type { AgentEntry, Project } from '@shared/types/project'
import type {
  ConfigOption,
  SessionCapabilities,
  SessionCommand,
  SessionMeta,
  SessionMode,
  SessionUsage,
  SnapshotEntry
} from '@shared/types/session'
import type { AttachmentChip, ToolCallPayload, TranscriptEvent } from '@shared/types/transcript'
import { snapshotEntriesToEvents } from '@shared/snapshotEvents'
import { sbxLivenessCheck, sbxSpawnInteractive } from '../sbx/cli'
import { SessionLogger } from '../log'
import { buildAcpStream } from './stream'
import { loadAcpSdk } from './sdk'
import { permissionRequestToEvent, SessionTranslator } from './translate'
import { backupSnapshot, saveSnapshot } from '../persistence/snapshot'
import { sessionTitleStore } from '../persistence/store'
import { AUTH_REQUIRED_MARKER } from '@shared/authMarker'
import { RESTORE_UNSUPPORTED_MARKER } from '@shared/restoreMarker'

/** `initialize` のアイドルタイムアウト（既定 180 秒）。 */
const INITIALIZE_IDLE_TIMEOUT_MS = 180_000

function isAuthRequiredError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === -32000
}
/** `session/prompt` を除く、その他のリクエストの締切。 */
const REQUEST_DEADLINE_MS = 120_000

export interface SessionRuntimeCallbacks {
  onEvent: (event: TranscriptEvent) => void
  onMetaChanged: (meta: SessionMeta) => void
  onFatalError: (message: string) => void
  /** ローカル記録のファイル構成が変わった（バックアップが作られた）ことを知らせる。 */
  onLocalRecordsChanged: () => void
  /** ターンの記録を保存し終えたことを知らせる。 */
  onTurnSaved: () => void
}

/** `session/list` の1件。 */
export interface AgentSessionInfo {
  acpSessionId: string
  title?: string
  /** epoch millis。エージェントが報告しなければ undefined。 */
  updatedAt?: number
}

export interface OpenedSession {
  /** タブ id（イベントのルーティングに使う。↻ しても変わらない）。 */
  readonly sessionId: string
  /** いま接続している ACP セッションの id（↻ で変わる）。 */
  readonly acpSessionId: string | null
  /** `initialize` の応答が告げたエージェントの対応状況。 */
  readonly capabilities: SessionCapabilities
  /**
   * いま書き込んでいるスナップショットの id（`{snapshotId}.json`）。
   * 最初はタブ id と同じ（復元時は元のスナップショットの id）で、↻ のたびに新しい id に変わる。
   */
  readonly snapshotId: string
  readonly meta: SessionMeta
  readonly logger: SessionLogger
  /**
   * プロジェクトルートからの相対パスで渡された添付を、サンドボックス内の絶対パスの
   * `resource_link` に変換してプロンプトと一緒に送る。
   */
  prompt(text: string, attachmentRelPaths?: string[]): Promise<void>
  cancel(): Promise<void>
  setMode(modeId: string): Promise<void>
  setConfigOption(configId: string, value: string | boolean): Promise<void>
  resolvePermission(permissionId: string, optionId: string): void
  /**
   * `sbx exec` プロセスと `initialize` 済みの接続を再利用し、`session/new` で
   * ACP セッションだけを張り直す。
   */
  refresh(): Promise<string>
  /** この接続を借りて `session/list` を呼ぶ（`nextCursor` を辿って全件）。 */
  listAgentSessions(): Promise<AgentSessionInfo[]>
  /** この接続を借りて `session/delete` を送る。 */
  deleteAgentSession(acpSessionId: string): Promise<void>
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
 *   1. 生存確認（終了コードのみで判定）
 *   2. `sbx exec -i` でプロセス起動、stdout/stderr を分離
 *   3. initialize（アイドルタイムアウト）
 *   4. session/new（`restore` が指定されたときは session/load か session/resume）
 *
 * 戻り値の `sessionId` は shovel が払い出すタブ id で、ACP の `SessionId` とは別物。
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
  const logger = new SessionLogger(sessionId, project.id)
  const child = sbxSpawnInteractive(project.sandboxName, ['npx', '-y', agent.acpPackage], {
    cwd: project.sandboxPath
  })

  const watchdog = new IdleWatchdog()
  /**
   * セッションごとの、受信した `session/update` の通数（SDK に渡す前に数える）。
   * `ManualSession` が受け取った通数と突き合わせ、replay がすべてハンドラに届くまで待つのに使う。
   */
  const inboundUpdateCounts = new Map<string, number>()
  const stream = buildAcpStream({
    child,
    logger,
    ndJsonStream: acp.ndJsonStream,
    onStdoutActivity: () => watchdog.bump(),
    onIncomingMessage: (message) => {
      if (!('method' in message) || message.method !== 'session/update' || 'id' in message) return
      const sessionId = (message.params as { sessionId?: unknown } | undefined)?.sessionId
      if (typeof sessionId === 'string') inboundUpdateCounts.set(sessionId, (inboundUpdateCounts.get(sessionId) ?? 0) + 1)
    }
  })

  const translator = new SessionTranslator(project.sandboxPath)
  const snapshotAcc = new SnapshotAccumulator()
  const pendingPermissions = new Map<string, (optionId: string | null) => void>()
  /** 復元した `ManualSession` を ACP セッション id で引くための表。 */
  const manualSessions = new Map<string, ManualSession>()
  /**
   * いま開いている ACP セッション id。スナップショットに書き戻しておくことで、
   * 次回この履歴を選んだときに `session/load` / `session/resume` へ渡せる。
   */
  let currentAcpSessionId: string | null = null
  /** 復元したスナップショットのタイトル。記録を replay で置き換えるときに引き継ぐ。 */
  let restoredTitle: string | undefined = restore?.title
  /** 書き込み先のスナップショット id（`OpenedSession.snapshotId` の説明を参照）。 */
  let snapshotId = restore?.snapshotId ?? sessionId
  /**
   * replay とローカル記録の非同期比較の世代番号。新しいターン・↻・タブを閉じたときに進め、
   * 古い比較結果を捨てる。
   */
  let restoreEpoch = 0
  /** `initialize` の応答から読んだ対応状況。接続が確立するまでは全部 false。 */
  let capabilities: SessionCapabilities = { list: false, load: false, resume: false, delete: false }

  /** ターン終了時: 記録を保存してから、履歴一覧を取り直す契機を知らせる。 */
  function persistAfterTurn(): void {
    void persistSnapshot().then(() => callbacks.onTurnSaved())
  }

  async function persistSnapshot(): Promise<void> {
    if (snapshotAcc.isEmpty()) return
    await saveSnapshot({
      schemaVersion: 1,
      sessionId: snapshotId,
      acpSessionId: currentAcpSessionId ?? undefined,
      projectId: project.id,
      // 名前変更の上書きがあれば、推定したタイトルより優先する。
      title: sessionTitleStore.get(snapshotId) ?? restoredTitle ?? snapshotAcc.title(),
      savedAt: Date.now(),
      entries: snapshotAcc.snapshotEntries()
    }).catch(() => {
      // 書き込みに失敗しても接続は維持する。
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
    // 復元したセッション宛ての `session/update` を `ManualSession` のキューへ流す。
    // 表に無い sessionId は SDK の `ActiveSession` 側で処理されるので捨てる。
    .onNotification(acp.CLIENT_METHODS.session_update, ({ params }) => {
      const manual = manualSessions.get(params.sessionId)
      if (!manual) return
      manual.enqueue({ kind: 'session_update', notification: params, update: params.update })
    })

  interface StartedSession {
    session: SessionHandle
    modes: SessionModeState | null | undefined
    configOptions: SessionConfigOption[] | null | undefined
    /** `session/load` が呼び出し中に流し込んできた過去分のうち、そのまま画面に描くもの。 */
    replayed: ActiveSessionMessage[]
    /**
     * ローカル記録があるときに `session/load` が流し込んできた過去分。画面には描かず、
     * ローカル記録との比較にだけ使う。比較しない経路では null。
     */
    replayForComparison: ActiveSessionMessage[] | null
  }

  async function startNewSession(ctx: ClientContext): Promise<StartedSession> {
    const session = await ctx.buildSession(project.sandboxPath).start()
    return {
      session,
      modes: session.modes,
      configOptions: session.newSessionResponse.configOptions,
      replayed: [],
      replayForComparison: null
    }
  }

  /** ローカルスナップショットを描き起こし、蓄積にも積み直す（messageId ごと）。 */
  function seedFromSnapshot(entries: SnapshotEntry[]): void {
    snapshotAcc.seed(entries)
    for (const event of snapshotEntriesToEvents(entries)) callbacks.onEvent(event)
  }

  /**
   * 過去のセッションを復元して開く。
   *   | ローカル記録 | capability  | 振る舞い                                        |
   *   | あり         | load        | 記録を即座に描き、load の replay は描かずに比較 |
   *   | あり         | resume のみ | 記録を描き resume（比較しない）                 |
   *   | 無し／空     | load        | load のライブ replay を描き、完了後に保存       |
   *   | 無し／空     | resume のみ | resume（描けるものは無い）                      |
   *   | どちらでも   | 非対応      | RESTORE_UNSUPPORTED                             |
   */
  async function startRestoredSession(
    ctx: ClientContext,
    caps: SessionCapabilities,
    target: RestoreRequest
  ): Promise<StartedSession> {
    if (!caps.load && !caps.resume) throw new Error(RESTORE_UNSUPPORTED_MARKER)
    const hasLocal = target.entries.length > 0

    const acpSessionId = target.acpSessionId
    const manual = new ManualSession(acpSessionId, ctx, acp.AGENT_METHODS.session_prompt, () =>
      manualSessions.delete(acpSessionId)
    )
    manualSessions.set(acpSessionId, manual)
    const inboundBaseline = inboundUpdateCounts.get(acpSessionId) ?? 0

    // ローカル記録があれば、エージェントの応答を待たずに描く。
    if (hasLocal) seedFromSnapshot(target.entries)

    if (!caps.load) {
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
        replayForComparison: null
      }
    }

    // ライブで描くときだけ replay モードにする。比較用の replay は別の翻訳器で読む。
    if (!hasLocal) translator.setReplayMode(true)
    try {
      const response: LoadSessionResponse = await withDeadline(
        ctx.request(acp.AGENT_METHODS.session_load, {
          sessionId: acpSessionId,
          cwd: project.sandboxPath,
          mcpServers: []
        }),
        REQUEST_DEADLINE_MS
      )
      const expected = (inboundUpdateCounts.get(acpSessionId) ?? 0) - inboundBaseline
      const receivedAtResponse = manual.receivedUpdates
      const delivered = await waitForDelivery(() => manual.receivedUpdates >= expected, REPLAY_DELIVERY_TIMEOUT_MS)
      logger.logDebug(
        `replay-delivery session=${acpSessionId} expected=${expected} receivedAtResponse=${receivedAtResponse} received=${manual.receivedUpdates} complete=${delivered}`
      )
      const replay = manual.drainQueued()
      return {
        session: manual,
        modes: response.modes,
        configOptions: response.configOptions,
        replayed: hasLocal ? [] : replay,
        replayForComparison: hasLocal ? replay : null
      }
    } catch (err) {
      translator.setReplayMode(false)
      throw err
    }
  }

  /**
   * `session/load` の replay をローカル記録と `messageId` の並びで比較し、食い違っていたら
   *   1. 今のローカル記録を `.backup` へ退避し、
   *   2. replay の内容を新しい `{sessionId}.json` として書き込み、
   *   3. 画面も replay の内容で描き直して notice を1行差し込む。
   * 一致・比較不能なら何もしない。
   *
   * replay 中に届いたメタ情報（モード・configOptions・利用可能コマンド等）は同期的に反映する。
   * 比較と置き換えは非同期で、途中で `restoreEpoch` が進んだら結果を捨てる。
   */
  function reconcileReplay(replay: ActiveSessionMessage[], localEntries: SnapshotEntry[], metaState: MutableMetaState): void {
    const replayTranslator = new SessionTranslator(project.sandboxPath)
    replayTranslator.setReplayMode(true)
    const replayAcc = new SnapshotAccumulator()
    const replayEvents: TranscriptEvent[] = []
    const collect = (events: TranscriptEvent[]): void => {
      replayAcc.track(events)
      replayEvents.push(...events)
    }
    for (const message of replay) {
      if (message.kind === 'session_update' && applyMetaUpdate(message.update, metaState, callbacks)) continue
      if (message.kind === 'stop') collect(replayTranslator.handleStop(message.stopReason))
      else collect(replayTranslator.handleSessionUpdate(message.update))
    }
    collect(replayTranslator.handleStop('end_turn'))

    const replayEntries = replayAcc.snapshotEntries()
    const verdict = compareByMessageId(localEntries, replayEntries)
    console.info(`[acp] session/load replay vs local record (${snapshotId}): ${verdict}`)
    // 比較の中身をセッションログに残す。
    logger.logDebug(
      `replay-compare snapshot=${snapshotId} verdict=${verdict} ${JSON.stringify(describeMessageIdComparison(localEntries, replayEntries))}`
    )
    if (verdict !== 'different') return

    const epoch = restoreEpoch
    void (async () => {
      try {
        await backupSnapshot(project.id, snapshotId)
      } catch (err) {
        // 退避できなければ置き換えない。
        console.warn('[acp] failed to back up local snapshot; keeping it as-is', err)
        return
      }
      callbacks.onLocalRecordsChanged()
      if (epoch !== restoreEpoch) return
      snapshotAcc.replaceWith(replayEntries)
      callbacks.onEvent({ type: 'reset', sessionId })
      for (const event of replayEvents) callbacks.onEvent(event)
      callbacks.onEvent({ type: 'notice', id: randomUUID(), key: 'replayAdopted' })
      await persistSnapshot()
    })()
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

          capabilities = readCapabilities(initResponse)
          const started = restore
            ? await startRestoredSession(ctx, capabilities, restore)
            : await startNewSession(ctx)
          const session = started.session
          currentAcpSessionId = session.sessionId
          const readyValue = { ctx, session }
          ready = readyValue
          metaState = initialMetaState(started.modes, started.configOptions)
          resolveReady(readyValue)

          // ローカル記録がある `session/load`: replay は描かずに比較だけする。
          if (started.replayForComparison && restore) {
            reconcileReplay(started.replayForComparison, restore.entries, metaState)
          }

          // ローカル記録が無い `session/load`: 流し込んできた過去分をここで描き切る。翻訳が
          // 終わるまで replay モードを保ち、最後に stop を1つ通して開いたままのブロックを閉じ、
          // 復元後の内容でスナップショットを取り直す。
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
              persistAfterTurn
            )
          }
          translator.setReplayMode(false)

          void runUpdateLoop(session, translator, callbacks, metaState, snapshotAcc, persistAfterTurn)
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
    // 接続・ターンが認証エラーで失敗したら認証が必要であることを通知する。
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
    usage: resolvedMetaState.usage,
    commands: resolvedMetaState.commands
  }
  callbacks.onMetaChanged(meta)

  return {
    sessionId,
    get snapshotId() {
      return snapshotId
    },
    get acpSessionId() {
      return currentAcpSessionId
    },
    get capabilities() {
      return capabilities
    },
    meta,
    logger,
    async prompt(text: string, attachmentRelPaths: string[] = []) {
      restoreEpoch++
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
      if (!ready) return snapshotId
      restoreEpoch++
      // 前の会話の記録を閉じ、新しい会話は新しい `{snapshotId}.json` に書く。
      await persistSnapshot()
      restoredTitle = undefined
      snapshotId = randomUUID()
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
      // 使用量・利用可能コマンドを未受信の状態に戻す（usage は undefined、commands は空配列）。
      resolvedMetaState.usage = undefined
      resolvedMetaState.commands = []

      callbacks.onEvent({ type: 'reset', sessionId })
      callbacks.onEvent({ ...resolvedMetaState, type: 'sessionMeta' })
      void runUpdateLoop(newSession, translator, callbacks, resolvedMetaState, snapshotAcc, persistAfterTurn)
      return snapshotId
    },
    async listAgentSessions() {
      if (!ready || !capabilities.list) return []
      const result: AgentSessionInfo[] = []
      let cursor: string | undefined
      do {
        const response: ListSessionsResponse = await withDeadline(
          ready.ctx.request(acp.AGENT_METHODS.session_list, { cwd: project.sandboxPath, cursor }),
          REQUEST_DEADLINE_MS
        )
        for (const info of response.sessions) {
          const updatedAt = info.updatedAt ? Date.parse(info.updatedAt) : NaN
          result.push({
            acpSessionId: info.sessionId,
            title: info.title ?? undefined,
            updatedAt: Number.isNaN(updatedAt) ? undefined : updatedAt
          })
        }
        cursor = response.nextCursor ?? undefined
      } while (cursor)
      return result
    },
    async deleteAgentSession(acpSessionId: string) {
      if (!ready || !capabilities.delete) throw new Error('session/delete is not available')
      await withDeadline(ready.ctx.request(acp.AGENT_METHODS.session_delete, { sessionId: acpSessionId }), REQUEST_DEADLINE_MS)
    },
    close() {
      restoreEpoch++
      void persistSnapshot()
      child.kill()
      releaseConnection()
      logger.close()
    }
  }
}

/**
 * `runUpdateLoop` から見たセッションの最小インターフェース。
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
/** replay の末尾がハンドラに届くのを待つ上限。普通はマイクロタスク数回で揃う。 */
const REPLAY_DELIVERY_TIMEOUT_MS = 2000

/** `done()` が真になるまでイベントループを1周ずつ譲って待つ。期限切れなら false。 */
async function waitForDelivery(done: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!done()) {
    if (Date.now() > deadline) return false
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return true
}

class ManualSession implements SessionHandle {
  private readonly queued: ActiveSessionMessage[] = []
  /** これまでに受け取った `session/update` の通数（replay の取りこぼし検出用）。 */
  receivedUpdates = 0
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
    if (message.kind === 'session_update') this.receivedUpdates++
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
 * `load` は `agentCapabilities.loadSession`、他は `sessionCapabilities.*` の有無で判定する。
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
  /** 復元するスナップショットの id。以降の保存もこの id のファイルへ行う。 */
  snapshotId: string
  /** エージェント側のセッション id（スナップショットに保存してある）。 */
  acpSessionId: string
  /** ローカルスナップショットの中身。描画し、スナップショットの蓄積にも積み直す。 */
  entries: SnapshotEntry[]
  /** 元のスナップショットのタイトル。記録を保存し直すときに引き継ぐ。 */
  title?: string
}

export type ReplayComparison = 'same' | 'different' | 'incomparable'

/**
 * AGENT エントリの `messageId` だけを出現順に並べ（同じ id の連続は1回に畳む）、両者を比べる。
 *   - replay 側が1件も `messageId` を持たない → 'incomparable'
 *   - どちらかに `messageId` の無い AGENT エントリがある → 'different'
 *   - 並びが一致 → 'same'、それ以外 → 'different'
 */
export function compareByMessageId(local: SnapshotEntry[], replay: SnapshotEntry[]): ReplayComparison {
  const localIds = collapsedAgentMessageIds(local)
  const replayIds = collapsedAgentMessageIds(replay)
  if (!replayIds.some((id) => id !== undefined)) return 'incomparable'
  if (localIds.includes(undefined) || replayIds.includes(undefined)) return 'different'
  if (localIds.length !== replayIds.length) return 'different'
  return localIds.every((id, i) => id === replayIds[i]) ? 'same' : 'different'
}

/**
 * `compareByMessageId` の判断材料（デバッグログ用）。比べた id の並びと、
 * 最初に食い違った位置、片側にしか無い id、`messageId` を持たない AGENT
 * エントリ（先頭の文字だけ）を返す。
 */
export function describeMessageIdComparison(local: SnapshotEntry[], replay: SnapshotEntry[]): Record<string, unknown> {
  const localIds = collapsedAgentMessageIds(local)
  const replayIds = collapsedAgentMessageIds(replay)
  let firstMismatch = -1
  for (let i = 0; i < Math.max(localIds.length, replayIds.length); i++) {
    if (localIds[i] !== replayIds[i] || localIds[i] === undefined) {
      firstMismatch = i
      break
    }
  }
  const localSet = new Set(localIds)
  const replaySet = new Set(replayIds)
  const withoutId = (entries: SnapshotEntry[]): string[] =>
    entries.filter((e) => e.role === 'AGENT' && !e.messageId).map((e) => e.markdown.slice(0, 40))
  return {
    localCount: localIds.length,
    replayCount: replayIds.length,
    firstMismatch:
      firstMismatch < 0 ? null : { index: firstMismatch, local: localIds[firstMismatch] ?? null, replay: replayIds[firstMismatch] ?? null },
    onlyInLocal: localIds.filter((id) => id !== undefined && !replaySet.has(id)),
    onlyInReplay: replayIds.filter((id) => id !== undefined && !localSet.has(id)),
    localWithoutId: withoutId(local),
    replayWithoutId: withoutId(replay),
    localIds,
    replayIds
  }
}

function collapsedAgentMessageIds(entries: SnapshotEntry[]): (string | undefined)[] {
  const ids: (string | undefined)[] = []
  for (const entry of entries) {
    if (entry.role !== 'AGENT') continue
    const id = entry.messageId
    if (id !== undefined && ids.length > 0 && ids[ids.length - 1] === id) continue
    ids.push(id)
  }
  return ids
}

interface MutableMetaState {
  modes: SessionMode[]
  currentModeId?: string
  configOptions: ConfigOption[]
  usage?: SessionUsage
  commands: SessionCommand[]
}

/**
 * トランスクリプトのスナップショット用に、確定済みのブロックとツールコールのグループを蓄積する。
 * 並び順は renderer の `transcriptReducer` に合わせ、ブロックとグループは最初に現れた位置、
 * 思考だけは確定した位置に置く。
 */
class SnapshotAccumulator {
  private order: string[] = []
  private readonly entries = new Map<string, SnapshotEntry>()
  private readonly groups = new Map<string, Map<string, ToolCallPayload>>()
  private readonly chips = new Map<string, AttachmentChip[]>()
  /**
   * ストリーミング中のブロックの role。確定時の `blockMarkdown` は role を運ばないので、
   * 開始時の `block` イベントで覚えておく。
   */
  private readonly streamingRoles = new Map<string, SnapshotEntry['role']>()

  private place(id: string): void {
    if (!this.order.includes(id)) this.order.push(id)
  }

  track(events: TranscriptEvent[]): void {
    for (const e of events) {
      if (e.type === 'block') {
        if (e.role !== 'THOUGHT') this.place(e.id)
        if (e.streaming) {
          this.streamingRoles.set(e.id, e.role)
        } else {
          if (e.role === 'THOUGHT') this.place(e.id)
          this.entries.set(e.id, { id: e.id, role: e.role, markdown: e.markdown, ...(e.choices ? { choices: e.choices } : {}) })
        }
      } else if (e.type === 'blockMarkdown') {
        const role = this.entries.get(e.id)?.role ?? this.streamingRoles.get(e.id) ?? 'AGENT'
        this.streamingRoles.delete(e.id)
        this.place(e.id)
        const entry: SnapshotEntry = { id: e.id, role, markdown: e.markdown }
        if (role === 'AGENT' && e.messageId) entry.messageId = e.messageId
        if (e.choices && e.choices.length > 0) entry.choices = e.choices
        this.entries.set(e.id, entry)
      } else if (e.type === 'attachments') {
        this.chips.set(e.id, e.chips)
      } else if (e.type === 'group') {
        this.place(e.id)
        if (!this.groups.has(e.id)) this.groups.set(e.id, new Map())
      } else if (e.type === 'toolCall') {
        const groupId = e.toolCall.groupId
        this.place(groupId)
        const group = this.groups.get(groupId) ?? new Map<string, ToolCallPayload>()
        // rawInput は保存しない。
        const toolCall: ToolCallPayload = { ...e.toolCall }
        delete toolCall.rawInput
        group.set(toolCall.id, toolCall)
        this.groups.set(groupId, group)
      }
    }
  }

  /** ローカルスナップショットの内容をそのまま積む（`messageId` を保ったまま）。 */
  seed(entries: SnapshotEntry[]): void {
    for (const entry of entries) {
      this.place(entry.id)
      if (entry.role === 'TOOL_GROUP') {
        this.groups.set(entry.id, new Map((entry.toolCalls ?? []).map((tc) => [tc.id, { ...tc, groupId: entry.id }])))
        continue
      }
      const { chips, ...rest } = entry
      this.entries.set(entry.id, { ...rest })
      if (chips) this.chips.set(entry.id, chips)
    }
  }

  replaceWith(entries: SnapshotEntry[]): void {
    this.reset()
    this.seed(entries)
  }

  isEmpty(): boolean {
    return this.entries.size === 0 && this.groups.size === 0
  }

  reset(): void {
    this.order = []
    this.entries.clear()
    this.groups.clear()
    this.chips.clear()
    this.streamingRoles.clear()
  }

  snapshotEntries(): SnapshotEntry[] {
    const result: SnapshotEntry[] = []
    for (const id of this.order) {
      const group = this.groups.get(id)
      if (group) {
        if (group.size > 0) result.push({ id, role: 'TOOL_GROUP', markdown: '', toolCalls: Array.from(group.values()) })
        continue
      }
      const entry = this.entries.get(id)
      if (!entry) continue // まだ確定していない（ストリーミング中の）ブロック
      const chips = this.chips.get(id)
      result.push(chips && chips.length > 0 ? { ...entry, chips } : entry)
    }
    return result
  }

  title(): string {
    for (const entry of this.entries.values()) {
      if (entry.role === 'USER') return entry.markdown.slice(0, 60)
    }
    return 'New session'
  }
}

/**
 * メタ情報の更新（モード・configOptions・使用量・利用可能コマンド）なら
 * 状態へ反映して renderer に知らせ、true を返す。トランスクリプト本文に
 * 関わる更新なら何もせず false。
 */
function applyMetaUpdate(update: SessionUpdate, metaState: MutableMetaState, callbacks: SessionRuntimeCallbacks): boolean {
  if (update.sessionUpdate === 'current_mode_update') {
    metaState.currentModeId = update.currentModeId
  } else if (update.sessionUpdate === 'config_option_update') {
    metaState.configOptions = update.configOptions.map(configOptionToPayload)
  } else if (update.sessionUpdate === 'usage_update') {
    metaState.usage = {
      used: update.used,
      size: update.size,
      costAmount: update.cost?.amount,
      costCurrency: update.cost?.currency
    }
  } else if (update.sessionUpdate === 'available_commands_update') {
    metaState.commands = update.availableCommands.map((c) => ({
      name: c.name,
      description: c.description,
      inputHint: c.input?.hint
    }))
  } else {
    return false
  }
  callbacks.onEvent({ ...metaState, type: 'sessionMeta' })
  return true
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
    if (applyMetaUpdate(update, metaState, callbacks)) return
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
  // prompt() の完了は `stop` メッセージとして下のループに流れてくる。
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
    configOptions: (options ?? []).map(configOptionToPayload),
    commands: []
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
