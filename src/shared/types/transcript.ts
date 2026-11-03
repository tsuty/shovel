/**
 * トランスクリプトの IPC 契約（main ⇔ renderer）。ACP の生イベントを UI が扱える語彙に翻訳した中間表現。
 * ブロックの本文は `markdown`（生テキスト）で運び、renderer 側で描画する。
 */

import type { ConfigOption, SessionCommand, SessionMode, SessionUsage } from './session'

export type BlockRole = 'USER' | 'AGENT' | 'THOUGHT' | 'PLAN' | 'SYSTEM' | 'COMPLETION' | 'ERROR'

export interface AttachmentChip {
  key: string
  label: string
  path: string
}

export type ToolCallKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'fetch'
  | 'switch_mode'
  | 'think'
  | 'other'

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface ToolCallDiff {
  path: string
  oldText?: string
  newText?: string
  added: number
  removed: number
}

export interface ToolCallPayload {
  id: string
  groupId: string
  kind: ToolCallKind
  title: string
  status: ToolCallStatus
  locations: { path: string; line?: number }[]
  diffs: ToolCallDiff[]
  rawInput?: unknown
  content?: string
  /**
   * ユーザーに質問するツール（claude-agent-acp の `AskUserQuestion` の形の入力）なら、その質問。
   * 行を開くと、生の入力の代わりにこれを整形して出す。`rawInput` と違いスナップショットにも残す。
   */
  ask?: AskQuestion[]
}

/** ユーザーへの質問1つ（`AskUserQuestion` の入力の `questions` の1要素）。 */
export interface AskQuestion {
  header?: string
  question: string
  multiSelect: boolean
  options: { label: string; description?: string; preview?: string }[]
}

export interface PermissionOption {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export type PermissionResolution = 'selected' | 'cancelled'

/** エージェントからの質問（`elicitation/create` のフォーム）の選択肢。 */
export interface ElicitationOption {
  value: string
  label: string
  description?: string
  /**
   * 選んだときに下へ出す補足（コード片や画面の下書きなど、プレーンテキスト）。claude-agent-acp が
   * `AskUserQuestion` の選択肢の `_meta["_claude/askUserQuestionOption"].preview` で送ってくる。
   */
  preview?: string
}

interface ElicitationFieldBase {
  /** `requestedSchema.properties` のキー。回答の `content` のキーになる。 */
  key: string
  title?: string
  description?: string
  required: boolean
}

/** `requestedSchema` の1項目を、描くコントロールの種類ごとに整理したもの。 */
export type ElicitationField =
  | (ElicitationFieldBase & {
      kind: 'text'
      default?: string
      format?: 'email' | 'uri' | 'date' | 'date-time'
      minLength?: number
      maxLength?: number
      pattern?: string
    })
  | (ElicitationFieldBase & { kind: 'select'; default?: string; options: ElicitationOption[] })
  | (ElicitationFieldBase & {
      kind: 'number'
      integer: boolean
      default?: number
      minimum?: number
      maximum?: number
    })
  | (ElicitationFieldBase & { kind: 'boolean'; default?: boolean })
  | (ElicitationFieldBase & {
      kind: 'multiSelect'
      default?: string[]
      options: ElicitationOption[]
      minItems?: number
      maxItems?: number
    })

export type ElicitationValue = string | number | boolean | string[]

export type ElicitationAction = 'accept' | 'decline' | 'cancel'

/** renderer から main へ返す、質問への応答。 */
export type ElicitationReply =
  | { action: 'accept'; content: Record<string, ElicitationValue> }
  | { action: 'decline' }
  | { action: 'cancel' }

/** main → renderer */
export type TranscriptEvent =
  | { type: 'reset'; sessionId: string }
  | { type: 'theme'; tokens: Record<string, string>; dark: boolean }
  | { type: 'agent'; name: string; iconSymbol: string }
  | {
      type: 'block'
      id: string
      role: BlockRole
      markdown: string
      streaming: boolean
      choices?: { id: string; label: string }[]
    }
  | { type: 'stream'; id: string; text: string }
  | {
      type: 'blockMarkdown'
      id: string
      markdown: string
      choices?: { id: string; label: string }[]
      /** AGENT ブロックのときだけ、ACP の `messageId`（あれば）を運ぶ。スナップショットの保存に使う。 */
      messageId?: string
    }
  | { type: 'attachments'; id: string; chips: AttachmentChip[] }
  | { type: 'group'; id: string; timed: boolean; closed: boolean; elapsedMs?: number }
  | { type: 'toolCall'; toolCall: ToolCallPayload }
  | {
      type: 'permission'
      id: string
      toolCallId: string
      headline: string
      bodyMarkdown: string
      flat: boolean
      options: PermissionOption[]
    }
  | { type: 'permissionResolved'; id: string; status: PermissionResolution; optionId?: string }
  /** エージェントからの質問（`elicitation/create` のフォームモード）。 */
  | {
      type: 'elicitation'
      id: string
      message: string
      title?: string
      description?: string
      fields: ElicitationField[]
    }
  /** 質問への応答が決まった（`accept` のときは送った内容も運ぶ）。 */
  | {
      type: 'elicitationResolved'
      id: string
      action: ElicitationAction
      content?: Record<string, ElicitationValue>
    }
  | { type: 'turnEnd'; id: string; targetId: string }
  | { type: 'toast'; text: string }
  /**
   * トランスクリプトに差し込む控えめな地の文（SYSTEM ブロックと同じ見た目）。
   * 文言は renderer 側の i18n で `transcript.notice.{key}` から引く。
   *   - `replayAdopted`: `session/load` の replay とローカル記録が食い違ったため、
   *     ローカルをバックアップへ退避して表示をエージェント側の記録に置き換えた。
   */
  | { type: 'notice'; id: string; key: 'replayAdopted' }
  /** エージェントが付けたセッションのタイトル（`session_info_update`）。タブ名に反映する。 */
  | { type: 'title'; title: string }
  /**
   * セッションのメタ状態（モード・configOptions・使用量・利用可能コマンド）。
   * 更新を受け取るたびに、その時点の状態を丸ごと送る。
   */
  | {
      type: 'sessionMeta'
      modes: SessionMode[]
      currentModeId?: string
      configOptions: ConfigOption[]
      usage?: SessionUsage
      commands: SessionCommand[]
    }

/** renderer → main */
export type TranscriptAction =
  | { type: 'ready'; sessionId: string }
  | { type: 'openFile'; sessionId: string; path: string; line?: number }
  | { type: 'openDiff'; sessionId: string; toolCallId: string; diffIndex: number }
  | { type: 'openUrl'; url: string }
  | { type: 'openAttachment'; sessionId: string; key: string }
  | { type: 'copyBlock'; sessionId: string; id: string }
  | { type: 'copyText'; text: string }
  | { type: 'submitChoices'; sessionId: string; id: string; markdown: string }
  | { type: 'permission'; sessionId: string; id: string; optionId: string }
  | { type: 'elicitation'; sessionId: string; id: string; reply: ElicitationReply }
