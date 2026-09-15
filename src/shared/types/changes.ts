/** 「変更」サイドバーの IPC 契約。ui.md §11 / decisions.md N-3-7, A-3-7。 */

export type ChangeStatus = 'modified' | 'added' | 'deleted'

export interface ChangedFile {
  relPath: string
  status: ChangeStatus
}

export interface ChangesSummary {
  /** git リポジトリでないプロジェクトでは false。「戻す」操作を出さない。 */
  gitAvailable: boolean
  files: ChangedFile[]
}
