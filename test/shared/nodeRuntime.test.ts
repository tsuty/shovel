import {
  NODE_INSTALL_SCRIPT,
  classifyNodeInstallFailure,
  nodeRuntimeMessage,
  parseNodeRuntimeMessage
} from '@shared/nodeRuntime'
import { describe, expect, it } from 'vitest'

describe('classifyNodeInstallFailure', () => {
  it('detects a sandbox without apt-get', () => {
    expect(classifyNodeInstallFailure('foo', 3, '__shovel_no_apt__\n')).toEqual({ reason: 'noApt', sandboxName: 'foo' })
  })

  it('detects a sandbox without passwordless sudo', () => {
    expect(classifyNodeInstallFailure('foo', 4, '__shovel_no_sudo__\n')).toEqual({
      reason: 'noSudo',
      sandboxName: 'foo'
    })
  })

  it('keeps the tail of stderr for other failures', () => {
    const stderr = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const failure = classifyNodeInstallFailure('foo', 100, stderr)
    expect(failure.reason).toBe('failed')
    expect(failure.detail?.split('\n')).toHaveLength(15)
    expect(failure.detail?.split('\n').at(-1)).toBe('line 19')
  })

  it('explains a missing npx after installation and a timeout', () => {
    expect(classifyNodeInstallFailure('foo', 5, '__shovel_no_npx_after_install__\n').detail).toBe(
      'npx was not found after installing nodejs and npm.'
    )
    expect(classifyNodeInstallFailure('foo', null, '').detail).toBe('The installation timed out.')
  })

  it('omits the detail when stderr is empty', () => {
    expect(classifyNodeInstallFailure('foo', 1, '\n')).toEqual({ reason: 'failed', sandboxName: 'foo' })
  })
})

describe('nodeRuntimeMessage / parseNodeRuntimeMessage', () => {
  it('round-trips through an IPC-wrapped error message', () => {
    const failure = { reason: 'failed' as const, sandboxName: 'claude-my.app', detail: 'E: oops\nE: again' }
    const wrapped = `Error invoking remote method 'sessions:open': Error: ${nodeRuntimeMessage(failure)}`
    expect(parseNodeRuntimeMessage(wrapped)).toEqual(failure)
  })

  it('round-trips without a detail', () => {
    expect(parseNodeRuntimeMessage(nodeRuntimeMessage({ reason: 'noSudo', sandboxName: 'foo' }))).toEqual({
      reason: 'noSudo',
      sandboxName: 'foo'
    })
  })

  it('ignores messages without the marker or with an unknown reason', () => {
    expect(parseNodeRuntimeMessage('something else')).toBeNull()
    expect(parseNodeRuntimeMessage('NODE_RUNTIME_UNAVAILABLE:other:foo')).toBeNull()
  })
})

describe('NODE_INSTALL_SCRIPT', () => {
  it('is a single sh script without CRLF', () => {
    expect(NODE_INSTALL_SCRIPT).not.toContain('\r')
  })
})
