/** サンドボックス内の Node.js（npx）の確認・インストールに使うスクリプトと、失敗を renderer へ伝える目印。 */

/** `npx` の有無を確かめるコマンド。見つかれば終了コード 0。 */
export const NPX_CHECK_COMMAND = ['sh', '-c', 'command -v npx']

/** 進捗表示に出す、確認コマンドの要約。 */
export const NPX_CHECK_SUMMARY = "sh -c 'command -v npx'"

/** 進捗表示に出す、インストールの要約。 */
export const NODE_INSTALL_SUMMARY = 'sudo apt-get install -y nodejs-24 npm'

/** スクリプトが stderr に出す目印。 */
const NO_APT_MARKER = '__shovel_no_apt__'
const NO_SUDO_MARKER = '__shovel_no_sudo__'
const NO_NPX_MARKER = '__shovel_no_npx_after_install__'

/**
 * apt で Node.js と npm を入れる sh スクリプト。
 * apt-get が無い・sudo がパスワード無しで使えない・入れた後も npx が無いときは、目印を stderr に出して非0で終わる。
 * パッケージ一覧の更新はロック待ちで失敗しうるので3回まで試す。
 * `nodejs-24` が無いリポジトリでは `nodejs` を入れる。
 */
export const NODE_INSTALL_SCRIPT = [
  `command -v apt-get >/dev/null 2>&1 || { echo ${NO_APT_MARKER} >&2; exit 3; }`,
  `sudo -n true >/dev/null 2>&1 || { echo ${NO_SUDO_MARKER} >&2; exit 4; }`,
  'run_apt() { sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -q -o DPkg::Lock::Timeout=120 "$@"; }',
  'n=0',
  'until run_apt update; do n=$((n+1)); [ "$n" -ge 3 ] && exit 1; sleep 5; done',
  'if apt-cache show nodejs-24 >/dev/null 2>&1; then node_pkg=nodejs-24; else node_pkg=nodejs; fi',
  'run_apt install -y "$node_pkg" npm || exit 1',
  `command -v npx >/dev/null 2>&1 || { echo ${NO_NPX_MARKER} >&2; exit 5; }`
].join('\n')

/** Node.js を用意できなかったことを renderer へ伝える Error の message に使う目印。 */
export const NODE_RUNTIME_MARKER = 'NODE_RUNTIME_UNAVAILABLE'

/**
 * Node.js を用意できなかった原因。
 * - `noApt`: サンドボックスに apt-get が無い
 * - `noSudo`: パスワード無しで sudo できない
 * - `failed`: apt-get の失敗・タイムアウト、入れた後も npx が見つからない
 */
export type NodeRuntimeFailureReason = 'noApt' | 'noSudo' | 'failed'

export interface NodeRuntimeFailure {
  reason: NodeRuntimeFailureReason
  /** インストールしようとしたサンドボックスの名前。 */
  sandboxName: string
  /** stderr の末尾など、原因の手がかり。 */
  detail?: string
}

const REASONS: readonly NodeRuntimeFailureReason[] = ['noApt', 'noSudo', 'failed']

/** detail に残す stderr の行数。 */
const DETAIL_LINES = 15

/** インストールスクリプトの結果から原因を決める。`code` が null ならタイムアウトで止めた。 */
export function classifyNodeInstallFailure(
  sandboxName: string,
  code: number | null,
  stderr: string
): NodeRuntimeFailure {
  if (stderr.includes(NO_APT_MARKER)) return { reason: 'noApt', sandboxName }
  if (stderr.includes(NO_SUDO_MARKER)) return { reason: 'noSudo', sandboxName }
  const lines = stderr
    .split(/\r\n|\n/)
    .filter((line) => line.trim().length > 0 && !line.includes(NO_NPX_MARKER))
    .slice(-DETAIL_LINES)
  if (stderr.includes(NO_NPX_MARKER)) lines.push('npx was not found after installing nodejs and npm.')
  if (code === null) lines.push('The installation timed out.')
  return lines.length > 0
    ? { reason: 'failed', sandboxName, detail: lines.join('\n') }
    : { reason: 'failed', sandboxName }
}

export function nodeRuntimeMessage(failure: NodeRuntimeFailure): string {
  const head = `${NODE_RUNTIME_MARKER}:${failure.reason}:${failure.sandboxName}`
  return failure.detail ? `${head}\n${failure.detail}` : head
}

/** IPC で包まれた Error の message から原因を取り出す。目印が無ければ null。 */
export function parseNodeRuntimeMessage(message: string): NodeRuntimeFailure | null {
  const match = new RegExp(`${NODE_RUNTIME_MARKER}:(\\w+):([\\w.-]+)(?:\\n([\\s\\S]*))?`).exec(message)
  if (!match) return null
  const reason = REASONS.find((r) => r === match[1])
  if (!reason) return null
  const sandboxName = match[2] ?? ''
  return match[3] ? { reason, sandboxName, detail: match[3] } : { reason, sandboxName }
}
