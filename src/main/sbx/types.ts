export interface SbxLsEntry {
  name: string
  id: string
  agent: string
  status: 'running' | 'stopped'
  workspaces: string[]
  workspace_missing?: boolean
}

export interface SbxExecResult {
  code: number | null
  stdout: string
  stderr: string
}

export class SbxCommandError extends Error {
  constructor(
    message: string,
    readonly result: SbxExecResult
  ) {
    super(message)
    this.name = 'SbxCommandError'
  }
}
