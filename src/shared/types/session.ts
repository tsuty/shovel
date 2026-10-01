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

/**
 * ui.md §8「行頭の `/` でスラッシュコマンド補完（`available_commands_update`
 * の候補）」。`input.hint` はコマンド名の後に続ける引数のプレースホルダ
 * （エージェントが省略すれば引数なしコマンドとして扱う）。
 */
export interface SessionCommand {
  name: string
  description: string
  inputHint?: string
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
  commands: SessionCommand[]
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
  /** ブロックの id。`TOOL_GROUP` のときはツールコールのグループ id。 */
  id: string
  /**
   * `TOOL_GROUP` は連続するツールコールのまとまり（`markdown` は空、中身は
   * `toolCalls`）。比較（C-4）には使わないが、表示に要るものは比較対象で
   * なくても保持する。
   */
  role: 'USER' | 'AGENT' | 'THOUGHT' | 'PLAN' | 'SYSTEM' | 'COMPLETION' | 'ERROR' | 'TOOL_GROUP'
  markdown: string
  /** `TOOL_GROUP` のツールコール（`rawInput` は表示に使わず、diff と中身が重複するので落とす）。 */
  toolCalls?: ToolCallPayload[]
  /** USER ブロックに付けた添付（コンテキスト）チップ。 */
  chips?: AttachmentChip[]
  /** AGENT ブロックから抜き出した GFM タスクリストの選択肢。 */
  choices?: { id: string; label: string }[]
  /**
   * AGENT エントリだけが持つ、ACP `agent_message_chunk` の `messageId`
   * （任意フィールド。エージェントが送ってこなければ undefined）。
   * decisions.md C-4: ローカル記録と `session/load` の replay が食い違って
   * いるかは、テキストではなくこの id の並びだけで判定する。
   */
  messageId?: string
}

/**
 * ローカルスナップショットのファイル種別。decisions.md C-4 / C-5、
 * data-model.md §4:
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
 * decisions.md C-1/C-2 補遺: 履歴一覧の1行が「どちら側に存在するか」。
 *   - `both`: `session/list` にあり、ローカル記録もある
 *   - `localOnly`: `session/list` を取得できたが、そこに無い
 *   - `agentOnly`: `session/list` にあるが、ローカル記録が無い
 *   - `unknown`: `session/list` を取得できていない（接続が無い・非対応・失敗）。
 *     確かめていないので「ローカルのみ」とは表示しない
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
   * エージェントが `delete` に対応している）。「エージェントのみ」の行は
   * これが false のとき削除できない（decisions.md C-5 追記）。
   */
  canDeleteAgentSessions: boolean
}

/** decisions.md C-6: ローカルセッション検索の結果1行。 */
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
 * `agentCapabilities.sessionCapabilities.*`（`{}` = 対応 / 欠落・null = 非対応）
 * から読む。decisions.md C-1/C-2 の復元戦略はこの4つで分岐する。
 */
export interface SessionCapabilities {
  list: boolean
  load: boolean
  resume: boolean
  delete: boolean
}
