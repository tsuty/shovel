export type { SbxLsEntry } from '@shared/types/sbx'

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
