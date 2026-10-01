import path from 'node:path'

/**
 * ホストのパスとサンドボックス内のパスの相互変換。
 *
 * `sandboxPath` は `path.posix`、`hostPath` は実行 OS のネイティブ `path` で扱い、
 * ワークスペースルートを起点にした相対パスで変換する。
 */

export interface PathTranslationRoots {
  hostPath: string
  sandboxPath: string
}

function isOutside(rel: string, sep: string, isAbsolute: (p: string) => boolean): boolean {
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

export function hostToSandboxPath(roots: PathTranslationRoots, hostAbsPath: string): string {
  const rel = path.relative(roots.hostPath, hostAbsPath)
  if (isOutside(rel, path.sep, path.isAbsolute)) {
    throw new Error(`path ${hostAbsPath} is outside of project root ${roots.hostPath}`)
  }
  const relPosix = rel.split(path.sep).join('/')
  return relPosix === '' ? roots.sandboxPath : path.posix.join(roots.sandboxPath, relPosix)
}

export function sandboxToHostPath(roots: PathTranslationRoots, sandboxAbsPath: string): string {
  const rel = path.posix.relative(roots.sandboxPath, sandboxAbsPath)
  if (isOutside(rel, '/', path.posix.isAbsolute)) {
    throw new Error(`path ${sandboxAbsPath} is outside of sandbox workspace ${roots.sandboxPath}`)
  }
  const relParts = rel === '' ? [] : rel.split('/')
  return relParts.length === 0 ? roots.hostPath : path.join(roots.hostPath, ...relParts)
}

/** `sbx ls --json` の `workspaces` と `Project.hostPath` を照合する（Windows では大文字小文字を無視）。 */
export function hostPathsEqual(a: string, b: string): boolean {
  const normalize = (p: string): string => {
    const normalized = path.normalize(p).replace(/[/\\]+$/, '')
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
  return normalize(a) === normalize(b)
}
