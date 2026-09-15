/**
 * セッション関連の型。docs/design/data-model.md §3 を参照。
 * 履歴の真実はエージェント側にあり、ここでの型は「UI が扱う軽量な写像」と
 * 「表示高速化・劣化防止のためのローカルスナップショット」の2つに分かれる。
 *
 * 実際の ACP スキーマ（@agentclientprotocol/sdk 1.4.0）では「Mode」と
 * 「Model」は非対称: Mode は `session/new` の応答が返す専用の
 * `SessionModeState`（`modes` フィールド）を持つが、Model には専用フィールドが
 * 無く、`configOptions` のうち `category: "model"` のもの（`SessionConfigSelect`
 * = ドロップダウン）として表現される。ui.md §8 の「Mode / Model は modes /
 * models から構成する」は設計時点の見立てであり、実装はプロトコルの実際の
 * 形に合わせて Model も configOptions 経由に統一する。
 */

export interface SessionMode {
  id: string
  name: string
  description?: string
}

export interface ConfigOptionValue {
  value: string
  label: string
  description?: string
}

export interface ConfigOption {
  configId: string
  /** "mode" | "model" | "model_config" | "thought_level" | 独自文字列。UI 分類のヒントに過ぎない。 */
  category: string
  label: string
  description?: string
  kind: 'select' | 'boolean'
  /** kind: 'select' のとき現在選択されている値、kind: 'boolean' のとき 'true'/'false'。 */
  currentValue: string
  options?: ConfigOptionValue[]
}

/** タブが保持するセッションの実行時メタデータ（真実はエージェント側）。 */
export interface SessionMeta {
  sessionId: string
  projectId: string
  /** ACP に session/rename が無いため、ローカルで名前の上書きを持つ (C-1)。 */
  titleOverride?: string
  modes: SessionMode[]
  currentModeId?: string
  configOptions: ConfigOption[]
}

/** 個別 JSON ファイルとして永続化するスナップショット。data-model.md §3。 */
export interface SessionSnapshot {
  schemaVersion: 1
  sessionId: string
  projectId: string
  title: string
  savedAt: number
  /** エージェントが報告する最終更新時刻。無ければスナップショットを正とみなす。 */
  agentUpdatedAt?: number
  /** 描画済みの TranscriptEvent の再生に足りる最小限の情報を保つ簡易履歴。 */
  entries: SnapshotEntry[]
}

export interface SnapshotEntry {
  id: string
  role: 'USER' | 'AGENT' | 'THOUGHT' | 'PLAN' | 'SYSTEM' | 'COMPLETION' | 'ERROR'
  markdown: string
}

export interface SessionCapabilities {
  list: boolean
  load: boolean
  resume: boolean
  delete: boolean
}
