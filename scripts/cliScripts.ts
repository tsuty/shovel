import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'

const ROOT = resolve(__dirname, '..')
const OUTPUT_DIR = join(ROOT, 'out', 'cli')
const VERSION_PLACEHOLDER = '__SHOVEL_VERSION__'

function write(): void {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
  mkdirSync(OUTPUT_DIR, { recursive: true })
  for (const [source, output] of [
    ['shovel.sh', 'shovel'],
    ['shovel.cmd', 'shovel.cmd']
  ] as const) {
    const template = readFileSync(join(ROOT, 'resources', 'cli', source), 'utf8')
    if (!template.includes(VERSION_PLACEHOLDER)) throw new Error(`cli scripts: ${source} に ${VERSION_PLACEHOLDER} が無い`)
    const target = join(OUTPUT_DIR, output)
    writeFileSync(target, template.replaceAll(VERSION_PLACEHOLDER, version))
    chmodSync(target, 0o755)
  }
  copyFileSync(join(ROOT, 'resources', 'windows', 'windows-path.ps1'), join(OUTPUT_DIR, 'windows-path.ps1'))
}

/**
 * コマンドラインツール（`resources/cli/`）に版を埋め込み、`out/cli/` に書き出す Vite プラグイン。
 * electron-builder がそこから各 OS の配布物へ入れる（electron-builder.yml）。
 */
export function cliScripts(): Plugin {
  return {
    name: 'shovel-cli-scripts',
    apply: 'build',
    closeBundle: write
  }
}
