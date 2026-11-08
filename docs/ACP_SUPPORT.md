# ACP 対応状況

[Agent Client Protocol](https://agentclientprotocol.com/)（ACP）は今も更新が続いており、
[リリース](https://github.com/agentclientprotocol/agent-client-protocol/releases)のたびに unstable の機能が増え、
その一部が stable になり、stable の仕様の文言も詰められていく。この文書は shovel がどこまで追従しているかを記録し、
「X に対応しているか」の答えをここに一本化する。

機能が使えるかどうかはエージェント側にもよる。shovel が使えるのは、エージェントが `initialize` の応答で宣言したものだけ。

実装は `src/main/acp/`（接続は `connection.ts`、`session/update` の翻訳は `translate.ts`、質問カードは `elicitation.ts`）。
設計上の理由は [design/decisions.md](./design/decisions.md) を参照。

---

## 1. 前提

| 項目 | 値 |
|---|---|
| プロトコルバージョン | `1`（`initialize` で送る） |
| 照合した仕様 | ACP リリース `v1.15.1`（2026-11-02）の `schema/v1/schema.json` と `meta.json` |
| 使っている SDK | `@agentclientprotocol/sdk` 1.9.0 |
| shovel のバージョン | 1.3.0 |
| unstable の機能（`schema.unstable.json`） | 未対応（§7） |
| ACP v2（`schema-v2.0.0-alpha.*`） | 未対応 |

表の凡例:

* **対応** — 実装済み。
* **一部** — 書かれた制限つきで実装済み。
* **方針** — あえて実装しない。サンドボックスによる隔離が崩れるか、別の手段で賄っている。
* **未対応** — まだ実装していない。

---

## 2. `initialize` で宣言するクライアント capability

| capability | 宣言 | 備考 |
|---|---|---|
| `fs.readTextFile` / `fs.writeTextFile` | `false`（方針） | ファイルの読み書きはエージェントがサンドボックスの中で行う。shovel はファイル操作を仲介しない（architecture.md §6 の安全モデルの前提）。 |
| `terminal` | `false`（方針） | コマンドはサンドボックスの中で実行される。 |
| `elicitation.form` | `{}` | 質問カード（§3.2）。 |
| `elicitation.url` | 省略（方針） | URL はサンドボックスの外、ホストのブラウザで開かれ、`localhost` へのコールバックもサンドボックスではなくホストに届いてしまう。 |
| `auth.terminal` | 省略（方針） | 認証はサンドボックスの中で済ませておく（§3.1 `authenticate`）。 |
| `session.configOptions.boolean` | 省略（未対応） | 受け取ればチェックボックスとして描けるが（§5）、宣言はしていない。 |
| `session.notices` | 省略（未対応） | §4 `notice`。 |
| `session.compaction` | 省略（未対応） | §4 `compaction_update`。 |

宣言していない capability は、エージェントからは「非対応」と見なされ、その機能は使われない。

`clientInfo` は `{ name: "shovel", version: <アプリのバージョン> }`。

---

## 3. メソッド

### 3.1. クライアント → エージェント

| メソッド | 状態 | 備考 |
|---|---|---|
| `initialize` | 対応 | 締切ではなくアイドルタイムアウト（stdout が 180 秒無音で失敗）。初回の `npx` のダウンロードに時間がかかるため。応答の `agentInfo.version` をプロジェクトに記録し、次回の起動で同じ版を使う（decisions.md N-2-5b）。応答の `protocolVersion` は確かめていない（§8）。 |
| `authenticate` | 方針 | 呼ばない。`authMethods` も読まない。サインインはサンドボックスの中で行い、接続前にログイン状態を確かめる。接続（`initialize` 〜 `session/new`）が `-32000`（auth required）で失敗したら、サインインの案内を出す。 |
| `logout` | 方針 | 認証はサンドボックスの中で管理しており、shovel から再ログインもできないため。 |
| `session/new` | 対応 | `cwd` はプロジェクトの `sandboxPath`。`mcpServers` は常に `[]`（方針）: shovel が渡す MCP サーバーはサンドボックスの中で動くか、ホストに届いてしまう。`additionalDirectories` は送らない（方針）: サンドボックスのマウントは `sbx` 側で決まり、shovel はプロジェクトのフォルダ以外を知らない。タブの ↻ でも、接続を使い回して `session/new` を送り直す。 |
| `session/load` | 対応 | `agentCapabilities.loadSession` が宣言されていれば、履歴の再開に `session/resume` より優先して使う。ローカル記録があればそれを先に描き、replay は描かずに `messageId` の並びで比べる。食い違っていたらローカル記録をバックアップへ退避して replay の内容に置き換える（decisions.md C-1/C-2）。`mcpServers` は `[]`。 |
| `session/resume` | 対応 | `sessionCapabilities.resume` が宣言され、`loadSession` が無いときに使う。どちらも無ければ履歴は読み取り専用。 |
| `session/list` | 対応 | `sessionCapabilities.list` が宣言されていれば。`cwd` で絞り、`nextCursor` を最後まで辿る。履歴一覧はこの結果とローカル記録の和集合（decisions.md C-1/C-2 補遺）。プロジェクトに開いている接続が1つも無ければ呼べない。 |
| `session/delete` | 対応 | `sessionCapabilities.delete` が宣言されていれば、履歴の削除で送る。ローカル記録はどちらにしてもソフト削除する（decisions.md C-5）。 |
| `session/close` | 未対応 | 送らない。タブを閉じるとプロセス（`sbx exec`）ごと終了させる。↻ では古いセッションを閉じずに新しいセッションを始める。 |
| `session/prompt` | 一部 | 送る内容は §5。タイムアウトなし。 |
| `session/cancel` | 対応 | 停止ボタン。応答待ちの承認カードと質問カードは取り消し（`cancelled` / `cancel`）で返す。 |
| `session/set_mode` | 対応 | Mode セレクタ。`category: "mode"` の config option があるときは、そちらを出して `modes` は出さない。 |
| `session/set_config_option` | 一部 | `select` は対応。`boolean` は `type: "boolean"` と JSON の真偽値で送れるが、capability を宣言していないので実際には届かない（§2）。応答の `configOptions` で表示を更新する（`config_option_update` を送らないエージェントもあるため）。 |
| `session/set_model` | 未対応 | v1 の stable のスキーマに無い。モデルの切り替えは `category: "model"` の config option で行う。 |
| `$/cancel_request` | 未対応 | 送らない。`session/prompt` 以外のリクエストは 120 秒で打ち切るが、エージェントには知らせない。 |

### 3.2. エージェント → クライアント

| メソッド | 状態 | 備考 |
|---|---|---|
| `session/update` | 対応 | バリアントは §4。 |
| `session/request_permission` | 対応 | トランスクリプトに承認カードを出す。ターンの停止・終了、↻、タブを閉じたとき、接続が切れたときは `cancelled` で返す。 |
| `elicitation/create` | 一部 | フォームモードのみ（質問カード、decisions.md A-1c）。`string`（`format`・長さ・`pattern` つき、`enum` / `oneOf` / `anyOf` なら選択）、`number` / `integer`、`boolean`、選択肢つきの `array`（複数選択）を描ける。描けない項目を1つでも含む要求と URL モードの要求は `-32602` で断る。回答は main でもスキーマに照らして確かめてから返す。claude-agent-acp が `_meta` に入れる選択肢のプレビューも表示する。 |
| `elicitation/complete` | 方針 | URL モードのためのもので、URL モードは宣言していない。 |
| `$/cancel_request` | 対応 | 応答待ちの承認カード・質問カードを取り下げ、取り消しとして返す。 |
| `fs/*`、`terminal/*` | 方針 | `-32601`（method not found）で返す。その他の未知のリクエストも同じ。 |

---

## 4. `session/update` のバリアント

| バリアント | 状態 | 備考 |
|---|---|---|
| `user_message_chunk` | 対応 | replay の中だけ描く（送信したプロンプトはその場で描いているため）。`resource_link` と `[@name](file://…)` 形式のメンションは添付チップに戻す。 |
| `agent_message_chunk` | 対応 | ストリーミング中はプレーンテキスト、確定したら Markdown で描き直す。`messageId` はブロックの区切りと、replay とローカル記録の比較に使う。確定した返信の `- [ ]` 行は選択肢として送れるチェックボックスになる。 |
| `agent_thought_chunk` | 対応 | 入力欄の上の思考ストリップに流し、確定したら折りたたみ表示になる。 |
| `tool_call` / `tool_call_update` | 一部 | `title`、`kind`、`status`、`content`、`locations`、`rawInput` を使う。`rawOutput` と `name` は使わない（`title` が無ければ `toolCallId` を出す）。更新は届いたフィールドだけを前回の値に重ねる。`AskUserQuestion` 形の `rawInput` は質問と選択肢に整形して表示する。 |
| `plan` | 一部 | チェックリストの PLAN ブロックとして描く。仕様では新しい計画が前の計画を置き換えるが、shovel は届くたびに新しいブロックを足す（§8）。`priority` は表示しない。 |
| `available_commands_update` | 対応 | スラッシュコマンドの補完候補。 |
| `current_mode_update` | 対応 | |
| `config_option_update` | 対応 | |
| `session_info_update` | 一部 | `title` をタブと履歴のタイトルに使う（ユーザーが名前を変えていればそちらを優先）。`updatedAt` は使わない。 |
| `usage_update` | 対応 | 入力欄の下にトークン使用量（`used` / `size`）と費用を表示する。 |
| `notice` | 未対応 | capability を宣言していないので届かない。届いても無視する。 |
| `compaction_update` / `compaction_summary_chunk` | 未対応 | 同上。 |

知らないバリアントはログに残して無視する。デコードの失敗にはしない。

---

## 5. コンテンツ

| 項目 | 状態 | 備考 |
|---|---|---|
| プロンプト: `text` | 対応 | 空の入力は送れない。 |
| プロンプト: `resource_link` | 対応 | Filer の「コンテキストに追加」で付けたファイル（ブラウザタブのスクリーンショットも）。`file://` の URI はサンドボックス内の絶対パスで、エージェントがサンドボックスの中で読む（decisions.md G-1-5a）。フォルダは添付できない。 |
| プロンプト: `resource`（埋め込み） | 未対応 | ファイルの中身は送らない。 |
| プロンプト: `image` | 未対応 | 画像もファイルとして `resource_link` で渡す。 |
| プロンプト: `audio` | 未対応 | |
| 表示: `text` | 対応 | Markdown（GFM・絵文字ショートコード・shiki のハイライト・Mermaid）。生の HTML は文字として表示する。 |
| 表示: `resource_link` | 一部 | `[name](uri)` のリンクとして表示する。 |
| 表示: `resource` | 一部 | `[resource]` のプレースホルダ。 |
| 表示: `image` / `audio` | 一部 | `[image]` / `[audio]` のプレースホルダ。 |
| ツールコールの content: `content` | 対応 | ツールコール行の展開領域に表示する。 |
| ツールコールの content: `diff` | 対応 | 追加・削除の行数を出し、クリックで差分ビュー（左右並び／統合）を開く。 |
| ツールコールの content: `terminal` | 方針 | `terminal` capability を宣言していないので届かない。 |
| config option の型 `select` | 対応 | グループ化された選択肢は平らに並べる。`category` の `mode` は Mode セレクタの代わりに使う。 |
| config option の型 `boolean` | 一部 | チェックボックスとして描けるが、capability を宣言していない（§2）。 |
| 停止理由（stop reason） | 一部 | どの理由でもターンを終えて記録を保存する。`max_tokens` / `max_turn_requests` / `refusal` などの理由は表示しない。 |

---

## 6. リリースごとの stable 化

各リリースで unstable から stable になった機能と、shovel の対応。文言の修正だけのリリースは省く。

| リリース | stable になった機能 | shovel |
|---|---|---|
| v0.10.8 | Session config options | 対応（`select`） |
| v0.11.1 | `session/list`、`session_info_update` | 対応（`session_info_update` は `title` のみ） |
| v0.12.2 | `session/resume` | 対応 |
| v0.12.2 | `session/close` | 未対応 |
| v0.13.3 | `logout` | 方針 |
| v0.13.5 | セッションの `additionalDirectories` | 方針 |
| v0.13.6 | 任意のメッセージ ID（`messageId`） | 対応 |
| v0.13.6 | `usage_update` | 対応 |
| v0.13.6 | `session/delete` | 対応 |
| v1.1.0 | config option の `model` カテゴリ | 対応（`select` として表示） |
| v1.2.0 | リクエストの取り消し（`$/cancel_request`） | 一部（受信のみ） |
| v1.3.0 | boolean の session config options | 一部（描画のみ、capability は未宣言） |
| v1.7.0 | Elicitation | 一部（フォームモード。URL モードは方針） |
| v1.7.0 | ターミナル認証 | 方針 |
| v1.8.0 | ツールコールの `name` | 未対応 |
| v1.11.0 | Session notices | 未対応 |
| v1.11.0 | Session compaction | 未対応 |

---

## 7. unstable の機能

`schema.unstable.json` の機能は何も実装していない。v1.15.1 の時点では、`session/fork`、
`session/archive` / `session/unarchive`、`session/status`、`session/set_title`、`plan_update` / `plan_removed`、
サブエージェント（`subagent_update`、`session_message` など）、`providers/*`、`auth/status` / `auth/status_update`、
`mcp/message`、プロキシの `proxy/initialize` / `proxy/successor` などがある。
SDK の型には一部が含まれているため、`translate.ts` はこれらの `session/update` を受け取っても何も描かない。
unstable の機能は stable になってから検討する。

---

## 8. 仕様との既知の差異

* **`initialize` の `protocolVersion` を確かめていない。** 仕様では、クライアントが対応していない版を
  エージェントが返したら接続を閉じるべきとされるが、shovel は応答の版を見ずに先へ進む。
* **`plan` を置き換えずに積み上げる。** 仕様ではエージェントは毎回計画の全体を送り、クライアントは前の計画を
  置き換える。shovel は届くたびに PLAN ブロックを足すので、計画が更新されると古い計画も残って見える。

---

## 9. この文書の更新

ACP の扱いを変えたとき、SDK を上げたとき、新しい ACP のリリースが出たときに:

1. リリースノートを読む: `gh api repos/agentclientprotocol/agent-client-protocol/releases`。
   読むのは `v<x.y.z>` のリリース。`schema-v*` のリリースはそのスキーマ部分の繰り返し。
2. 新しく stable になった機能を §6 に足し、§2〜§5 の該当する表にも足す。
3. メソッドはリリースタグの `schema/v1/meta.json` と、`session/update` のバリアントは
   `schema/v1/schema.json` の `SessionUpdate` と照らし合わせる。
4. §1 の照合した仕様・SDK・shovel のバージョンを更新する。
