import { execFile } from 'node:child_process'
import path, { delimiter } from 'node:path'
import { homedir, userInfo } from 'node:os'

/**
 * Finder / Dock / デスクトップランチャーから起動した GUI アプリは、ログインシェルの PATH
 * （Homebrew の `/opt/homebrew/bin` など）を受け取らない。そのままだと `sbx` が見つからない
 * ため、起動時に一度だけユーザーのログインシェルから PATH を取得して `process.env.PATH` に
 * 合わせる。Windows は対象外（GUI アプリもユーザーの PATH を受け取る）。
 */

const START_MARKER = '__SHOVEL_PATH_START__'
const END_MARKER = '__SHOVEL_PATH_END__'
// rc ファイルで nvm などを読み込むと数秒かかることがあるので、余裕を持たせる。
const TIMEOUT_MS = 10000

/** シェルの出力から、マーカーに挟まれた PATH を取り出す。rc ファイルが出す余計な出力は無視する。 */
export function extractMarkedPath(output: string): string | null {
  const start = output.lastIndexOf(START_MARKER)
  if (start < 0) return null
  const end = output.indexOf(END_MARKER, start + START_MARKER.length)
  if (end < 0) return null
  const value = output.slice(start + START_MARKER.length, end).trim()
  return value.length > 0 ? value : null
}

/** シェルの PATH を優先し、現在の PATH にしか無いエントリを後ろに残す（重複・空要素は除く）。 */
export function mergePath(shellPath: string, currentPath: string | undefined, sep: string = delimiter): string {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const entry of [...shellPath.split(sep), ...(currentPath ?? '').split(sep)]) {
    if (entry.length === 0 || seen.has(entry)) continue
    seen.add(entry)
    merged.push(entry)
  }
  return merged.join(sep)
}

function loginShell(): string {
  if (process.env.SHELL) return process.env.SHELL
  try {
    const shell = userInfo().shell
    if (shell) return shell
  } catch {
    // userInfo() はユーザー情報が引けない環境で投げる。
  }
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
}

function readLoginShellPath(): Promise<string | null> {
  // `$PATH__…` だと変数名が続いてしまうので `${PATH}` と波括弧で区切る。
  const script = `printf '%s' "${START_MARKER}\${PATH}${END_MARKER}"`
  return new Promise((resolve) => {
    const child = execFile(
      loginShell(),
      ['-ilc', script],
      {
        timeout: TIMEOUT_MS,
        encoding: 'utf8',
        // oh-my-zsh の自動更新確認などで止まらないようにする。
        env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' }
      },
      (err, stdout) => {
        // rc ファイル内のコマンドが失敗して非0で終わっても、PATH 自体は出力されていることがある。
        const extracted = extractMarkedPath(stdout)
        if (err && !extracted) console.warn('[startup] failed to read PATH from the login shell', err)
        resolve(extracted)
      }
    )
    // 対話シェルが stdin を待って固まらないよう、すぐ閉じる。
    child.stdin?.end()
  })
}

/**
 * ログインシェルから PATH を取れなかったときの保険。`sbx` がよく置かれる場所を現在の PATH の後ろに足す
 * （存在しないディレクトリが混じっても害は無い）。
 */
function fallbackDirs(): string[] {
  const home = homedir()
  return ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin'), path.join(home, '.docker', 'bin')]
}

/**
 * ログインシェルの PATH を `process.env.PATH` に取り込む。失敗しても起動は止めない。
 * 起動時のほか、`sbx` が見つからなかったときの再確認でも呼び直す。
 */
export async function applyLoginShellPath(): Promise<void> {
  if (process.platform === 'win32') return
  const shellPath = await readLoginShellPath()
  const withShell = shellPath ? mergePath(shellPath, process.env.PATH) : process.env.PATH
  process.env.PATH = mergePath(withShell ?? '', fallbackDirs().join(delimiter))
}
