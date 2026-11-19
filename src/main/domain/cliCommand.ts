import path from 'node:path'
import type { SbxLsEntry } from '@shared/types/sbx'
import type { CliInstallState } from '@shared/types/cli'

/** コマンドラインツールが shovel に付ける目印の引数。 */
export const CLI_FLAG = '--shovel-cli'
/** `requestSingleInstanceLock` の `additionalData` で要求を入れるキー。 */
export const CLI_OPEN_KEY = 'shovelCliOpen'
/** シェルスクリプト版のコマンドラインツールの 2 行目にある目印。 */
export const CLI_SCRIPT_MARKER = '# shovel-cli-script'

/** コマンドラインツールからの「開いて」の要求。 */
export interface CliOpenRequest {
  /** 指定されたパス。省略時は `null`（カレントディレクトリ）。 */
  path: string | null
  /** コマンドを実行したときのカレントディレクトリ。 */
  cwd: string
}

/**
 * 起動時の引数から、コマンドラインツールの要求を読み取る。目印（`--shovel-cli`）が無ければ `null`。
 * パスは目印の後の `--` に続く最初の引数。
 */
export function parseCliArgv(argv: readonly string[], cwd: string): CliOpenRequest | null {
  const flagIndex = argv.indexOf(CLI_FLAG)
  if (flagIndex < 0) return null
  const separator = argv.indexOf('--', flagIndex + 1)
  const target = separator >= 0 ? argv[separator + 1] : undefined
  return { path: target !== undefined && target !== '' ? target : null, cwd }
}

/** 2 つ目のプロセスから届いた `additionalData` を検める。形が違えば `null`。 */
export function parseCliOpenData(additionalData: unknown): CliOpenRequest | null {
  if (!additionalData || typeof additionalData !== 'object') return null
  const value = (additionalData as Record<string, unknown>)[CLI_OPEN_KEY]
  if (!value || typeof value !== 'object') return null
  const { path: target, cwd } = value as Record<string, unknown>
  if (typeof cwd !== 'string' || cwd === '') return null
  if (target !== null && typeof target !== 'string') return null
  return { path: target === '' ? null : target, cwd }
}

/** 要求のパスを絶対パスにする。 */
export function resolveCliTarget(req: CliOpenRequest, pathApi: typeof path = path): string {
  return pathApi.resolve(req.cwd, req.path ?? '.')
}

/**
 * 主ワークスペースが `target` と一致するサンドボックス。対応表に無いエージェントのもの、
 * すでに登録済みのものは除く。
 */
export function matchSandboxesForPath(
  sandboxes: readonly SbxLsEntry[],
  target: string,
  opts: {
    equals: (a: string, b: string) => boolean
    isSupportedAgent: (agent: string) => boolean
    registeredSandboxIds: ReadonlySet<string>
  }
): SbxLsEntry[] {
  return sandboxes.filter((s) => {
    const workspace = s.workspaces[0]
    if (!workspace || !opts.equals(workspace, target)) return false
    return opts.isSupportedAgent(s.agent) && !opts.registeredSandboxIds.has(s.id)
  })
}

/**
 * 置き場所のシンボリックリンクの状態。
 * - リンクが無い → `notInstalled`
 * - shovel のコマンドラインツールを指している → 自分を指していれば `installed`、別の場所（移動前・別のコピー）なら `stale`
 * - それ以外のファイル・リンク → `foreign`（上書きしない）
 */
export function classifySymlink(
  entry: { kind: 'missing' } | { kind: 'file' } | { kind: 'symlink'; target: string },
  expectedSource: string,
  sourceSuffix: string
): CliInstallState {
  if (entry.kind === 'missing') return 'notInstalled'
  if (entry.kind === 'file') return 'foreign'
  if (entry.target === expectedSource) return 'installed'
  return entry.target.endsWith(sourceSuffix) ? 'stale' : 'foreign'
}

/** シェルスクリプト版の状態（AppImage 用。スクリプトに実行ファイルの場所を書き込んで置く）。 */
export function classifyScript(content: string | null, expectedContent: string): CliInstallState {
  if (content === null) return 'notInstalled'
  if (content === expectedContent) return 'installed'
  return content.includes(CLI_SCRIPT_MARKER) ? 'stale' : 'foreign'
}

/** シェルの単一引用符で囲んだ文字列にする。 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** シェルスクリプト版に、起動する実行ファイルの場所を書き込む。 */
export function scriptWithApp(template: string, appPath: string): string {
  const line = /^SHOVEL_APP=''$/m
  if (!line.test(template)) throw new Error('SHOVEL_APP line not found in the command line tool script')
  return template.replace(line, `SHOVEL_APP=${shellQuote(appPath)}`)
}

/** AppleScript の文字列リテラルにする。 */
export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** PATH 上で `names` のいずれかとして最初に見つかるファイル。`exists` はファイルがあるかを返す（テストで差し替える）。 */
export function findFirstOnPath(
  names: readonly string[],
  pathEnv: string | undefined,
  opts: { delimiter: string; join: (dir: string, name: string) => string; exists: (file: string) => boolean }
): string | null {
  for (const dir of (pathEnv ?? '').split(opts.delimiter)) {
    if (dir === '') continue
    for (const name of names) {
      const file = opts.join(dir, name)
      if (opts.exists(file)) return file
    }
  }
  return null
}

/** `dir` が PATH に含まれているか。 */
export function isDirOnPath(
  dir: string,
  pathEnv: string | undefined,
  opts: { delimiter: string; equals: (a: string, b: string) => boolean }
): boolean {
  return (pathEnv ?? '').split(opts.delimiter).some((entry) => entry !== '' && opts.equals(entry, dir))
}
