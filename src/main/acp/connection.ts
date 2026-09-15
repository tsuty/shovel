import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  ActiveSession,
  ClientContext,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState
} from '@agentclientprotocol/sdk'
import type { AgentEntry, Project } from '@shared/types/project'
import type { ConfigOption, SessionMeta, SessionMode, SnapshotEntry } from '@shared/types/session'
import type { TranscriptEvent } from '@shared/types/transcript'
import { sbxLivenessCheck, sbxSpawnInteractive } from '../sbx/cli'
import { SessionLogger } from '../log'
import { buildAcpStream } from './stream'
import { loadAcpSdk } from './sdk'
import { permissionRequestToEvent, SessionTranslator } from './translate'
import { saveSnapshot } from '../persistence/snapshot'
import { sessionTitleStore } from '../persistence/store'
import { AUTH_REQUIRED_MARKER } from '@shared/authMarker'

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
  prompt(text: string): Promise<void>
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
 *   4. session/new
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
  callbacks: SessionRuntimeCallbacks
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

  async function persistSnapshot(): Promise<void> {
    if (snapshotAcc.isEmpty()) return
    await saveSnapshot({
      schemaVersion: 1,
      sessionId,
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

  let releaseConnection: () => void = () => {}
  const closeSignal = new Promise<void>((resolve) => {
    releaseConnection = resolve
  })

  let ready: {
    ctx: ClientContext
    session: ActiveSession
  } | null = null
  let metaState: MutableMetaState | null = null
  const readyPromise = new Promise<{ ctx: ClientContext; session: ActiveSession }>(
    (resolveReady, rejectReady) => {
      const connectionPromise = clientApp.connectWith(stream, async (ctx) => {
        try {
          await raceIdleTimeout(
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

          const session = await ctx.buildSession(project.sandboxPath).start()
          const readyValue = { ctx, session }
          ready = readyValue
          metaState = initialMetaState(session)
          resolveReady(readyValue)
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

  let resolvedSession: ActiveSession
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
    configOptions: resolvedMetaState.configOptions
  }
  callbacks.onMetaChanged(meta)

  return {
    sessionId,
    meta,
    logger,
    async prompt(text: string) {
      const events = translator.userPrompt(text)
      snapshotAcc.track(events)
      for (const event of events) callbacks.onEvent(event)
      await currentSession.prompt(text)
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
      const newMetaState = initialMetaState(newSession)
      resolvedMetaState.modes = newMetaState.modes
      resolvedMetaState.currentModeId = newMetaState.currentModeId
      resolvedMetaState.configOptions = newMetaState.configOptions

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

interface MutableMetaState {
  modes: SessionMode[]
  currentModeId?: string
  configOptions: ConfigOption[]
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

async function runUpdateLoop(
  session: ActiveSession,
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
    let message
    try {
      message = await session.nextUpdate()
    } catch {
      // セッションが閉じられた（dispose/接続終了）。ループを終える。
      return
    }
    if (message.kind === 'stop') {
      const events = translator.handleStop(message.stopReason)
      snapshotAcc.track(events)
      for (const event of events) callbacks.onEvent(event)
      onStop()
      continue
    }
    const update = message.update
    if (update.sessionUpdate === 'current_mode_update') {
      metaState.currentModeId = update.currentModeId
      callbacks.onEvent({ ...metaState, type: 'sessionMeta' })
      continue
    }
    if (update.sessionUpdate === 'config_option_update') {
      metaState.configOptions = update.configOptions.map(configOptionToPayload)
      callbacks.onEvent({ ...metaState, type: 'sessionMeta' })
      continue
    }
    const events = translator.handleSessionUpdate(update)
    snapshotAcc.track(events)
    for (const event of events) callbacks.onEvent(event)
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

function initialMetaState(session: ActiveSession): MutableMetaState {
  const modeState: SessionModeState | null | undefined = session.modes
  const modes: SessionMode[] = (modeState?.availableModes ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description ?? undefined
  }))
  const configOptions = (session.newSessionResponse.configOptions ?? []).map(configOptionToPayload)
  return {
    modes,
    currentModeId: modeState?.currentModeId,
    configOptions
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
