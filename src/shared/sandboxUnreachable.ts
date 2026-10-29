/**
 * 接続前の確認（`sbx ls --json` と `sbx exec <name> echo`）で接続できないと分かったとき、
 * 調べた原因を renderer へ伝える Error の message に使う目印。
 * 形式は `SANDBOX_UNREACHABLE:<reason>`、詳細があれば改行に続ける。
 */
export const SANDBOX_UNREACHABLE_MARKER = 'SANDBOX_UNREACHABLE'

/**
 * 接続できない原因。
 *   - notSignedIn: Docker にサインインしていない（`sbx diagnose` の Authentication が fail）
 *   - diagnoseFailed: `sbx diagnose` のほかの項目が fail（詳細に項目と hint）
 *   - missing: `sbx ls` にそのサンドボックスが無い
 *   - workspaceMissing: ホスト側のワークスペースが無い
 *   - stopped: 停止したまま（`sbx exec` は停止中なら先に起動するので、その起動に失敗した）
 *   - unknown: どれにも当てはまらない
 */
export type SandboxUnreachableReason =
  | 'notSignedIn'
  | 'diagnoseFailed'
  | 'missing'
  | 'workspaceMissing'
  | 'stopped'
  | 'unknown'

/** `sbx diagnose --json` のチェック項目（判定に使うものだけ）。 */
export interface DiagnoseCheckLike {
  name: string
  status: string
  message?: string
  hint?: string
}

/** `sbx ls --json` で見つけたサンドボックスの状態。一覧に無ければ null。 */
export type SandboxLsState = { status: string; workspace_missing?: boolean } | null

export interface SandboxUnreachableInfo {
  reason: SandboxUnreachableReason
  detail?: string
}

/** `sbx ls` が失敗したときの原因を `sbx diagnose --json` の項目から決める。`checks` は取得できなければ null。 */
export function classifySbxFailure(checks: DiagnoseCheckLike[] | null): SandboxUnreachableInfo {
  const failed = (checks ?? []).filter((c) => c.status === 'fail')
  if (failed.some((c) => c.name.toLowerCase() === 'authentication')) return { reason: 'notSignedIn' }
  if (failed.length > 0) {
    const detail = failed
      .map((c) => [`${c.name}: ${c.message ?? c.status}`, c.hint].filter(Boolean).join(' — '))
      .join('\n')
    return { reason: 'diagnoseFailed', detail }
  }
  return { reason: 'unknown' }
}

/** `sbx ls --json` の結果のうち、`sbx exec` を試すまでもなく接続できないもの。問題が無ければ null。 */
export function listedSandboxProblem(listed: SandboxLsState): SandboxUnreachableInfo | null {
  if (listed === null) return { reason: 'missing' }
  if (listed.workspace_missing) return { reason: 'workspaceMissing' }
  return null
}

/** `sbx ls` を通ったのに `sbx exec <name> echo` が失敗したときの原因。 */
export function classifyExecFailure(listed: { status: string }): SandboxUnreachableInfo {
  return { reason: listed.status === 'stopped' ? 'stopped' : 'unknown' }
}

export function sandboxUnreachableMessage(info: SandboxUnreachableInfo): string {
  const head = `${SANDBOX_UNREACHABLE_MARKER}:${info.reason}`
  return info.detail ? `${head}\n${info.detail}` : head
}

const REASONS: readonly SandboxUnreachableReason[] = [
  'notSignedIn',
  'diagnoseFailed',
  'missing',
  'workspaceMissing',
  'stopped',
  'unknown'
]

/** IPC で包まれた Error の message から原因を取り出す。目印が無ければ null。 */
export function parseSandboxUnreachableMessage(message: string): SandboxUnreachableInfo | null {
  const match = new RegExp(`${SANDBOX_UNREACHABLE_MARKER}:(\\w+)(?:\\n([\\s\\S]*))?`).exec(message)
  if (!match) return null
  const reason = REASONS.find((r) => r === match[1])
  if (!reason) return null
  return match[2] ? { reason, detail: match[2] } : { reason }
}
