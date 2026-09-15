import path from 'node:path'

/**
 * ホストのパスとサンドボックス内のパスの相互変換。architecture.md §4 /
 * decisions.md N-6a を参照。
 *
 * `sandboxPath` は常にサンドボックス（Linux コンテナ）内の POSIX パスであり、
 * ホスト側の実行 OS が何であれ `path.posix` で扱う。`hostPath` はホストの
 * ネイティブな表現（macOS/Linux なら POSIX、Windows なら `path.win32` 相当）
 * であり、この main プロセスが動いている OS のネイティブ `path` を使う。
 *
 * 変換は「ワークスペースルートを起点にした相対パス」で行う。マウント規則
 * （Windows は MSYS 形式で `C:\...` → `/c/...` など）を推測せず、
 * `Project.sandboxPath` は必ず `sbx exec <name> pwd` で実測した値を使うこと。
 */

export interface PathTranslationRoots {
  hostPath: string
  sandboxPath: string
}

export function hostToSandboxPath(roots: PathTranslationRoots, hostAbsPath: string): string {
  const rel = path.relative(roots.hostPath, hostAbsPath)
  if (rel.startsWith('..')) {
    throw new Error(`path ${hostAbsPath} is outside of project root ${roots.hostPath}`)
  }
  const relPosix = rel.split(path.sep).join('/')
  return relPosix === '' ? roots.sandboxPath : path.posix.join(roots.sandboxPath, relPosix)
}

export function sandboxToHostPath(roots: PathTranslationRoots, sandboxAbsPath: string): string {
  const rel = path.posix.relative(roots.sandboxPath, sandboxAbsPath)
  if (rel.startsWith('..')) {
    throw new Error(`path ${sandboxAbsPath} is outside of sandbox workspace ${roots.sandboxPath}`)
  }
  const relParts = rel === '' ? [] : rel.split('/')
  return relParts.length === 0 ? roots.hostPath : path.join(roots.hostPath, ...relParts)
}

/**
 * `sbx ls --json` の `workspaces` と `Project.hostPath` の照合。
 * Windows のホストパスは case-insensitive なので、そこでのみ正規化する
 * （architecture.md §4「Windows 固有の考慮」）。
 */
export function hostPathsEqual(a: string, b: string): boolean {
  const normalize = (p: string): string => {
    const normalized = path.normalize(p).replace(/[/\\]+$/, '')
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
  return normalize(a) === normalize(b)
}
