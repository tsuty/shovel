/**
 * トランスクリプトの IPC 契約（main ⇔ renderer）。
 * SAC (docs/reference/) のプロトコルを継承する。docs/design/data-model.md §6、
 * docs/design/decisions.md N-1 を参照。ACP の生イベントを UI が扱える語彙に翻訳した中間表現。
 *
 * SAC からの意図的な差分が1点ある: SAC はホスト(JVM)側で Markdown→HTML 変換まで
 * 行ってから `html` を送っていたが、decisions.md N-1 の決定により shovel は
 * その変換を `react-markdown` に置き換えてレンダラ側で行う。そのためここでは
 * `html` ではなく `markdown`（生テキスト）を運ぶ。
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
}

export interface PermissionOption {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export type PermissionResolution = 'selected' | 'cancelled'

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
  | { type: 'blockMarkdown'; id: string; markdown: string; choices?: { id: string; label: string }[] }
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
  | { type: 'turnEnd'; id: string; targetId: string }
  | { type: 'toast'; text: string }
  /**
   * ui.md §8「Mode / Model は session/new が返す modes / configOptions から
   * 構成する」の実装: `current_mode_update` / `config_option_update` を
   * 受け取るたびに、その時点の状態を丸ごと送り renderer 側のセレクタを
   * 差し替える（このプロトコルのバージョンでは両方とも常に完全な状態を
   * 運ぶ。data-model.md §6 の部分マージの注記は当時の想定であり、実装した
   * SDK スキーマでは該当しない）。`usage_update` / `available_commands_update`
   * も同じ経路に相乗りさせ、受信するたびに直近の状態で `usage` / `commands`
   * を丸ごと置き換える。
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
