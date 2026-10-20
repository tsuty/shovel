# データモデル

「なぜそう決めたか」は [decisions.md](./decisions.md) を参照。

---

## 1. Project

ホストのディレクトリ・サンドボックス・shovel のプロジェクトは**別物**であり、
名前の制約が異なる。分離して持つ。

```ts
type Project = {
  id:          string   // UUID。shovel が生成。displayName を変えても不変
  displayName: string   // 自由。日本語・スペース可。UI に出る
  hostPath:    string   // ホストのディレクトリ（/Users/... または C:\...）
  sandboxPath: string   // サンドボックス内のワークスペース。作成直後に実測
  sandboxName: string   // sbx の制約に従って導出＋衝突回避
  sandboxId:   string   // sbx が採番した UUID。照合に使う
  agentId:     string   // エージェント対応表のキー
  acpVersion?:        string  // 使う ACP アダプタの版。セッション開始時に initialize の agentInfo.version を記録
  skippedAcpVersion?: string  // 更新の確認で「今のまま」を選んだ版（decisions.md N-2-5b）
  ignoredNetworkHosts?: string[]  // 拒否された通信のうち「無視」にした宛先 host:port（decisions.md N-2-8）
}
```

### 各フィールドの根拠

| フィールド | 理由 |
| :--- | :--- |
| `id` | `displayName` の変更が `sandboxName` に波及しないようにする。名前を変えてもサンドボックスを作り直さずに済む |
| `displayName` | `sbx --name` が許すのは英数字・ハイフン・ピリオド・プラス・マイナスのみで、日本語やスペースを含む名前は使えない |
| `sandboxPath` | ACP が報告するパスはサンドボックス内のもの。ホストのパスとの変換に必要（Windows では原理的に一致しない） |
| `sandboxId` | 名前より ID の方が照合が堅牢。`sbx ls --json` が UUID を返す |
| `acpVersion` | バージョン無しの `npx -y <pkg>` はキャッシュの古い版を使い続けるため、版を明示して起動する。更新はユーザーが確認して決める（decisions.md N-2-5b） |

### 持たないもの

- **`access`（Read only / Read-write）は持たない。** 安全モデルから概念ごと
  廃止した（architecture.md §6）

---

## 2. エージェント対応表

`sbx` の AGENT と ACP レジストリのエントリを結ぶ。**アプリに同梱する。**

```ts
type AgentEntry = {
  id:         string   // "claude"
  label:      string   // "Claude"
  sbxAgent:   string   // sbx create <AGENT>   → "claude"
  acpPackage: string   // npx -y <package>     → "@agentclientprotocol/claude-agent-acp"
  auth:       AuthMethod
  status:     "verified" | "experimental"
}

type AuthMethod =
  | { type: "sbx-secret";       service: string }    // API キーを stdin で渡す
  | { type: "sbx-secret-oauth"; service: string }    // sbx の OAuth
  | { type: "acp-authenticate"; methodId: string }   // ACP の authenticate
  | { type: "agent-command";    argv: string[] }     // サンドボックス内でコマンド実行
```

`sbx` が用意している AGENT は
`claude` / `codex` / `copilot` / `cursor` / `docker-agent` / `droid` / `gemini` /
`kiro` / `opencode` / `shell`。

### 方針

- **`shell` は使わない。** `sbx create claude` で作られた環境には
  エージェント本体と認証経路がセットアップ済みであり、その上に ACP アダプタを
  `npx` で足すだけで済む
- **`status: "verified"` のものだけを UI に出す。**
  非エンジニアにとって「選んだエージェントが動かない」はアプリの不具合として
  体験される
- **まず `claude` の1組だけで作り、2組目で抽象化を検証する**

### `auth` の中身は未確定

V-2 / V-3 / V-10 / V-11 の検証を待って埋める（[open-issues.md](./open-issues.md)）。
構造だけ先に定めてある。

---

## 3. Session

### 真実の所在（Local Record First。decisions.md C-1/C-2）

セッションの**存在・一覧**はエージェント側に問い合わせる（`session/list`）。
しかし過去のやり取りの**内容**は**ローカルスナップショットを正とする**。
ローカルスナップショットに1件でも記録があれば、`session/load` の replay で
それを上書きしない。

理由: エージェントは長い会話になるとコンテキストを要約・省略することがある。
`session/load` の replay は「エージェントが（要約後も）憶えていて語れる範囲」
でしかなく、実際にやり取りされた完全な記録ではない。ローカルスナップショットは
エージェントのコンテキストウィンドウのサイズや要約方針に依存せず情報を保持
できるため、セッションでやり取りされた情報そのものの記録として優先する。

### スナップショットが必要な理由

1. `session/list` も `session/load` も capability 依存。非対応エージェントでは
   履歴機能が丸ごと消える
2. **ACP に `session/rename` が無い。** セッション名の上書きはクライアント側が
   持つしかない
3. 上記の通り、エージェント側の記憶がコンテキスト省略で欠落しうるため、
   ローカル記録そのものに独立した価値がある

### 復元戦略

`resume` より `load` を優先する（decisions.md C-1/C-2、2026-09-30 改定）。

| ローカルスナップショット | エージェントの capability | 振る舞い |
| :--- | :--- | :--- |
| あり（1件以上） | `load` 対応（`resume` の可否は問わない） | スナップショットを即座に描画する。`session/load` の replay 通知は描画せず、ローカル記録と `messageId` で比較する（decisions.md C-4）。食い違えばバックアップを取ってから表示を replay 側に置き換える |
| あり（1件以上） | `load` 非対応・`resume` のみ対応 | スナップショットを描画し `session/resume` で文脈を再接続（比較はしない） |
| 無し／空 | `load` か `resume` のいずれか対応 | `session/load` のライブ replay を描画し、完了後にそれを最初のスナップショットとして保存 |
| あり（1件以上） | 非対応 | **スナップショットのみ描画。** 文脈の再接続はできない旨を通知 |
| 無し／空 | 非対応 | 選択を拒否し、現在のセッションを維持 |

### スナップショットの実装要件

- 保存先は**プロジェクトツリーの外**（VCS に載せない）
- 書き込みは一時ファイル経由の**アトミックな move**（中断時の破損を防ぐ）
- **`schemaVersion` を持つ。** 移行経路の無いバージョンは「履歴なし」として破棄する
  （読み込み失敗で接続そのものを壊さないため）
- プロンプトを一度も受け取っていないセッションは、別セッションへ切り替える際に
  破棄する（空セッションがエージェント側に溜まるのを防ぐ）

### 「アプリ外のセッション」の範囲

`session/list` はサンドボックス内のエージェントに問い合わせるため、
**同一サンドボックスでターミナルから動かしたセッション**は列挙される。

**範囲外**: 別サンドボックスのセッション、別エージェントのセッション、
ホスト側で直接動かしたセッション。いずれも ACP 経由では原理的に取得できない。

---

## 4. 永続化

すべて `app.getPath('userData')` 配下。**SQLite は使わない。**

| 保存するもの | 保存先 |
| :--- | :--- |
| プロジェクト一覧（`Project[]`） | `electron-store`（JSON） |
| 設定（自動添付、フォントサイズ、言語 …） | `electron-store` |
| ウィンドウ状態、サイドバー幅 | `electron-store` |
| 開いていたタブ（プロジェクト単位・表示順。decisions.md G-1-17） | `electron-store`（`openTabs`） |
| セッション名の上書き | `electron-store` |
| コマンド履歴（**プロジェクト単位**） | `electron-store` |
| セッションのスナップショット | **個別 JSON ファイル**（`{sessionId}.json`） |
| セッションのバックアップ（decisions.md C-4。自動削除しない） | `{sessionId}.json.{epochMillis}.backup` |
| 削除済みセッション（ソフトデリート。decisions.md C-5。自動削除しない） | `{sessionId}.json.{epochMillis}.deleted` |
| ACP トラフィックログ | **セッションごとのファイル**（`{timestamp}_{sessionId}.log`） |

### 状態の真実の所在

**shovel の設定を真実とする。** `sbx` は実行基盤として使う。
起動時に `sbx ls --json` と突き合わせ、**差分を UI に提示する。自動同期はしない。**

| 差分 | 振る舞い |
| :--- | :--- |
| shovel にあって sbx に無い | 「サンドボックスがありません」＋［再作成］。**設定は消さない** |
| sbx にあって shovel に無い | プロジェクト追加画面に「既存のサンドボックスから追加」として提示 |
| `workspace_missing: true` | ホストのディレクトリが消えている旨を提示 |
| `status: "stopped"` | 何もしない（開けば自動起動する） |

`sbx ls --json` はラベルやメタデータを保存できず `displayName` の置き場がないため、
sbx 側を真実にはできない。自動で消さない・自動で足さないのは
「使い方を強制しない」原則の具体化。

---

## 5. トランスクリプトのプロトコル

**main ⇔ renderer の IPC 契約**として使う。
ACP の生イベントを UI が扱える語彙に翻訳した中間表現。

### main → renderer（`TranscriptEvent`）

| イベント | ペイロード | 意味 |
| :--- | :--- | :--- |
| `reset` | `sessionId` | 全エントリを破棄（セッション切替・再接続） |
| `theme` | `tokens`, `dark` | CSS カスタムプロパティを設定。DOM は保つ |
| `agent` | `name`, `iconSymbol` | エージェント名とアイコン |
| `block` | `id`, `role`, `html`, `streaming`, `choices` | ブロックを追加 |
| `stream` | `id`, `text` | ストリーミング中のブロックに生テキストを追記 |
| `blockHtml` | `id`, `html`, `choices` | ブロック本文を確定した Markdown で置換 |
| `attachments` | `id`, `chips` | USER ブロックに添付チップを追加 |
| `group` | `id`, `timed`, `closed`, `elapsedMs` | ツールコールグループの開閉 |
| `toolCall` | （下記） | ツールコールカードの追加・更新（`id` で upsert） |
| `permission` | `id`, `toolCallId`, `headline`, `bodyHtml`, `flat`, `options` | インライン承認カード |
| `permissionResolved` | `id`, `status` | ボタンを無効化し、選択結果を表示 |
| `turnEnd` | `id`, `targetId` | 「ターンの先頭へ戻る」操作を紐付ける |
| `toast` | `text` | 下端に一時メッセージを表示 |

`role` は `USER` / `AGENT` / `THOUGHT` / `PLAN` / `SYSTEM` / `COMPLETION` / `ERROR`。
枠・アイコン・タイトル・地味な見た目はこの `role` が決める。

### renderer → main（`TranscriptAction`）

`ready` / `openFile{path,line}` / `openDiff{toolCallId,diffIndex}` / `openUrl{url}` /
`openAttachment{key}` / `copyBlock{id}` / `copyText{text}` /
`submitChoices{id,markdown}` / `permission{id,optionId}`

renderer は生の Markdown を持っているため、`copyBlock` / `copyText` はどちらも
main を経由せず renderer 内で `navigator.clipboard.writeText()` を直接呼ぶ
（architecture.md §5 参照）。この2つが main まで届くことはない。

### 扱う `session/update` のバリアント

`agent_message_chunk` / `agent_thought_chunk` / `user_message_chunk` /
`tool_call` / `tool_call_update` / `plan` / `current_mode_update` /
`current_model_update` / `config_option_update` / `available_commands_update` /
`usage_update` / `session_info_update`

未知のバリアントはログに残して無視し、デコード全体を失敗させない。

`session_info_update` の `title` は、そのセッションのタイトルとしてタブ名とスナップショットの
`title` に反映する。優先順は「ユーザーによる名前変更 → エージェントのタイトル → 最初の発言」
（履歴一覧も同じ）。ターン終了の応答より後に届くことがあるため、受け取った時点で記録を保存し直す。

### `configOptions` の更新規則

| 送られ方 | 扱い |
| :--- | :--- |
| `session/new` / `load` / `resume` の応答、`config_option_update` 通知 | **全体**の状態。キャッシュを**置き換える** |
| `session/set_config_option` の応答 | **部分的**（`mode` / `model` のみ）。キャッシュに**マージする** |

素朴に「応答で置き換える」と実装すると Effort などのセレクタが消える。

`session/set_config_option` / `session/set_mode` を送ったあとの表示は、通知を待たずに応答で更新する。
claude-agent-acp は、クライアントから変更したときに `config_option_update`
（`set_mode` の場合は `current_mode_update`）を送らないことがある。そうなると、
制御されたセレクタは元の値に戻って見える。

- `set_config_option` の応答の `configOptions` は、上の規則どおりマージする。
- `set_mode` が成功したら `currentModeId` を要求した値にする。ただし応答待ちの間に
  `current_mode_update` が届いていれば、実際に適用された値としてそちらを優先する
  （例: Auto が使えず別モードに落ちたとき）。
