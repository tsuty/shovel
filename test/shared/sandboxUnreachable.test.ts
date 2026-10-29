import {
  classifyExecFailure,
  classifySbxFailure,
  listedSandboxProblem,
  parseSandboxUnreachableMessage,
  sandboxUnreachableMessage
} from '@shared/sandboxUnreachable'

const pass = (name: string) => ({ name, status: 'pass' })

describe('classifySbxFailure', () => {
  it('treats a failed Authentication check as not signed in, even if other checks fail too', () => {
    const checks = [
      { name: 'Authentication', status: 'fail', message: 'not signed in', hint: 'Run: sbx login' },
      { name: 'Daemon', status: 'fail', message: 'down' }
    ]
    expect(classifySbxFailure(checks)).toEqual({ reason: 'notSignedIn' })
  })

  it('lists other failed checks with their hints', () => {
    const checks = [
      pass('Authentication'),
      { name: 'Daemon', status: 'fail', message: 'not running', hint: 'Start Docker' },
      { name: 'Network', status: 'fail' },
      { name: 'Disk', status: 'warn', message: 'low' }
    ]
    expect(classifySbxFailure(checks)).toEqual({
      reason: 'diagnoseFailed',
      detail: 'Daemon: not running — Start Docker\nNetwork: fail'
    })
  })

  it('is unknown when diagnose passes or is unavailable', () => {
    expect(classifySbxFailure([pass('Authentication')])).toEqual({ reason: 'unknown' })
    expect(classifySbxFailure(null)).toEqual({ reason: 'unknown' })
  })
})

describe('listedSandboxProblem', () => {
  it('reports a missing sandbox or workspace, and nothing otherwise', () => {
    expect(listedSandboxProblem(null)).toEqual({ reason: 'missing' })
    expect(listedSandboxProblem({ status: 'running', workspace_missing: true })).toEqual({ reason: 'workspaceMissing' })
    expect(listedSandboxProblem({ status: 'stopped' })).toBeNull()
    expect(listedSandboxProblem({ status: 'running' })).toBeNull()
  })
})

describe('classifyExecFailure', () => {
  it('blames the automatic start only when the sandbox was listed as stopped', () => {
    expect(classifyExecFailure({ status: 'stopped' })).toEqual({ reason: 'stopped' })
    expect(classifyExecFailure({ status: 'running' })).toEqual({ reason: 'unknown' })
  })
})

describe('sandbox unreachable message', () => {
  it('round-trips through an IPC-wrapped error message', () => {
    const info = { reason: 'diagnoseFailed' as const, detail: 'Daemon: down\nNetwork: fail' }
    const wrapped = `Error invoking remote method 'session:openTab': Error: ${sandboxUnreachableMessage(info)}`
    expect(parseSandboxUnreachableMessage(wrapped)).toEqual(info)
    expect(parseSandboxUnreachableMessage(sandboxUnreachableMessage({ reason: 'stopped' }))).toEqual({
      reason: 'stopped'
    })
  })

  it('ignores messages without the marker or with an unknown reason', () => {
    expect(parseSandboxUnreachableMessage('something else')).toBeNull()
    expect(parseSandboxUnreachableMessage('SANDBOX_UNREACHABLE:bogus')).toBeNull()
  })
})
