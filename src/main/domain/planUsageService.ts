import { BrowserWindow } from 'electron'
import { IpcChannel } from '@shared/ipc'
import { getAgentEntry } from '@shared/agentTable'
import { parsePlanUsage, type PlanUsageState } from '@shared/planUsage'
import { isSandboxProject, type SandboxProject } from '@shared/types/project'
import { projectsStore, settingsStore } from '../persistence/store'
import { sbxExecCapture, sbxLs } from '../sbx/cli'
import { getProjectWindow } from '../windows/registry'

/**
 * プランの使用率（`/usage`）の取得と、全ウィンドウへの配信。
 * 値はアカウント単位なので main に1つだけ持ち、実行中のサンドボックスのどれか1つで取得する。
 */

/** 定期更新の間隔。 */
const PERIODIC_INTERVAL_MS = 60 * 60 * 1000
/** 定期更新の時刻に達したかを確かめる間隔。 */
const TICK_MS = 5 * 60 * 1000
/** ターン終了・フォーカス時の更新で、前回の取得からこれだけ経っていなければ取り直さない。 */
const STALE_AFTER_MS = 10 * 60 * 1000
/** `/usage` の実行の時間切れ。 */
const COMMAND_TIMEOUT_MS = 60 * 1000

let state: PlanUsageState = { loading: false, usage: null, fetchedAt: null, error: null }
/** 最後に取得を試みた時刻（成否を問わない）。 */
let lastAttemptAt = 0
let inFlight: Promise<void> | null = null
let ticker: NodeJS.Timeout | null = null

export function getPlanUsageState(): PlanUsageState {
  return state
}

function setState(next: PlanUsageState): void {
  state = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IpcChannel.PlanUsageChanged, state)
  }
}

/** 取得する。`force` でなければ、前回の試みから `minAgeMs` 経っていないと何もしない。 */
export function refreshPlanUsage({ force = false, minAgeMs = STALE_AFTER_MS } = {}): Promise<void> {
  if (!settingsStore.get().showPlanUsage) return Promise.resolve()
  if (inFlight) return inFlight
  if (!force && Date.now() - lastAttemptAt < minAgeMs) return Promise.resolve()
  lastAttemptAt = Date.now()
  inFlight = fetchPlanUsage().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function fetchPlanUsage(): Promise<void> {
  setState({ ...state, loading: true })
  try {
    const target = await pickRunningProject()
    if (!target) {
      setState({ ...state, loading: false, error: 'noRunningSandbox' })
      return
    }
    const { project, command } = target
    const result = await sbxExecCapture(project.sandboxName, command, {
      cwd: project.sandboxPath,
      timeoutMs: COMMAND_TIMEOUT_MS
    })
    if (result.code !== 0) {
      console.warn('[planUsage] command failed', result.code, result.stderr.trim())
      setState({ ...state, loading: false, error: 'failed' })
      return
    }
    const usage = parsePlanUsage(result.stdout)
    if (!usage) {
      setState({ ...state, loading: false, error: 'unreadable' })
      return
    }
    setState({ loading: false, usage, fetchedAt: Date.now(), error: null })
  } catch (err) {
    console.warn('[planUsage] failed', err)
    setState({ ...state, loading: false, error: 'failed' })
  }
}

/**
 * 使用率を取得できるエージェントの、実行中のサンドボックスを持つプロジェクト。
 * ウィンドウを開いているプロジェクトを優先する。停止中のサンドボックスは起動しないよう選ばない。
 */
async function pickRunningProject(): Promise<{ project: SandboxProject; command: string[] } | null> {
  const candidates = projectsStore
    .list()
    .filter(isSandboxProject)
    .flatMap((project) => {
      const command = getAgentEntry(project.agentId)?.planUsage?.command
      return command ? [{ project, command }] : []
    })
  if (candidates.length === 0) return null
  const sandboxes = await sbxLs()
  const running = candidates.filter(({ project }) =>
    sandboxes.some((s) => s.id === project.sandboxId && s.status === 'running' && !s.workspace_missing)
  )
  return running.find(({ project }) => getProjectWindow(project.id) !== null) ?? running[0] ?? null
}

/** 設定の切り替えに合わせて、定期更新を始める・止める。 */
export function applyPlanUsageSetting(): void {
  const enabled = settingsStore.get().showPlanUsage
  if (enabled && !ticker) {
    ticker = setInterval(() => {
      // アプリがアクティブ（いずれかのウィンドウにフォーカスがある）ときだけ。
      if (BrowserWindow.getFocusedWindow()) void refreshPlanUsage({ minAgeMs: PERIODIC_INTERVAL_MS })
    }, TICK_MS)
    void refreshPlanUsage({ force: true })
  } else if (!enabled && ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

/** ターンの終了・ウィンドウへのフォーカスで呼ぶ。前回の取得から間が空いていれば取り直す。 */
export function notePlanUsageActivity(): void {
  void refreshPlanUsage()
}
