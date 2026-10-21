import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import license from 'rollup-plugin-license'
import type { Plugin } from 'vite'

/** 一覧の 1 項目。 */
interface Notice {
  name: string
  version: string
  license: string
  repository: string | null
  licenseText: string | null
  noticeText: string | null
}

const ROOT = resolve(__dirname, '..')
const OUTPUT_FILE = join(ROOT, 'out', 'THIRD_PARTY_NOTICES.txt')
const RULE = '='.repeat(80)
const THIN_RULE = '-'.repeat(80)

/** main / preload / renderer の各ビルドで集まった項目（`name@version` → 項目）。 */
const collected = new Map<string, Notice>()

function repositoryUrl(repository: unknown): string | null {
  if (typeof repository === 'string') return repository
  if (repository && typeof repository === 'object' && 'url' in repository) {
    const url = (repository as { url: unknown }).url
    return typeof url === 'string' ? url : null
  }
  return null
}

function readFirstMatching(dir: string, pattern: RegExp): string | null {
  const file = readdirSync(dir).find((f) => pattern.test(f))
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null
}

/** `fromDir` から親へ遡って `node_modules/<name>` を探し、実体のディレクトリを返す。 */
function findPackageDir(name: string, fromDir: string): string | null {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** `package.json` の `dependencies` を推移的に辿り、`app.asar` に入る実行時依存を集める。 */
function collectRuntimeDependencies(): void {
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const queue = Object.keys(rootPkg.dependencies ?? {}).map((name) => ({ name, fromDir: ROOT }))
  const visited = new Set<string>()
  for (let item = queue.shift(); item; item = queue.shift()) {
    const dir = findPackageDir(item.name, item.fromDir)
    if (!dir) throw new Error(`third-party notices: ${item.name} が見つからない`)
    if (visited.has(dir)) continue
    visited.add(dir)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name: string
      version: string
      license?: unknown
      repository?: unknown
      dependencies?: Record<string, string>
    }
    collected.set(`${pkg.name}@${pkg.version}`, {
      name: pkg.name,
      version: pkg.version,
      license: typeof pkg.license === 'string' ? pkg.license : 'UNKNOWN',
      repository: repositoryUrl(pkg.repository),
      licenseText: readFirstMatching(dir, /^(licen[cs]e|copying)(\.|-|$)/i),
      noticeText: readFirstMatching(dir, /^notice(\.|$)/i)
    })
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, fromDir: dir })
  }
}

function render(): string {
  const notices = [...collected.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)
  )
  const header = [
    'shovel THIRD-PARTY SOFTWARE NOTICES',
    '',
    'This application includes the following third-party software.',
    'Electron and Chromium notices are in LICENSE.electron.txt and LICENSES.chromium.html.',
    ''
  ].join('\n')
  const body = notices.map((n) =>
    [
      RULE,
      `${n.name}@${n.version}`,
      `License: ${n.license}`,
      ...(n.repository ? [`Source: ${n.repository}`] : []),
      THIN_RULE,
      n.licenseText ?? '(No license file is included in this package.)',
      ...(n.noticeText ? ['', n.noticeText] : []),
      ''
    ].join('\n')
  )
  return [header, ...body].join('\n')
}

function write(): void {
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
  writeFileSync(OUTPUT_FILE, render(), 'utf8')
}

/**
 * バンドルに含まれたサードパーティパッケージを `out/THIRD_PARTY_NOTICES.txt` に書き出す
 * Vite プラグイン。main / preload / renderer の各ビルドに入れると、その時点までに集まった
 * 全項目（実行時依存を含む）で毎回書き直す。
 */
export function thirdPartyNotices(): Plugin {
  if (collected.size === 0) collectRuntimeDependencies()
  return license({
    thirdParty: {
      output: (dependencies) => {
        for (const dep of dependencies) {
          if (!dep.name || !dep.version) continue
          collected.set(`${dep.name}@${dep.version}`, {
            name: dep.name,
            version: dep.version,
            license: dep.license ?? 'UNKNOWN',
            repository: repositoryUrl(dep.repository),
            licenseText: dep.licenseText?.trim() ?? null,
            noticeText: dep.noticeText?.trim() ?? null
          })
        }
        write()
      }
    }
  }) as Plugin
}
