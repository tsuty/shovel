/** ファイラーの IPC 契約。ui.md §9 / decisions.md N-3-4, N-3-5。 */

export interface FsEntry {
  /** プロジェクトルートからの相対パス（POSIX 区切り）。ノードの一意な id にも使う。 */
  relPath: string
  name: string
  isDir: boolean
  /** `.gitignore` に一致する（node_modules 等）。隠さず薄く表示する。 */
  ignored: boolean
}

export type FileReadResult =
  | { kind: 'text'; content: string }
  | { kind: 'binary' }
  | { kind: 'missing' }

export interface FsMutationRequest {
  projectId: string
  relPath: string
}
