import { compareVersions, findRegistryEntry, isValidVersion, withAcpRollback, withAcpUpdate } from '@shared/acpVersion'
import type { Project } from '@shared/types/project'

describe('compareVersions', () => {
  it('orders by major/minor/patch numerically', () => {
    expect(compareVersions('0.85.1', '0.85.1')).toBe(0)
    expect(compareVersions('0.85.1', '0.85.2')).toBeLessThan(0)
    expect(compareVersions('0.100.0', '0.85.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.999.999')).toBeGreaterThan(0)
  })

  it('treats prereleases as lower than the release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareVersions('1.0.0+build.1', '1.0.0')).toBe(0)
  })
})

describe('isValidVersion', () => {
  it('accepts semver and rejects the rest', () => {
    expect(isValidVersion('0.85.1')).toBe(true)
    expect(isValidVersion('1.0.0-rc.1')).toBe(true)
    expect(isValidVersion('latest')).toBe(false)
    expect(isValidVersion('1.0')).toBe(false)
    expect(isValidVersion(undefined)).toBe(false)
  })
})

describe('findRegistryEntry', () => {
  const registry = {
    version: '1.0.0',
    agents: [
      { id: 'amp-acp', version: '0.9.0', distribution: { binary: {} } },
      { id: 'other', name: '', distribution: { npx: { package: 'agoragentic-mcp@1.3.0' } } },
      {
        id: 'claude-acp',
        name: 'Claude Agent',
        version: '0.85.1',
        distribution: { npx: { package: '@agentclientprotocol/claude-agent-acp@0.85.1' } }
      }
    ]
  }

  it('reads the name and version of a scoped npx package', () => {
    expect(findRegistryEntry(registry, '@agentclientprotocol/claude-agent-acp')).toEqual({
      name: 'Claude Agent',
      version: '0.85.1'
    })
  })

  it('falls back to the package name when the agent has no name', () => {
    expect(findRegistryEntry(registry, 'agoragentic-mcp')).toEqual({ name: 'agoragentic-mcp', version: '1.3.0' })
  })

  it('returns null when missing or malformed', () => {
    expect(findRegistryEntry(registry, 'nope')).toBeNull()
    expect(findRegistryEntry(null, 'x')).toBeNull()
    expect(findRegistryEntry({ agents: 'x' }, 'x')).toBeNull()
    expect(
      findRegistryEntry({ agents: [{ distribution: { npx: { package: '@scope/pkg' } } }] }, '@scope/pkg')
    ).toBeNull()
  })
})

describe('withAcpUpdate / withAcpRollback', () => {
  const project: Project = {
    id: 'p',
    displayName: 'p',
    hostPath: '/h',
    sandboxPath: '/h',
    sandboxName: 's',
    sandboxId: 'sid',
    agentId: 'claude',
    createdAt: 0,
    acpVersion: '0.85.1'
  }

  it('keeps the version before the update', () => {
    expect(withAcpUpdate(project, '0.86.0')).toMatchObject({ acpVersion: '0.86.0', previousAcpVersion: '0.85.1' })
  })

  it('rolls back to the previous version and skips the rolled-back one', () => {
    const rolledBack = withAcpRollback(withAcpUpdate(project, '0.86.0'))
    expect(rolledBack).toMatchObject({ acpVersion: '0.85.1', skippedAcpVersion: '0.86.0' })
    expect(rolledBack).not.toHaveProperty('previousAcpVersion')
  })

  it('keeps a newer skipped version', () => {
    const updated = { ...withAcpUpdate(project, '0.86.0'), skippedAcpVersion: '0.87.0' }
    expect(withAcpRollback(updated)?.skippedAcpVersion).toBe('0.87.0')
  })

  it('returns null when there is nothing to roll back to', () => {
    expect(withAcpRollback(project)).toBeNull()
  })
})
