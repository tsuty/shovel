import { NO_PYTHON_MARKER, resizeSequence, ttyCommandArgv } from '@main/sbx/ptyWrapper'

describe('ttyCommandArgv', () => {
  it('runs the command through /bin/sh -lc after the size arguments', () => {
    const argv = ttyCommandArgv('claude mcp add', 120, 40)
    expect(argv.slice(0, 2)).toEqual(['/bin/sh', '-c'])
    expect(argv.slice(4)).toEqual(['120', '40', '/bin/sh', '-lc', 'claude mcp add'])
  })

  it('checks for python3 and prints the marker when it is missing', () => {
    const bootstrap = ttyCommandArgv('ls', 80, 24)[2] ?? ''
    expect(bootstrap).toContain('command -v python3')
    expect(bootstrap).toContain(NO_PYTHON_MARKER)
    expect(bootstrap).toContain('exec python3 -c "$0" "$@"')
  })

  it('embeds the wrapper as base64 so the argument has no quotes or newlines inside the payload', () => {
    const boot = ttyCommandArgv('ls', 80, 24)[3] ?? ''
    const match = /^import base64;exec\(base64\.b64decode\('([A-Za-z0-9+/=]+)'\)\)$/.exec(boot)
    expect(match).not.toBeNull()
    const source = Buffer.from(match?.[1] ?? '', 'base64').toString('utf8')
    expect(source).toContain('pty.fork()')
    expect(source).toContain("os.environ['TERM'] = 'xterm-256color'")
    expect(source).toContain('shovel-resize')
  })

  it('clamps sizes to a positive integer', () => {
    const argv = ttyCommandArgv('ls', 0, Number.NaN)
    expect(argv.slice(4, 6)).toEqual(['1', '1'])
    expect(ttyCommandArgv('ls', 80.7, 24.2).slice(4, 6)).toEqual(['80', '24'])
  })
})

describe('resizeSequence', () => {
  it('builds the in-band OSC sequence the wrapper strips out', () => {
    expect(resizeSequence(100, 30)).toBe('\x1b]777;shovel-resize;100;30\x07')
  })

  it('clamps sizes', () => {
    expect(resizeSequence(-5, 100000)).toBe('\x1b]777;shovel-resize;1;9999\x07')
  })
})
