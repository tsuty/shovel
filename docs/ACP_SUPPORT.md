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
| 使っている SDK | `@agentclientprotocol/sdk` 2.4.0（既定の入口 = stable の ACP v1。`/unstable`・`/experimental/v2` は使わない） |
| shovel のバージョン | 1.3.0 |
| unstable の機能（`schema.unstable.json`） | 方針（§7。stable になってから検討する） |
| ACP v2（`schema-v2.0.0-alpha.*`） | 方針（decisions.md A-1b。v1 のみ） |

表の凡例:

* **対応** — 実装済み。
* **一部** — 書かれた制限つきで実装済み。制限を外すつもりがあるもの。
* **方針** — あえて実装しない。理由は decisions.md に書く（サンドボックスによる隔離が崩れる、別の手段で賄っている、使う場面が無い）。
* **未対応** — まだ実装していない。実装するつもりがあるもの。

「一部」「未対応」は、これから実装するつもりのものだけに使う。やらないと決めたものは「方針」にする。

---

## 2. `initialize` で宣言するクライアント capability

| capability | 宣言 | 備考 |
|---|---|---|
| `fs.readTextFile` / `fs.writeTextFile` | `false`（方針） | ファイルの読み書きはエージェントがサンドボックスの中で行う。shovel はファイル操作を仲介しない（architecture.md §6 の安全モデルの前提）。 |
| `terminal` | `false`（方針） | コマンドはサンドボックスの中で実行される。 |
| `elicitation.form` | `{}` | 質問カード（§3.2）。 |
| `elicitation.url` | 省略（方針） | URL はサンドボックスの外、ホストのブラウザで開かれ、`localhost` へのコールバックもサンドボックスではなくホストに届いてしまう。 |
| `auth.terminal` | 省略（方針） | 認証はサンドボックスの中で済ませておく（§3.1 `authenticate`）。 |
| `session.configOptions.boolean` | `{}` | 入力欄の下のチェックボックス（§5）。 |
| `session.notices` | `{}` | トランスクリプトの1行（§4）。 |
| `session.compaction` | `{}` | トランスクリプトの1エントリ（§4）。 |

宣言していない capability は、エージェントからは「非対応」と見なされ、その機能は使われない。

`clientInfo` は `{ name: "shovel", version: <アプリのバージョン> }`。

---

## 3. メソッド

### 3.1. クライアント → エージェント

| メソッド | 状態 | 備考 |
|---|---|---|
| `initialize` | 対応 | 締切ではなくアイドルタイムアウト（stdout が 180 秒無音で失敗）。初回の `npx` のダウンロードに時間がかかるため。応答の `protocolVersion` が `1` でなければ接続を失敗させる。応答の `agentInfo.version` をプロジェクトに記録し、次回の起動で同じ版を使う（decisions.md N-2-5b）。 |
| `authenticate` | 方針 | 呼ばない。`authMethods` も読まない。サインインはサンドボックスの中で行い、接続前にログイン状態を確かめる。接続（`initialize` 〜 `session/new`）が `-32000`（auth required）で失敗したら、サインインの案内を出す。 |
| `logout` | 方針 | 認証はサンドボックスの中で管理しており、shovel から再ログインもできないため。 |
| `session/new` | 対応 | `cwd` はプロジェクトの `sandboxPath`。`mcpServers` は常に `[]`（方針）: shovel が渡す MCP サーバーはサンドボックスの中で動くか、ホストに届いてしまう。`additionalDirectories` は送らない（方針）: サンドボックスのマウントは `sbx` 側で決まり、shovel はプロジェクトのフォルダ以外を知らない。タブの ↻ でも、接続を使い回して `session/new` を送り直す。 |
| `session/load` | 対応 | `agentCapabilities.loadSession` が宣言されていれば、履歴の再開に `session/resume` より優先して使う。ローカル記録があればそれを先に描き、replay は描かずに `messageId` の並びで比べる。食い違っていたらローカル記録をバックアップへ退避して replay の内容に置き換える（decisions.md C-1/C-2）。`mcpServers` は `[]`。 |
| `session/resume` | 対応 | `sessionCapabilities.resume` が宣言され、`loadSession` が無いときに使う。どちらも無ければ履歴は読み取り専用。 |
| `session/list` | 対応 | `sessionCapabilities.list` が宣言されていれば。`cwd` で絞り、`nextCursor` を最後まで辿る。履歴一覧はこの結果とローカル記録の和集合（decisions.md C-1/C-2 補遺）。プロジェクトに開いている接続が1つも無ければ呼べない。 |
| `session/delete` | 対応 | `sessionCapabilities.delete` が宣言されていれば、履歴の削除で送る。ローカル記録はどちらにしてもソフト削除する（decisions.md C-5）。 |
| `session/close` | 対応 | `sessionCapabilities.close` が宣言されていれば。↻ では前のセッションを閉じてから `session/new` を送り、タブを閉じたとき（ウィンドウを閉じたときも）は閉じてからプロセス（`sbx exec`）を終える。応答は最大 3 秒まで待ち、失敗しても先へ進む（decisions.md A-1d）。 |
| `session/prompt` | 対応 | 送る内容は §5。タイムアウトは設けない（仕様でもプロンプトは長く続いてよく、止めるのは `session/cancel`）。 |
| `session/cancel` | 対応 | 停止ボタン。応答待ちの承認カードと質問カードは取り消し（`cancelled` / `cancel`）で返す。 |
| `session/set_mode` | 対応 | Mode セレクタ。`category: "mode"` の config option があるときは、そちらを出して `modes` は出さない。 |
| `session/set_config_option` | 対応 | `select` と `boolean`（`type: "boolean"` と JSON の真偽値で送る）。応答の `configOptions` で表示を更新する（`config_option_update` を送らないエージェントもあるため）。 |
| `session/set_model` | 方針 | v1 の stable のスキーマに無い。モデルの切り替えは `category: "model"` の config option で行う（decisions.md A-1g）。 |
| `$/cancel_request` | 対応 | `session/prompt` 以外のリクエストは 120 秒で打ち切り、そのリクエストの取り下げを送る（`session/prompt` には `session/cancel` がある）。 |

### 3.2. エージェント → クライアント

| メソッド | 状態 | 備考 |
|---|---|---|
| `session/update` | 対応 | バリアントは §4。 |
| `session/request_permission` | 対応 | トランスクリプトに承認カードを出す。ターンの停止・終了、↻、タブを閉じたとき、接続が切れたときは `cancelled` で返す。 |
| `elicitation/create` | 対応 | フォームモード（質問カード、decisions.md A-1c）。URL モードは方針（§2 `elicitation.url`）。`string`（`format`・長さ・`pattern` つき、`enum` / `oneOf` / `anyOf` なら選択）、`number` / `integer`、`boolean`、選択肢つきの `array`（複数選択）を描ける。描けない項目を1つでも含む要求と URL モードの要求は `-32602` で断る。回答は main でもスキーマに照らして確かめてから返す。claude-agent-acp が `_meta` に入れる選択肢のプレビューも表示する。 |
| `elicitation/complete` | 方針 | URL モードのためのもので、URL モードは宣言していない。 |
| `$/cancel_request` | 対応 | 応答待ちの承認カード・質問カードを取り下げ、取り消しとして返す。 |
| `fs/*`、`terminal/*` | 方針 | `-32601`（method not found）で返す。その他の未知のリクエストも同じ。 |

---

## 4. `session/update` のバリアント

| バリアント | 状態 | 備考 |
|---|---|---|
| `user_message_chunk` | 対応 | replay の中だけ描く（送信したプロンプトはその場で描いているため）。`resource_link` と `[@name](file://…)` 形式のメンションは添付チップに戻す。 |
| `agent_message_chunk` | 対応 | ストリーミング中はプレーンテキスト、確定したら Markdown で描き直す。ターンの後に届いた返信は、更新が1秒途切れたら描き直す。ブロックの区切りは変えない（decisions.md A-1h）。`messageId` はブロックの区切りと、replay とローカル記録の比較に使う。確定した返信の `- [ ]` 行は選択肢として送れるチェックボックスになる。 |
| `agent_thought_chunk` | 対応 | 入力欄の上の思考ストリップに流し、確定したら折りたたみ表示になる。 |
| `tool_call` / `tool_call_update` | 対応 | `title`、`name`、`kind`、`status`、`content`、`locations`、`rawInput` を使う。`title` が空ならツール名（`name`）を、どちらも無ければ `toolCallId` を出す。`rawOutput` は表示しない（方針、decisions.md A-1g）。更新は届いたフィールドだけを前回の値に重ねる。`AskUserQuestion` 形の `rawInput` は質問と選択肢に整形して表示する。 |
| `plan` | 対応 | チェックリストの PLAN ブロックとして描き、同じターンの PLAN ブロックはその場で置き換える。次のターンの計画は新しいブロックになり、前のターンの計画は経過として残る（replay ではユーザーの発言をターンの区切りとみなす）。`priority` は表示しない。 |
| `available_commands_update` | 対応 | スラッシュコマンドの補完候補。 |
| `current_mode_update` | 対応 | |
| `config_option_update` | 対応 | |
| `session_info_update` | 対応 | `title` をタブと履歴のタイトルに使う（ユーザーが名前を変えていればそちらを優先）。`updatedAt` は使わない（方針、decisions.md A-1g）。 |
| `usage_update` | 対応 | 入力欄の下にトークン使用量（`used` / `size`）と費用を表示する。 |
| `notice` | 対応 | `title` と `description` をプレーンテキストの1行で出し、`severity` で色を変える（`error` は赤、`warning` は琥珀）。ライブのみで、スナップショットには残さない。 |
| `compaction_update` / `compaction_summary_chunk` | 対応 | `compactionId` ごとに1エントリ。最初に届いた位置に置き、以後はその場で差し替える。状態を1行で出し、要約は畳む。`summary` / `error` は省略なら据え置き、`null` なら消去。ターンが終わっても `in_progress` のものは `cancelled` にする。スナップショットに残す。 |

知らないバリアントはログに残して無視する。デコードの失敗にはしない。

---

## 5. コンテンツ

| 項目 | 状態 | 備考 |
|---|---|---|
| プロンプト: `text` | 対応 | 空の入力は送れない。 |
| プロンプト: `resource_link` | 対応 | Filer の「コンテキストに追加」で付けたファイル（ブラウザタブのスクリーンショットも）。`file://` の URI はサンドボックス内の絶対パスで、エージェントがサンドボックスの中で読む（decisions.md G-1-5a）。フォルダは添付できない。 |
| プロンプト: `resource`（埋め込み） | 方針 | ファイルの中身は送らず、`resource_link` で渡す。エージェントがサンドボックスの中で読む（decisions.md G-1-5a）。 |
| プロンプト: `image` | 方針 | 画像もファイルとして `resource_link` で渡す。エージェントはサンドボックスの中で画像も読める（decisions.md A-1e）。 |
| プロンプト: `audio` | 方針 | 音声を送る機能を持たない（decisions.md A-1g）。 |
| 表示: `text` | 対応 | Markdown（GFM・絵文字ショートコード・shiki のハイライト・Mermaid）。生の HTML は文字として表示する。 |
| 表示: `resource_link` | 方針 | `[name](uri)` のリンクとして表示する。ファイルを開く操作には結び付けない（decisions.md A-1g）。 |
| 表示: `resource` | 方針 | `[resource]` のプレースホルダ（decisions.md A-1g）。 |
| 表示: `image` | 対応 | エージェントの返信とツールコールの結果の画像。PNG・JPEG・GIF・WebP（`mimeType` ではなくバイト列で判定）で 5 MiB まで。クリックで拡大表示。それ以外の画像と、スナップショットから復元した画像（画像そのものは保存しない）は `[image <mime>]` のプレースホルダ。思考・ユーザーの発言・圧縮の要約の中の画像もプレースホルダ。 |
| 表示: `audio` | 方針 | `[audio <mime>]` のプレースホルダ（decisions.md A-1g）。 |
| ツールコールの content: `content` | 対応 | ツールコール行の展開領域に表示する（画像は上の「表示: `image`」）。 |
| ツールコールの content: `diff` | 対応 | 追加・削除の行数を出し、クリックで差分ビュー（左右並び／統合）を開く。 |
| ツールコールの content: `terminal` | 方針 | `terminal` capability を宣言していないので届かない。 |
| config option の型 `select` | 対応 | グループ化された選択肢は平らに並べる。`category` の `mode` は Mode セレクタの代わりに使う。 |
| config option の型 `boolean` | 対応 | 入力欄の下のチェックボックス。 |
| 停止理由（stop reason） | 対応 | `end_turn` 以外ならターンの末尾に1行で出す（`cancelled` は「中止しました」、`max_tokens` / `max_turn_requests` / `refusal` は琥珀色、未知の理由はその値）。スナップショットにも残す（decisions.md A-1f）。 |

---

## 6. リリースごとの stable 化

各リリースで unstable から stable になった機能と、shovel の対応。文言の修正だけのリリースは省く。

| リリース | stable になった機能 | shovel |
|---|---|---|
| v0.10.8 | Session config options | 対応（`select`） |
| v0.11.1 | `session/list`、`session_info_update` | 対応 |
| v0.12.2 | `session/resume` | 対応 |
| v0.12.2 | `session/close` | 対応 |
| v0.13.3 | `logout` | 方針 |
| v0.13.5 | セッションの `additionalDirectories` | 方針 |
| v0.13.6 | 任意のメッセージ ID（`messageId`） | 対応 |
| v0.13.6 | `usage_update` | 対応 |
| v0.13.6 | `session/delete` | 対応 |
| v1.1.0 | config option の `model` カテゴリ | 対応（`select` として表示） |
| v1.2.0 | リクエストの取り消し（`$/cancel_request`） | 対応 |
| v1.3.0 | boolean の session config options | 対応 |
| v1.7.0 | Elicitation | 対応（フォームモード。URL モードは方針） |
| v1.7.0 | ターミナル認証 | 方針 |
| v1.8.0 | ツールコールの `name` | 対応 |
| v1.11.0 | Session notices | 対応 |
| v1.11.0 | Session compaction | 対応 |

---

## 7. unstable の機能

`schema.unstable.json` の機能は何も実装していない。v1.15.1 の時点では、`session/fork`、
`session/archive` / `session/unarchive`、`session/status`、`session/set_title`、`plan_update` / `plan_removed`、
サブエージェント（`subagent_update`、`session_message` など）、`providers/*`、`auth/status` / `auth/status_update`、
`mcp/message`、プロキシの `proxy/initialize` / `proxy/successor` などがある。
SDK は既定の入口（stable の v1）から import しているため、これらの型を持たない。stable の `SessionUpdate` に無いバリアントの
`session/update` は SDK のスキーマ検証で弾かれ（`console.error` に出る）、`translate.ts` には届かない。
unstable の機能は stable になってから検討する。

---

## 8. 仕様との既知の差異

知られているものは無い。

---

## 9. この文書の更新

ACP の扱いを変えたとき、SDK を上げたとき、新しい ACP のリリースが出たときに更新する。
shovel をリリースするときは、§1 の値が古くなっていないか（新しい ACP のリリース・SDK のバージョンの違い・
前回のリリースから ACP の扱いを変えたのに未記載）を確かめ、§1 の「shovel のバージョン」をリリースするバージョンにする。

更新の手順:

1. リリースノートを読む: `gh api repos/agentclientprotocol/agent-client-protocol/releases`。
   読むのは `v<x.y.z>` のリリース。`schema-v*` のリリースはそのスキーマ部分の繰り返し。
2. 新しく stable になった機能を §6 に足し、§2〜§5 の該当する表にも足す。
3. メソッドはリリースタグの `schema/v1/meta.json` と、`session/update` のバリアントは
   `schema/v1/schema.json` の `SessionUpdate` と照らし合わせる。
4. §1 の照合した仕様・SDK・shovel のバージョンを更新する。
