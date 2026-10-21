import path from 'node:path'
import { hostPathsEqual, hostToSandboxPath, sandboxToHostPath } from '@main/domain/pathTranslate'

const hostRoot = process.platform === 'win32' ? 'C:\\Users\\me\\project' : '/Users/me/project'
const roots = { hostPath: hostRoot, sandboxPath: '/workspace/project' }
const host = (...parts: string[]): string => path.join(hostRoot, ...parts)

describe('hostToSandboxPath', () => {
  it('ルート直下のファイルを変換する', () => {
    expect(hostToSandboxPath(roots, host('README.md'))).toBe('/workspace/project/README.md')
  })

  it('深い階層を変換する', () => {
    expect(hostToSandboxPath(roots, host('src', 'a', 'b.ts'))).toBe('/workspace/project/src/a/b.ts')
  })

  it('ルートそのものはサンドボックスのルートになる', () => {
    expect(hostToSandboxPath(roots, hostRoot)).toBe('/workspace/project')
  })

  it('プロジェクト外のパスは拒否する', () => {
    expect(() => hostToSandboxPath(roots, host('..', 'other', 'a.txt'))).toThrow(/outside/)
    expect(() => hostToSandboxPath(roots, host('..'))).toThrow(/outside/)
  })

  it('".." で始まる名前のファイルはプロジェクト内として扱う', () => {
    expect(hostToSandboxPath(roots, host('..env'))).toBe('/workspace/project/..env')
  })
})

describe('sandboxToHostPath', () => {
  it('ルート直下のファイルを変換する', () => {
    expect(sandboxToHostPath(roots, '/workspace/project/README.md')).toBe(host('README.md'))
  })

  it('ルートそのものはホストのルートになる', () => {
    expect(sandboxToHostPath(roots, '/workspace/project')).toBe(hostRoot)
  })

  it('ワークスペース外のパスは拒否する', () => {
    expect(() => sandboxToHostPath(roots, '/etc/passwd')).toThrow(/outside/)
  })

  it('".." で始まる名前のファイルはワークスペース内として扱う', () => {
    expect(sandboxToHostPath(roots, '/workspace/project/..env')).toBe(host('..env'))
  })

  it('往復で元に戻る', () => {
    const hostPath = host('docs', '日本語 ファイル.md')
    expect(sandboxToHostPath(roots, hostToSandboxPath(roots, hostPath))).toBe(hostPath)
  })
})

describe('hostPathsEqual', () => {
  it('末尾の区切り文字と冗長な区切りを無視する', () => {
    expect(hostPathsEqual('/Users/me/project/', '/Users/me//project')).toBe(true)
  })

  it('別のディレクトリは一致しない', () => {
    expect(hostPathsEqual('/Users/me/project', '/Users/me/project2')).toBe(false)
  })
})
