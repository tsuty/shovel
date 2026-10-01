import { hostPathsEqual, hostToSandboxPath, sandboxToHostPath } from '@main/domain/pathTranslate'

const roots = { hostPath: '/Users/me/project', sandboxPath: '/workspace/project' }

describe('hostToSandboxPath', () => {
  it('ルート直下のファイルを変換する', () => {
    expect(hostToSandboxPath(roots, '/Users/me/project/README.md')).toBe('/workspace/project/README.md')
  })

  it('深い階層を変換する', () => {
    expect(hostToSandboxPath(roots, '/Users/me/project/src/a/b.ts')).toBe('/workspace/project/src/a/b.ts')
  })

  it('ルートそのものはサンドボックスのルートになる', () => {
    expect(hostToSandboxPath(roots, '/Users/me/project')).toBe('/workspace/project')
  })

  it('プロジェクト外のパスは拒否する', () => {
    expect(() => hostToSandboxPath(roots, '/Users/me/other/a.txt')).toThrow(/outside/)
    expect(() => hostToSandboxPath(roots, '/Users/me')).toThrow(/outside/)
  })

  it('".." で始まる名前のファイルはプロジェクト内として扱う', () => {
    expect(hostToSandboxPath(roots, '/Users/me/project/..env')).toBe('/workspace/project/..env')
  })
})

describe('sandboxToHostPath', () => {
  it('ルート直下のファイルを変換する', () => {
    expect(sandboxToHostPath(roots, '/workspace/project/README.md')).toBe('/Users/me/project/README.md')
  })

  it('ルートそのものはホストのルートになる', () => {
    expect(sandboxToHostPath(roots, '/workspace/project')).toBe('/Users/me/project')
  })

  it('ワークスペース外のパスは拒否する', () => {
    expect(() => sandboxToHostPath(roots, '/etc/passwd')).toThrow(/outside/)
  })

  it('".." で始まる名前のファイルはワークスペース内として扱う', () => {
    expect(sandboxToHostPath(roots, '/workspace/project/..env')).toBe('/Users/me/project/..env')
  })

  it('往復で元に戻る', () => {
    const host = '/Users/me/project/docs/日本語 ファイル.md'
    expect(sandboxToHostPath(roots, hostToSandboxPath(roots, host))).toBe(host)
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
