/** `sbx ls --json` の1エントリ。 */
export interface SbxLsEntry {
  name: string
  id: string
  agent: string
  status: 'running' | 'stopped'
  workspaces: string[]
  workspace_missing?: boolean
}
