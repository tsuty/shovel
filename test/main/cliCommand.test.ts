import path from 'node:path'
import type { SbxLsEntry } from '@shared/types/sbx'
import {
  appleScriptString,
  CLI_OPEN_KEY,
  CLI_SCRIPT_MARKER,
  classifyScript,
  classifySymlink,
  findFirstOnPath,
  isDirOnPath,
  matchSandboxesForPath,
  parseCliArgv,
  parseCliOpenData,
  resolveCliTarget,
  scriptWithApp,
  shellQuote
} from '@main/domain/cliCommand'

describe('parseCliArgv', () => {
  it('目印が無ければ null', () => {
    expect(parseCliArgv(['/opt/shovel/shovel'], '/home/u')).toBeNull()
    expect(parseCliArgv(['/opt/shovel/shovel', '--', '/tmp'], '/home/u')).toBeNull()
  })

  it('パスを省略したら null（カレントディレクトリ）', () => {
    expect(parseCliArgv(['/opt/shovel/shovel', '--shovel-cli'], '/home/u')).toEqual({ path: null, cwd: '/home/u' })
  })

  it('目印の後の -- に続く引数をパスにする', () => {
    expect(parseCliArgv(['shovel', '--no-sandbox', '--shovel-cli', '--', '-odd name'], '/w')).toEqual({
      path: '-odd name',
      cwd: '/w'
    })
  })

  it('目印より前の -- は使わない', () => {
    expect(parseCliArgv(['shovel', '--', 'x', '--shovel-cli'], '/w')).toEqual({ path: null, cwd: '/w' })
  })
})

describe('parseCliOpenData', () => {
  it('正しい形だけを受け付ける', () => {
    expect(parseCliOpenData({ [CLI_OPEN_KEY]: { path: 'a', cwd: '/w' } })).toEqual({ path: 'a', cwd: '/w' })
    expect(parseCliOpenData({ [CLI_OPEN_KEY]: { path: null, cwd: '/w' } })).toEqual({ path: null, cwd: '/w' })
    expect(parseCliOpenData({ [CLI_OPEN_KEY]: { path: '', cwd: '/w' } })).toEqual({ path: null, cwd: '/w' })
  })

  it('形が違えば null', () => {
    expect(parseCliOpenData(undefined)).toBeNull()
    expect(parseCliOpenData({})).toBeNull()
    expect(parseCliOpenData({ [CLI_OPEN_KEY]: { path: 1, cwd: '/w' } })).toBeNull()
    expect(parseCliOpenData({ [CLI_OPEN_KEY]: { path: 'a' } })).toBeNull()
    expect(parseCliOpenData({ [CLI_OPEN_KEY]: { path: 'a', cwd: '' } })).toBeNull()
  })
})

describe('resolveCliTarget', () => {
  it('カレントディレクトリを起点に絶対パスにする', () => {
    expect(resolveCliTarget({ path: null, cwd: '/w/p' }, path.posix)).toBe('/w/p')
    expect(resolveCliTarget({ path: '.', cwd: '/w/p' }, path.posix)).toBe('/w/p')
    expect(resolveCliTarget({ path: '../q/', cwd: '/w/p' }, path.posix)).toBe('/w/q')
    expect(resolveCliTarget({ path: '/abs', cwd: '/w/p' }, path.posix)).toBe('/abs')
  })

  it('Windows のパス', () => {
    expect(resolveCliTarget({ path: 'sub', cwd: 'C:\\work' }, path.win32)).toBe('C:\\work\\sub')
  })
})

describe('matchSandboxesForPath', () => {
  const sandbox = (over: Partial<SbxLsEntry>): SbxLsEntry => ({
    name: 'sb',
    id: 'id',
    agent: 'claude',
    status: 'running',
    workspaces: ['/w/p'],
    ...over
  })
  const opts = {
    equals: (a: string, b: string) => a === b,
    isSupportedAgent: (agent: string) => agent === 'claude',
    registeredSandboxIds: new Set(['taken'])
  }

  it('主ワークスペースが一致するものだけ', () => {
    const list = [
      sandbox({ name: 'a', id: '1' }),
      sandbox({ name: 'b', id: '2', workspaces: ['/w/other', '/w/p'] }),
      sandbox({ name: 'c', id: '3', status: 'stopped' }),
      sandbox({ name: 'd', id: '4', workspaces: [] })
    ]
    expect(matchSandboxesForPath(list, '/w/p', opts).map((s) => s.name)).toEqual(['a', 'c'])
  })

  it('対応表に無いエージェントと登録済みのものは除く', () => {
    const list = [sandbox({ name: 'a', id: '1', agent: 'unknown' }), sandbox({ name: 'b', id: 'taken' })]
    expect(matchSandboxesForPath(list, '/w/p', opts)).toEqual([])
  })
})

describe('classifySymlink', () => {
  const source = '/Applications/shovel.app/Contents/Resources/bin/shovel'
  const suffix = '/Contents/Resources/bin/shovel'

  it('状態を見分ける', () => {
    expect(classifySymlink({ kind: 'missing' }, source, suffix)).toBe('notInstalled')
    expect(classifySymlink({ kind: 'file' }, source, suffix)).toBe('foreign')
    expect(classifySymlink({ kind: 'symlink', target: source }, source, suffix)).toBe('installed')
    expect(
      classifySymlink({ kind: 'symlink', target: '/Users/u/Downloads/shovel.app/Contents/Resources/bin/shovel' }, source, suffix)
    ).toBe('stale')
    expect(classifySymlink({ kind: 'symlink', target: '/usr/local/Cellar/shovel/bin/shovel' }, source, suffix)).toBe(
      'foreign'
    )
  })
})

describe('scriptWithApp / classifyScript', () => {
  const template = `#!/bin/sh\n${CLI_SCRIPT_MARKER}\nSHOVEL_APP=''\necho "$SHOVEL_APP"\n`

  it('実行ファイルの場所を単一引用符で書き込む', () => {
    expect(scriptWithApp(template, "/home/u/it's/shovel.AppImage")).toContain(
      `SHOVEL_APP='/home/u/it'\\''s/shovel.AppImage'\n`
    )
  })

  it('書き込む行が無ければ例外', () => {
    expect(() => scriptWithApp('#!/bin/sh\n', '/x')).toThrow()
  })

  it('状態を見分ける', () => {
    const expected = scriptWithApp(template, '/a/shovel.AppImage')
    expect(classifyScript(null, expected)).toBe('notInstalled')
    expect(classifyScript(expected, expected)).toBe('installed')
    expect(classifyScript(scriptWithApp(template, '/old/shovel.AppImage'), expected)).toBe('stale')
    expect(classifyScript('#!/bin/sh\necho other\n', expected)).toBe('foreign')
  })
})

describe('quoting', () => {
  it('shellQuote', () => {
    expect(shellQuote('/a b/c')).toBe(`'/a b/c'`)
    expect(shellQuote(`a'b`)).toBe(`'a'\\''b'`)
  })

  it('appleScriptString', () => {
    expect(appleScriptString(`ln -s '/a "b"\\c'`)).toBe(`"ln -s '/a \\"b\\"\\\\c'"`)
  })
})

describe('findFirstOnPath / isDirOnPath', () => {
  const files = new Set(['/usr/bin/shovel', '/home/u/.local/bin/shovel'])
  const opts = { delimiter: ':', join: path.posix.join, exists: (f: string) => files.has(f) }

  it('PATH の順で最初に見つかるもの', () => {
    expect(findFirstOnPath(['shovel'], '/home/u/.local/bin::/usr/bin', opts)).toBe('/home/u/.local/bin/shovel')
    expect(findFirstOnPath(['shovel'], '/bin:/usr/bin', opts)).toBe('/usr/bin/shovel')
    expect(findFirstOnPath(['shovel'], '/bin', opts)).toBeNull()
    expect(findFirstOnPath(['shovel'], undefined, opts)).toBeNull()
  })

  it('ディレクトリが PATH にあるか', () => {
    const o = { delimiter: ':', equals: (a: string, b: string) => a.replace(/\/$/, '') === b.replace(/\/$/, '') }
    expect(isDirOnPath('/home/u/.local/bin', '/usr/bin:/home/u/.local/bin/', o)).toBe(true)
    expect(isDirOnPath('/home/u/.local/bin', '/usr/bin', o)).toBe(false)
  })
})
