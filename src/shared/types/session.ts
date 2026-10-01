/**
 * セッション関連の型。UI が扱う実行時の状態と、ローカルスナップショットの形を定義する。
 * Model は `configOptions` のうち `category: "model"` のものとして扱う。
 */

import type { AttachmentChip, ToolCallPayload } from './transcript'

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
  /** "mode" | "model" | "model_config" | "thought_level" | 独自文字列。 */
  category: string
  label: string
  description?: string
  kind: 'select' | 'boolean'
  /** kind: 'select' のとき現在選択されている値、kind: 'boolean' のとき 'true'/'false'。 */
  currentValue: string
  options?: ConfigOptionValue[]
}

/** トークン使用量。`usage_update` を一度も受け取っていなければ undefined。 */
export interface SessionUsage {
  used: number
  size: number
  costAmount?: number
  costCurrency?: string
}

/** スラッシュコマンドの候補（`available_commands_update`）。`input.hint` は引数のプレースホルダ。 */
export interface SessionCommand {
  name: string
  description: string
  inputHint?: string
}

/** タブが保持するセッションの実行時メタデータ。 */
export interface SessionMeta {
  sessionId: string
  projectId: string
  /** ローカルで保持する名前の上書き。 */
  titleOverride?: string
  modes: SessionMode[]
  currentModeId?: string
  configOptions: ConfigOption[]
  usage?: SessionUsage
  commands: SessionCommand[]
}

/** 個別 JSON ファイルとして永続化するスナップショット。 */
export interface SessionSnapshot {
  schemaVersion: 1
  /** shovel のタブ id。スナップショットのファイル名にもなる。 */
  sessionId: string
  /**
   * エージェント側のセッション id（`session/load` / `session/resume` に渡す）。
   * これを持たないスナップショットは再開できない。
   */
  acpSessionId?: string
  projectId: string
  title: string
  savedAt: number
  /** エージェントが報告する最終更新時刻。 */
  agentUpdatedAt?: number
  /** トランスクリプトの再描画に使うエントリ。 */
  entries: SnapshotEntry[]
}

export interface SnapshotEntry {
  /** ブロックの id。`TOOL_GROUP` のときはツールコールのグループ id。 */
  id: string
  /** `TOOL_GROUP` は連続するツールコールのまとまり（`markdown` は空、中身は `toolCalls`）。 */
  role: 'USER' | 'AGENT' | 'THOUGHT' | 'PLAN' | 'SYSTEM' | 'COMPLETION' | 'ERROR' | 'TOOL_GROUP'
  markdown: string
  /** `TOOL_GROUP` のツールコール（`rawInput` は保存しない）。 */
  toolCalls?: ToolCallPayload[]
  /** USER ブロックに付けた添付（コンテキスト）チップ。 */
  chips?: AttachmentChip[]
  /** AGENT ブロックから抜き出した GFM タスクリストの選択肢。 */
  choices?: { id: string; label: string }[]
  /**
   * AGENT エントリだけが持つ、ACP `agent_message_chunk` の `messageId`（無ければ undefined）。
   * ローカル記録と `session/load` の replay の比較に使う。
   */
  messageId?: string
}

/**
 * ローカルスナップショットのファイル種別。
 *   - `current`: `{sessionId}.json`（現行の記録）
 *   - `backup`:  `{sessionId}.json.{epochMillis}.backup`（食い違い検出時の退避）
 *   - `deleted`: `{sessionId}.json.{epochMillis}.deleted`（ソフトデリート）
 */
export type LocalRecordKind = 'current' | 'backup' | 'deleted'

/**
 * チャット履歴パネル・ローカル検索が扱う、スナップショットファイル1つ分の
 * 要約（本文 `entries` は含まない）。`fileName` がファイルの識別子で、
 * 中身は `session.readLocalRecord(fileName)` で取り出す。
 */
export interface LocalRecordSummary {
  fileName: string
  kind: LocalRecordKind
  sessionId: string
  title: string
  /**
   * `current` はスナップショットの `savedAt`、`backup` / `deleted` は
   * ファイル名の `{epochMillis}`（退避・削除した時刻）。
   */
  timestamp: number
  sizeBytes: number
}

/**
 * 履歴一覧の1行がどちら側に存在するか。
 *   - `both`: `session/list` にあり、ローカル記録もある
 *   - `localOnly`: `session/list` を取得できたが、そこに無い
 *   - `agentOnly`: `session/list` にあるが、ローカル記録が無い
 *   - `unknown`: `session/list` を取得できていない（接続が無い・非対応・失敗）
 */
export type HistoryEntryState = 'both' | 'localOnly' | 'agentOnly' | 'unknown'

/** 履歴一覧の1行（`session/list` とローカル記録の和集合）。 */
export interface HistoryEntry {
  /** 行の識別子。ローカル記録があればその id、無ければ `acp:{acpSessionId}`。 */
  key: string
  /** ローカル記録（`{snapshotId}.json`）があればその id。 */
  snapshotId?: string
  /** エージェント側のセッション id（分かっていれば）。 */
  acpSessionId?: string
  title: string
  /** ローカルの `savedAt` とエージェントの `updatedAt` の新しい方。 */
  updatedAt: number
  state: HistoryEntryState
}

export interface HistoryListing {
  entries: HistoryEntry[]
  /**
   * いま `session/delete` を送れるか（同じウィンドウにライブタブがあり、
   * エージェントが `delete` に対応している）。
   */
  canDeleteAgentSessions: boolean
}

/** ローカルセッション検索の結果1行。 */
export interface LocalSearchResult {
  record: LocalRecordSummary
  /**
   * マッチ箇所を含む一文（Markdown 記法を落とした平文）。`match` を太字に
   * する。タイトルにだけ一致した場合は undefined。
   */
  snippet?: { before: string; match: string; after: string }
}

/**
 * `initialize` の応答が告げるエージェント側の対応状況。
 * `load` は `agentCapabilities.loadSession`、それ以外は
 * `agentCapabilities.sessionCapabilities.*`（`{}` = 対応 / 欠落・null = 非対応）から読む。
 */
export interface SessionCapabilities {
  list: boolean
  load: boolean
  resume: boolean
  delete: boolean
}
