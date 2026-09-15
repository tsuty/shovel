/** `sbx ls --json` の1エントリ。architecture.md §7。main/renderer 双方から使う。 */
export interface SbxLsEntry {
  name: string
  id: string
  agent: string
  status: 'running' | 'stopped'
  workspaces: string[]
  workspace_missing?: boolean
}
