# アーキテクチャ

「なぜそう決めたか」は [decisions.md](./decisions.md) を参照。
未確定事項は [open-issues.md](./open-issues.md) を参照。

---

## 1. 全体像

shovel は、**Docker Sandboxes（`sbx`）の中で動く AI エージェントを、ACP
（Agent Client Protocol）でホスト PC から操作するチャットアプリケーション**である。

```
┌─────────────────────────── ホスト OS（macOS / Windows）──────────────────────────┐
│                                                                                  │
│  ┌──────────────────────── Electron main プロセス（1つ）─────────────────────┐  │
│  │                                                                            │  │
│  │   ACP クライアント      sbx CLI 実行      ファイルシステム      永続化      │  │
│  │   (@agentclientprotocol/sdk)                                               │  │
│  │                                                                            │  │
│  └───────┬──────────────────────────────────────────────────┬─────────────────┘  │
│          │ IPC                                              │ 子プロセス          │
│  ┌───────┴─────────┐  ┌─────────────────┐                   │                    │
│  │ Window A        │  │ Window B        │                   │                    │
│  │ = プロジェクト X │  │ = プロジェクト Y │                   │                    │
│  │  ┌───┬───┐      │  │  ┌───┐          │                   │                    │
│  │  │Tab│Tab│      │  │  │Tab│          │                   │                    │
│  │  └───┴───┘      │  │  └───┘          │                   │                    │
│  │  = セッション    │  │                 │                   │                    │
│  └─────────────────┘  └─────────────────┘                   │                    │
└──────────────────────────────────────────────────────────────┼────────────────────┘
                                                               │ stdio (JSON-RPC 2.0)
                                     sbx exec -i <sandbox> npx -y <acp-adapter>
                                                               │
┌──────────────────────── Docker Sandbox（プロジェクトごと）────┼────────────────────┐
│                                                               ▼                    │
│   ACP アダプタ ── AI エージェント本体（Claude Code 等）                            │
│                                                                                    │
│   ワークスペース（ホストの $PROJECT_ROOT を読み書き可能でバインドマウント）        │
│   ツール実行（bash / npm / git / …）                                               │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### 対応関係

| shovel の概念 | 実体 |
| :--- | :--- |
| **ウィンドウ** | 1 プロジェクト（ほかにプロジェクトマネージャと、Markdown の印刷用表示（ファイルごと、decisions.md N-3-10）） |
| **タブ** | 1 セッション = 1 ACP 接続 = 1 `sbx exec` 子プロセス（最大 10） |
| **プロジェクト** | 1 サンドボックス ＋ 1 ホストディレクトリ |

---

## 2. プロセス構成

### main プロセス（1つ）

OS のリソースとプロセスを扱うものはすべてここに置く。

| 責務 | 内容 |
| :--- | :--- |
| **ACP クライアント** | `@agentclientprotocol/sdk` を使い、`sbx exec` の子プロセスと JSON-RPC を交換する |
| **`sbx` CLI の実行** | `create` / `ls` / `rm` / `stop` / `exec` / `secret` / `diagnose` |
| **ファイルシステム** | ファイルツリー、読み書き、`shell.trashItem`、`shell.openPath` |
| **永続化** | 設定、プロジェクト一覧、セッションスナップショット |
| **ログ** | ACP トラフィックログ、エージェントの `stderr` |
| **ウィンドウ管理** | `BrowserWindow` の生成・単一インスタンス制御 |

### preload

`contextBridge` で型付き API を renderer に公開する。renderer に Node の API を
直接渡さない。

### renderer（ウィンドウごと）

| 責務 | 使うもの |
| :--- | :--- |
| UI 全般 | React + Tailwind CSS + shadcn/ui |
| トランスクリプト描画 | React |
| Markdown | `react-markdown` + `remark-gfm` |
| シンタックスハイライト | `shiki` |
| ファイルツリー | `react-arborist` |

### セキュリティ設定

- `contextIsolation: true`
- `nodeIntegration: false`
- CSP を設定する
- `will-navigate` と `setWindowOpenHandler` を塞ぐ。リンクは外部ブラウザへ渡す
- Markdown 中の生 HTML を通さない（`rehype-raw` を使わない）

### ネイティブモジュールをゼロにする

`node-pty`（ターミナル）も `better-sqlite3`（DB）も使わない。

macOS のコード署名ではネイティブモジュールが個別に署名対象になり、Windows でも
Electron バージョン × OS × CPU アーキテクチャごとのビルドが必要になる。
ネイティブゼロなら署名は「アプリ本体1つ」で済み、配布が単純になる。

---

## 3. ACP 接続

### 起動

```
sbx exec -i "<sandbox-name>" npx -y <acp-package>@<version>
```

- **版を必ず明示する。** バージョン無しだと `npx` はサンドボックス内のキャッシュにある版を
  使い続け、新しい版を取りに行かない。版の決め方は decisions.md N-2-5b

- **引数ベクタを直接組み立て、シェルを介さない。** クォートやパス区切りの
  OS 差を吸収でき、サンドボックス名に何が含まれていても単一引数として渡る
  - Windows の `sbx` は実行可能ファイル
    （`%LOCALAPPDATA%\DockerSandboxes\bin\sbx.exe`）なので、
    `spawn` を `shell: false` のまま使える。`.cmd` / `.bat` なら
    `shell: true` が必要になり、この前提が崩れていた
  - ただし Windows には OS レベルの argv 配列が無く、コマンドラインは
    単一の文字列である。**Node の `spawn` によるエスケープに依存する**
    （`shell: true` を使わない限り、この経路は標準的で安全）
- `sbx exec` は**停止中のサンドボックスを自動的に起動する**ため、
  「起動」操作は UI に存在しない
- **`stdout` のみを ACP パーサへ渡す。`stderr` は分離**してログと進捗表示に使う
  （`npx` は進捗を `stderr` に出すため、混ぜると JSON-RPC のパースが壊れる）
- **行分割は `\r\n` と `\n` の両方を許容する。** ACP は改行区切りの JSON-RPC
  であり、Windows のパイプで `\r` が混ざるとパースが壊れる。
  実際に混ざるかを確かめるより、**最初から両方を受けておく方が安く確実**。
  公式 SDK の挙動に依存せず、必要なら自前の行分割を挟む
- `-y` は必須（`npx` が対話プロンプトで停止するのを防ぐ）

### 接続前の生存確認

エージェントコマンドの代わりに軽量なコマンド（`echo` 等）を実行し、
終了コードだけで到達性を判定する。失敗したらエラーを表示し、接続を試みない。

### プロトコル

- **ACP v1（`protocolVersion: 1`）のみをサポート**する
- SDK の利用を UI 層に露出させず、**薄い抽象化層を挟む**（将来の v2 移行を
  その層の差し替えで完結させるため）

### クライアント capability

```
fs.readTextFile  : false
fs.writeTextFile : false
terminal         : false
```

**すべて `false`。完全なサンドボックス内包。**

この結果、**エージェントは shovel を経由せず自分でファイルを読み書きする**。
shovel はファイル操作を仲介していないため、そこに強制点が存在しない。
これが安全モデル（§6）の前提になる。

### タイムアウト

| 対象 | 方式 |
| :--- | :--- |
| `initialize` | **アイドルタイムアウト**（既定 180 秒）。締切ではなく、`stdout` / `stderr` の最終出力からの無音時間で測る。`npx` のダウンロードが進んでいる限り打ち切らない |
| その他のリクエスト | 120 秒の締切 |
| `session/prompt` | **タイムアウトなし**（ターンは長時間に及ぶ）。プロセス終了時に保留中のリクエストが一斉に失敗する |

### スキーマの揺れへの耐性

エージェント実装ごとの差異を吸収する。

- capability フラグは `true` と `{}` の**どちらも真**として扱う
- タイムスタンプは **epoch ミリ秒 / epoch 秒 / ISO-8601** を受け付け、ミリ秒に正規化する
- **未知の content block や `session/update` のバリアントは、ログに残して無視する。**
  デコード全体を失敗させない
- エージェントからの未対応リクエストには JSON-RPC エラー `-32601` を返す
  （エージェントを待たせ続けない）

---

## 4. パスの変換

3種類のパスが混在する。

| 使う場面 | どちら側のパスか |
| :--- | :--- |
| ACP の `session/new` に渡す `cwd` | サンドボックス内 |
| `tool_call` の `locations` / `diffs` | サンドボックス内 |
| ファイラー、エディタ、`shell.openPath`、`shell.trashItem` | ホスト |
| `sbx ls --json` の `workspaces` | ホスト |

`Project` は `hostPath` と `sandboxPath` の両方を持ち、**サンドボックス作成直後に
`sbx exec <name> pwd` で実測**して保存する。変換は「ワークスペースルートを
起点にした相対パス」で行うため、マウント規則が何であれ成立する。

**変換処理は1箇所に閉じ込める。**

### 実測されたマウント規則

| | ホスト（`sbx ls --json` の `workspaces`） | サンドボックス内（`pwd`） |
| :--- | :--- | :--- |
| macOS | `/Users/tsuty/workspace/github.com/tsuty/shovel` | **同一**（恒等写像） |
| Windows | `C:\Users\tutty\workspace\shovel` | `/c/Users/tutty/workspace/shovel` |

Windows は **MSYS / Git Bash 形式**（WSL の `/mnt/c/...` ではない）。
ドライブレターが小文字になり（`C:` → `/c`）、`\` が `/` になる。

**規則が判明しても実測は続ける。** 規則は `sbx` の実装詳細であって契約ではない。
実測した値を保存し、規則は「値が妥当かの検算」にのみ使う。

### Windows 固有の考慮

- **パスの大文字小文字**: ホストは case-insensitive、サンドボックス内は
  case-sensitive。`workspaces` と `Project.hostPath` の照合は
  **Windows でのみ case-insensitive に正規化**する
- **セパレータ**: 相対パス計算で `\` ↔ `/` の変換が要る

---

## 5. IPC

### トランスクリプト

次の2つのプロトコルを **main ⇔ renderer の IPC 契約**とする。
これは ACP の生イベントを UI が扱える語彙に翻訳した中間表現である。

**main → renderer（`TranscriptEvent`）**

`reset` / `theme` / `agent` / `block` / `stream` / `blockHtml` / `attachments` /
`group` / `toolCall` / `permission` / `permissionResolved` / `turnEnd` / `toast`

**renderer → main（`TranscriptAction`）**

`ready` / `openFile` / `openDiff` / `openUrl` / `openAttachment` / `copyBlock` /
`copyText` / `submitChoices` / `permission`

**型としては全て「renderer → main」だが、実際に main まで届くのは `permission` だけ。**
Transcript は main-window レンダラ内の通常の React コンポーネント（`App.tsx` の子孫）
であり、残りは renderer 内で完結する:

| アクション | shovel での実際の実装 |
| :--- | :--- |
| `ready` | 不要（React の `useReducer` 初期化と `useEffect` 購読の順序だけで足りる。） |
| `openFile` / `openAttachment` | `App.tsx` が既に持つファイルタブ管理へ、コールバック props で直接渡す（`SessionView` → `Transcript`） |
| `copyBlock` / `copyText` | `navigator.clipboard.writeText()` を renderer 内で直接呼ぶ。N-1 の決定で renderer は既に生の Markdown を持っている |
| `submitChoices` | 既存の `session.prompt` IPC をそのまま呼ぶ（新しい経路は不要） |
| `openUrl` | `createSecureWindow.ts` の `will-navigate` / `setWindowOpenHandler` が、Transcript に限らず全リンクを外部ブラウザへ既に転送している |
| `permission` | 唯一 main の状態（`resolvePermission` の pending Promise）を操作する必要があるため、実際に IPC で届く |

`TranscriptAction` 型と `dispatchTranscriptAction`（`sessionManager.ts`）の網羅的な
`switch` は全アクションを列挙しているが、`permission` 以外の分岐は到達しない。

### ルーティング

1つの main プロセスが、複数ウィンドウ × 最大10タブの ACP 接続を保持する。
main は **`sessionId → webContents` のマップ**を持ち、イベントを `sessionId` で
ルーティングする。

### その他の IPC

| 種別 | 方式 |
| :--- | :--- |
| 要求と応答（ファイル読み込み、プロジェクト一覧、`sbx` コマンド） | `ipcRenderer.invoke` / `ipcMain.handle` |
| ストリーム（トランスクリプト、コマンド実行の出力） | `webContents.send` |

---

## 6. 安全モデル：3層

エージェントは shovel を経由せず自分でファイルを書く（§3）。したがって
「触らせない」ことを shovel が強制する手段は存在しない。守りは層で構成する。

| 層 | 手段 | 自動 / 明示 | 守る範囲 |
| :--- | :--- | :--- | :--- |
| **① 隔離** | サンドボックス | 自動 | **プロジェクト外は完全に守られる** |
| **② 予防** | 承認カード（`session/request_permission`） | 自動 | エージェントが**聞いてきたもの**は止められる |
| **③ 方針** | ACP の Mode | 利用者が選ぶ | どこまで聞くかの方針 |

**「読み取り専用」という設定は存在しない。** 保証できないものを保証と名乗る
ことが最も危険であるため、概念ごと持たない。「閲覧だけしたい」という要求は
③（エージェントの Mode）に委ねる。

**旧・④ 回復（git ベースの「変更」サイドバーによる復元）は廃止した**
（decisions.md A-3-8）。shovel は用途を「既存ソースコードから仕様調査」に
限定せず、構想・調査結果をまとめていく「壁打ち」のような、復元機能がむしろ
邪魔になる使い方も想定する。git 管理下のプロジェクトであれば復元は使い手が
普段使っている git で行える。ツールコール単体の diff 表示（トランスクリプトの
Diff ビューア）はこの廃止と無関係にそのまま残る（decisions.md N-3-8）。

shovel は Permission の方針を発明しない。`session/new` が返す `modes` から
セレクタを構成し、`session/set_mode` を送る。`session/request_permission` が
来たら常に承認カードを表示する。

---

## 7. `sbx` CLI への依存

shovel は Docker Sandboxes 専用であり、以下のコマンドに依存する。

| コマンド | 用途 |
| :--- | :--- |
| `sbx create <AGENT> <PATH>` | サンドボックス作成。`--name` で命名 |
| `sbx ls --json` | 一覧と状態の取得（`name` / `id` / `agent` / `status` / `workspaces` / `workspace_missing`） |
| `sbx exec -i <name> <cmd>` | ACP 接続、git 実行、コマンド実行。**停止中なら自動起動する** |
| `sbx stop <name>` | 停止 |
| `sbx rm --force <name>` | 削除（非対話のため `--force` 必須。確認 UI は shovel 側で出す） |
| `sbx secret set <service>` | 認証情報の設定（値は stdin で渡す） |
| `sbx secret ls` / `import` | 既存の確認、ホスト環境変数からの取り込み |
| `sbx diagnose` | 前提条件チェック |

### 存在しないもの

- **`sbx logs` は存在しない。** さらに `sbx ls --json` は Docker のコンテナ名も
  ID も返さないため、`docker logs` に辿る道もない。
  → ログ表示は「診断情報画面」として再定義する
- **`sbx start` は存在しない。** `sbx exec` が暗黙に起動する

### 制約

- サンドボックス名に使えるのは
  **英字・数字・ハイフン・ピリオド・プラス記号・マイナス記号のみ**
- **primary ワークスペースを read-only にはできない**
  （`primary workspace must be read/write`）

---

## 8. 技術スタック

| 領域 | 採用 |
| :--- | :--- |
| アプリ基盤 | Electron |
| UI | React + Tailwind CSS + shadcn/ui |
| ACP | `@agentclientprotocol/sdk`（公式 TypeScript SDK、v1） |
| Markdown | `react-markdown` + `remark-gfm` |
| ハイライト | `shiki` |
| ファイルツリー | `react-arborist` |
| `.gitignore` 判定 | `ignore`（npm。git コマンドを呼ばない） |
| 永続化 | `electron-store`（JSON） |
| i18n | `i18next` + `react-i18next`（英語・日本語） |
| パッケージ管理 | pnpm |
| ツール管理 | [mise](https://mise.jdx.dev/)（**推奨。必須ではない**） |
| ビルド・配布 | `electron-builder` |
| 自動更新 | `electron-updater`（**署名後に有効化**） |

> **mise を必須にしない理由**は「ツールを強制しない」（A-3-1）であって、
> Windows で動かないからではない。mise は Windows を正式にサポートしている
> （Scoop / WinGet、シムは `%LOCALAPPDATA%\mise\shims`）。
> 使わない人のために `.node-version` と `package.json` の `engines` も併記し、
> Volta でも nvm でも手動インストールでも開発できるようにする。

### 採用しなかったもの

| | 理由 |
| :--- | :--- |
| **Vercel AI SDK** | ACP の表現力（思考ログ、plan、tool_call の kind/locations/diffs、権限要求、modes、configOptions、session/list、session/load）を LanguageModel / HarnessAgent の抽象に通すと失われる。ハーネス層は**エージェントを隠蔽する**ための抽象であり、shovel は**エージェントの挙動を見せる**アプリなので方向が逆 |
| **`@ai-sdk/harness-acp`** | サンドボックス内にブリッジを置き WebSocket で通信する方式で、**ポート公開が必須**。Docker Sandboxes でのポート公開はホストでの CLI 実行を要し、非エンジニア向けの前提と両立しない |
| **Monaco / CodeMirror** | 編集できるのは Markdown と設定ファイル（JSON / YAML）だけで、他は閲覧のみ（コードを書くのは AI であって人間ではない）。重量級エディタは目的に対して過剰 |
| **`node-pty` / xterm.js** | ネイティブモジュールを増やし、配布と署名を複雑にする。TTY を諦めても `sbx exec -i` で対話プロンプトには答えられる |
| **`better-sqlite3`** | ネイティブモジュール。保存する量に対して `electron-store` で足りる |
| **memfs + unionfs** | Node プロセス内の `fs` を差し替える仕組みであり、別プロセス・コンテナ内のエージェントには届かない |
