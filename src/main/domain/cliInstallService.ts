import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, readFile, readlink, realpath, symlink, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import type { CliInstallResult, CliInstallState, CliInstallStatus } from '@shared/types/cli'
import { resolveLocale } from '../locale'
import { hostPathsEqual } from './pathTranslate'
import {
  appleScriptString,
  classifyScript,
  classifySymlink,
  findFirstOnPath,
  isDirOnPath,
  scriptWithApp,
  shellQuote
} from './cliCommand'

/** OS ごとの入れ方。 */
type Plan =
  | {
      method: 'symlink'
      /** 置くリンク。 */
      location: string
      /** リンク先（配布物の中のコマンドラインツール）。 */
      source: string
      /** 移動前・別のコピーの shovel を指すリンクを見分けるための、リンク先の末尾。 */
      sourceSuffix: string
      /** 書き込めなければ管理者権限で置き直す（macOS の `/usr/local/bin`）。 */
      elevate: boolean
    }
  | { method: 'script'; location: string; source: string; appPath: string }
  | { method: 'windowsPath'; location: string; script: string }
  | { method: 'package'; location: string; source: string }

const labels = {
  en: { prompt: 'shovel wants to install or remove the "shovel" command in /usr/local/bin.' },
  ja: { prompt: 'shovel が /usr/local/bin に「shovel」コマンドを置く（または外す）ために、管理者権限が必要です。' }
} as const

class CancelledError extends Error {}

function plan(): Plan | 'dev' | 'unsupported' {
  if (!app.isPackaged) return 'dev'
  const source = path.join(process.resourcesPath, 'bin', 'shovel')
  const localBin = path.join(homedir(), '.local', 'bin', 'shovel')
  if (process.platform === 'darwin') {
    return {
      method: 'symlink',
      location: '/usr/local/bin/shovel',
      source,
      sourceSuffix: '/Contents/Resources/bin/shovel',
      elevate: true
    }
  }
  if (process.platform === 'linux') {
    if (process.env.APPIMAGE) return { method: 'script', location: localBin, source, appPath: process.env.APPIMAGE }
    if (process.execPath.startsWith('/opt/')) return { method: 'package', location: '/usr/bin/shovel', source }
    return { method: 'symlink', location: localBin, source, sourceSuffix: '/resources/bin/shovel', elevate: false }
  }
  if (process.platform === 'win32') {
    return {
      method: 'windowsPath',
      location: path.join(path.dirname(process.execPath), 'bin'),
      script: path.join(process.resourcesPath, 'cli', 'windows-path.ps1')
    }
  }
  return 'unsupported'
}

export async function getCliInstallStatus(): Promise<CliInstallStatus> {
  const p = plan()
  if (typeof p === 'string') return { available: false, reason: p }
  return statusOf(p)
}

export async function installCli(): Promise<CliInstallResult> {
  return change('install')
}

export async function uninstallCli(): Promise<CliInstallResult> {
  return change('uninstall')
}

async function change(action: 'install' | 'uninstall'): Promise<CliInstallResult> {
  const p = plan()
  if (typeof p === 'string') return { status: { available: false, reason: p }, cancelled: false }
  const before = await statusOf(p)
  if (!before.available) return { status: before, cancelled: false }
  try {
    if (action === 'install') {
      if (before.state === 'foreign') throw new Error(`another file is already at ${p.location}`)
      if (before.state !== 'installed') await install(p)
    } else if (before.state === 'installed' || before.state === 'stale') {
      await uninstall(p)
    }
  } catch (err) {
    if (err instanceof CancelledError) return { status: before, cancelled: true }
    throw err
  }
  return { status: await statusOf(p), cancelled: false }
}

async function statusOf(p: Plan): Promise<CliInstallStatus> {
  let state: CliInstallState
  let managedByInstaller = false
  switch (p.method) {
    case 'symlink':
      state = classifySymlink(await readEntry(p.location), p.source, p.sourceSuffix)
      break
    case 'script':
      state = classifyScript(await readFile(p.location, 'utf8').catch(() => null), await scriptFor(p))
      break
    case 'package':
      state = await packageState(p)
      break
    case 'windowsPath': {
      const [user, machine] = await Promise.all([
        windowsPath(p, 'status', 'User'),
        windowsPath(p, 'status', 'Machine')
      ])
      managedByInstaller = machine === 'present'
      state = user === 'present' || managedByInstaller ? 'installed' : 'notInstalled'
      break
    }
  }
  const dir = p.method === 'windowsPath' ? p.location : path.dirname(p.location)
  return {
    available: true,
    method: p.method,
    state,
    location: p.location,
    dirNotOnPath: (p.method === 'symlink' || p.method === 'script') && !isDirOnPath(dir, process.env.PATH, pathOpts),
    shadowedBy: shadowingCommand(p),
    managedByInstaller
  }
}

const pathOpts = { delimiter: path.delimiter, equals: (a: string, b: string) => hostPathsEqual(a, b) }

/** PATH 上で、入れたコマンドより先に見つかる別の `shovel`。 */
function shadowingCommand(p: Plan): string | null {
  const names = process.platform === 'win32' ? ['shovel.cmd', 'shovel.exe', 'shovel.bat'] : ['shovel']
  const first = findFirstOnPath(names, process.env.PATH, { delimiter: path.delimiter, join: path.join, exists: existsSync })
  if (!first) return null
  const ours = p.method === 'windowsPath' ? hostPathsEqual(path.dirname(first), p.location) : hostPathsEqual(first, p.location)
  return ours ? null : first
}

async function readEntry(
  file: string
): Promise<{ kind: 'missing' } | { kind: 'file' } | { kind: 'symlink'; target: string }> {
  const info = await lstat(file).catch(() => null)
  if (!info) return { kind: 'missing' }
  if (!info.isSymbolicLink()) return { kind: 'file' }
  return { kind: 'symlink', target: await readlink(file) }
}

async function scriptFor(p: Extract<Plan, { method: 'script' }>): Promise<string> {
  return scriptWithApp(await readFile(p.source, 'utf8'), p.appPath)
}

/** deb が置いた `/usr/bin/shovel` が、この版のコマンドラインツールを指しているか。 */
async function packageState(p: Extract<Plan, { method: 'package' }>): Promise<CliInstallState> {
  const target = await realpath(p.location).catch(() => null)
  if (!target) return 'notInstalled'
  if (target === (await realpath(p.source).catch(() => p.source))) return 'installed'
  // 以前の版の deb は Electron の実行ファイルを指していた。パッケージを入れ直せば直る。
  return target === process.execPath ? 'stale' : 'foreign'
}

async function install(p: Plan): Promise<void> {
  switch (p.method) {
    case 'symlink':
      await withElevation(p, `mkdir -p ${shellQuote(path.dirname(p.location))} && ln -sfn ${shellQuote(p.source)} ${shellQuote(p.location)}`, async () => {
        await mkdir(path.dirname(p.location), { recursive: true })
        await unlink(p.location).catch(ignoreMissing)
        await symlink(p.source, p.location)
      })
      return
    case 'script':
      await mkdir(path.dirname(p.location), { recursive: true })
      await writeFile(p.location, await scriptFor(p), { mode: 0o755 })
      await chmod(p.location, 0o755)
      return
    case 'windowsPath':
      await windowsPath(p, 'add', 'User')
      return
    case 'package':
      throw new Error('the command line tool is installed by the package')
  }
}

async function uninstall(p: Plan): Promise<void> {
  switch (p.method) {
    case 'symlink':
      await withElevation(p, `rm -f ${shellQuote(p.location)}`, () => unlink(p.location).catch(ignoreMissing))
      return
    case 'script':
      await unlink(p.location).catch(ignoreMissing)
      return
    case 'windowsPath':
      await windowsPath(p, 'remove', 'User')
      return
    case 'package':
      throw new Error('the command line tool is removed with the package')
  }
}

function ignoreMissing(err: NodeJS.ErrnoException): void {
  if (err.code !== 'ENOENT') throw err
}

/** まず自分の権限で試し、書き込めなければ OS の認証ダイアログを出して管理者権限で実行する（macOS）。 */
async function withElevation(
  p: Extract<Plan, { method: 'symlink' }>,
  command: string,
  direct: () => Promise<void>
): Promise<void> {
  try {
    await direct()
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (!p.elevate || (code !== 'EACCES' && code !== 'EPERM')) throw err
    const script = `do shell script ${appleScriptString(command)} with prompt ${appleScriptString(labels[resolveLocale()].prompt)} with administrator privileges`
    await new Promise<void>((resolve, reject) => {
      execFile('osascript', ['-e', script], (error, _stdout, stderr) => {
        if (!error) resolve()
        // -128: 利用者が認証ダイアログを取り消した。
        else if (stderr.includes('-128')) reject(new CancelledError())
        else reject(new Error(stderr.trim() || error.message))
      })
    })
  }
}

/** `windows-path.ps1` で PATH（レジストリ）を確かめる・書き換える。 */
function windowsPath(
  p: Extract<Plan, { method: 'windowsPath' }>,
  action: 'add' | 'remove' | 'status',
  scope: 'User' | 'Machine'
): Promise<string> {
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', p.script]
  args.push('-Action', action, '-Scope', scope, '-Dir', p.location)
  return new Promise((resolve, reject) => {
    execFile(powershell, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message))
      else resolve(stdout.trim())
    })
  })
}
