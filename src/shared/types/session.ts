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

/**
 * ui.md §8「トークン使用量は usage_update を受け取ったときだけ表示する」。
 * `usage_update` を一度も受け取っていないセッションでは undefined のままにする
 * （0 と未受信を区別する）。
 */
export interface SessionUsage {
  used: number
  size: number
  costAmount?: number
  costCurrency?: string
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
  usage?: SessionUsage
}

/** 個別 JSON ファイルとして永続化するスナップショット。data-model.md §3。 */
export interface SessionSnapshot {
  schemaVersion: 1
  /** shovel のタブ id。スナップショットのファイル名にもなる。 */
  sessionId: string
  /**
   * エージェント側のセッション id。`session/load` / `session/resume` はこちらを
   * 要求する（shovel のタブ id とは別物）。これを持たない古いスナップショットは
   * 「再開できない履歴」として扱う（decisions.md C-1/C-2 の「非対応」の行と
   * 同じ扱いに落とす）。
   */
  acpSessionId?: string
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

/**
 * `initialize` の応答が告げるエージェント側の対応状況。
 * `load` は `agentCapabilities.loadSession`、それ以外は
 * `agentCapabilities.sessionCapabilities.*`（`{}` = 対応 / 欠落・null = 非対応）
 * から読む。decisions.md C-1/C-2 の復元戦略はこの4つで分岐する。
 */
export interface SessionCapabilities {
  list: boolean
  load: boolean
  resume: boolean
  delete: boolean
}
