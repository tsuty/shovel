export {}

const projects = [
  { id: 'p1', sandboxId: 'sb-1', sandboxName: 'one' },
  { id: 'p2', sandboxId: 'sb-2', sandboxName: 'two' }
]

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, dialog: {}, shell: {} }))
vi.mock('electron-store', () => ({
  default: class {
    get(): unknown {
      return projects
    }
    set(): void {}
  }
}))

const sbxLs = vi.fn<() => Promise<unknown>>()
const sbxDiagnoseChecks = vi.fn<() => Promise<unknown>>()
vi.mock('@main/sbx/cli', () => ({
  sbxLs: () => sbxLs(),
  sbxDiagnoseChecks: () => sbxDiagnoseChecks(),
  sbxCreate: vi.fn(),
  sbxDiagnose: vi.fn(),
  sbxMeasureSandboxPath: vi.fn(),
  sbxRm: vi.fn(),
  sbxStop: vi.fn()
}))

const { listProjectsWithStatus, sbxProblemFromChecks } = await import('@main/domain/projectService')

const signedOut = [
  { name: 'Daemon', status: 'pass' },
  { name: 'Authentication', status: 'fail', message: 'not signed in' }
]
const signedIn = [{ name: 'Authentication', status: 'pass' }]

beforeEach(() => {
  sbxLs.mockReset()
  sbxDiagnoseChecks.mockReset()
})

describe('sbxProblemFromChecks', () => {
  it('Authentication が fail なら notSignedIn', () => {
    expect(sbxProblemFromChecks(signedOut)).toBe('notSignedIn')
  })

  it('それ以外（読めなかった場合も含む）は unavailable', () => {
    expect(sbxProblemFromChecks(signedIn)).toBe('unavailable')
    expect(sbxProblemFromChecks(null)).toBe('unavailable')
  })
})

describe('listProjectsWithStatus', () => {
  it('すべて見つかれば sbx diagnose を走らせない', async () => {
    sbxLs.mockResolvedValue([
      { id: 'sb-1', status: 'running' },
      { id: 'sb-2', status: 'stopped' }
    ])
    const result = await listProjectsWithStatus()
    expect(result.sbxProblem).toBeNull()
    expect(result.projects.map((p) => p.status)).toEqual(['running', 'stopped'])
    expect(sbxDiagnoseChecks).not.toHaveBeenCalled()
  })

  it('sbx ls が失敗し未サインインなら、missing ではなく unknown にする', async () => {
    sbxLs.mockRejectedValue(new Error('sbx ls --json failed with code 1'))
    sbxDiagnoseChecks.mockResolvedValue(signedOut)
    const result = await listProjectsWithStatus()
    expect(result.sbxProblem).toBe('notSignedIn')
    expect(result.projects.map((p) => p.status)).toEqual(['unknown', 'unknown'])
  })

  it('sbx ls が空を返しても、未サインインなら unknown にする', async () => {
    sbxLs.mockResolvedValue([])
    sbxDiagnoseChecks.mockResolvedValue(signedOut)
    const result = await listProjectsWithStatus()
    expect(result.sbxProblem).toBe('notSignedIn')
    expect(result.projects.map((p) => p.status)).toEqual(['unknown', 'unknown'])
  })

  it('サインイン済みで見当たらないものは missing のまま', async () => {
    sbxLs.mockResolvedValue([{ id: 'sb-1', status: 'running' }])
    sbxDiagnoseChecks.mockResolvedValue(signedIn)
    const result = await listProjectsWithStatus()
    expect(result.sbxProblem).toBeNull()
    expect(result.projects.map((p) => p.status)).toEqual(['running', 'missing'])
  })

  it('sbx が無ければ notInstalled', async () => {
    sbxLs.mockRejectedValue(new Error('SBX_NOT_FOUND'))
    const result = await listProjectsWithStatus()
    expect(result.sbxProblem).toBe('notInstalled')
    expect(result.projects.map((p) => p.status)).toEqual(['unknown', 'unknown'])
  })

  it('原因が分からない失敗は unavailable', async () => {
    sbxLs.mockRejectedValue(new Error('boom'))
    sbxDiagnoseChecks.mockResolvedValue(signedIn)
    const result = await listProjectsWithStatus()
    expect(result.sbxProblem).toBe('unavailable')
  })
})
