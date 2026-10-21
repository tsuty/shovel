# 開発環境ガイド

shovel の開発環境の構築方法と、開発時の注意点をまとめる。

設計の背景（なぜこの構成にしたか）は
[docs/design/decisions.md](./design/decisions.md) を、
全体構成は [docs/design/architecture.md](./design/architecture.md) を参照。

## 対応 OS

**本ドキュメントが構築手順をサポートするのは macOS と Linux のみ。**

Windows でも開発自体は可能だが、環境構築手順はサポートしない。
Windows で開発する場合は、以下の手順を参考に各自で読み替えること。

> 注意: これは**開発環境**の対応 OS であり、shovel が動作対象とする OS
> （要求仕様の「サポート OS」＝ Windows / macOS）とは別の話。
> Windows 向けのパス変換など、アプリ自体の Windows 対応は
> [docs/design/architecture.md](./design/architecture.md) §4 を参照。
> なお Electron 44 以降は macOS 13 以上・64bit（x64 / arm64）のみが対象で、
> Windows 32bit（ia32）と macOS 12 以前では動かない。

## 前提ツール

| ツール | 用途 | インストール |
| :--- | :--- | :--- |
| [Docker Sandboxes CLI（`sbx`）](https://docs.docker.com/ai/sandboxes/) | サンドボックスの作成・実行。shovel の中核依存 | 各自でインストールする（[公式手順](https://docs.docker.com/ai/sandboxes/)） |
| git | ソース管理 | OS 標準の手順でインストール |

**Docker Sandboxes CLI（`sbx`）は shovel を実際に動かす・動作確認するうえで実質的に必須。**
要求仕様どおり、本リポジトリではインストール手順そのものは提供せず公式ドキュメントへのリンクに留める。
`sbx` が使えるかどうかは、後述の `sbx diagnose` で確認できる。

## ツールのバージョン管理（mise）

Node.js / pnpm のバージョン管理には [mise](https://mise.jdx.dev/) を使う。
**推奨だが必須ではない。** 使わない場合の代替手段は次節を参照。

### macOS

```bash
brew install mise
```

### Linux

```bash
curl https://mise.run | sh
```

パッケージマネージャ経由のインストール手順（apt / dnf 等）は
[mise 公式ドキュメント](https://mise.jdx.dev/installing-mise.html) を参照。

### シェルへの組み込み

インストール後、シェルの起動ファイルに activate 行を追加する。

```bash
# bash の場合（~/.bashrc）
echo 'eval "$(mise activate bash)"' >> ~/.bashrc

# zsh の場合（~/.zshrc）
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
```

新しいシェルを開くか、設定ファイルを読み直してから以下で確認する。

```bash
mise doctor
```

### プロジェクトのツールをインストール

リポジトリ直下の [`mise.toml`](../mise.toml) に Node.js / pnpm のバージョンを
定義している。プロジェクトディレクトリで以下を実行するとインストールされる。

```bash
mise trust     # 初回のみ。mise.toml の内容を信頼する
mise install   # mise.toml に従って node / pnpm をインストール
```

以降、このディレクトリ内では `node` / `pnpm` コマンドが自動的に
mise が管理するバージョンに切り替わる。

### mise を使わない場合

要求仕様どおり、mise を使わない開発者のために代替手段を用意している。

* Node.js のバージョンは [`.node-version`](../.node-version) に記載
  （[Volta](https://volta.sh/) や [nvm](https://github.com/nvm-sh/nvm) など、
  この形式を読むツールであれば利用できる）
* [`package.json`](../package.json) の `engines` フィールドにも同じ条件を明記

Node.js を手動でインストールした場合、pnpm は Node.js に同梱される
[Corepack](https://nodejs.org/api/corepack.html) 経由で導入できる。

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

## セットアップ手順

```bash
git clone <このリポジトリの URL>
cd shovel

mise trust
mise install       # mise を使う場合。使わない場合は Node.js / pnpm を手動で用意する

pnpm install       # 依存関係のインストール
```

Docker Sandboxes 経由でアプリを実行・検証する場合は、事前に前提条件を確認する。

```bash
sbx diagnose
```

失敗する場合は出力内容に従って対処する（`sbx login` が必要、など）。

## 開発フロー

* 実装は [docs/design/](./design/) の設計に従う。**特に着手前に
  [open-issues.md](./design/open-issues.md) の未決事項を確認すること。**
* 「なぜこの実装になっているか」で迷ったら
  [decisions.md](./design/decisions.md) を確認する。同じ検討を繰り返さないため、
  採用しなかった案も理由付きで記録してある。
* ビルド・Lint・テストのコマンド:

  ```bash
  pnpm dev         # electron-vite の開発サーバーを起動（HMR 付き）
  pnpm build       # main / preload / renderer を out/ にビルド
  pnpm typecheck   # main+preload・renderer・テストを別々の tsconfig で型検査
  pnpm lint        # ESLint（型情報を使うルールを含む）
  pnpm test        # Vitest で単体テストを実行（pnpm test:watch で監視実行）
  pnpm run pack    # ビルド後、実行中の OS 向けの署名なしアプリを release/ に出力（動作確認用）
  pnpm pack:mac    # macOS 用 .app（release/mac-<arch>/。dmg と署名は macOS 必須のため行わない）
  pnpm pack:win    # Windows x64 用（release/win-unpacked/。インストーラは作らない）
  pnpm pack:linux  # Linux 用（release/linux-<arch>-unpacked/。開発用サンドボックスでの起動確認向け）
                   # mac / linux は実行中のマシンの CPU アーキテクチャで作る
                   # どれも macOS・Linux のどちらからでも作成できる
                   # ※ `pack` だけは `run` を省くと pnpm 組み込みの pack（tarball 作成）が動く
  pnpm dist        # electron-builder でインストーラを生成（証明書は未設定。decisions.md F-3）
  ```

  `pnpm dev` / `pnpm start` は先に `install-electron` を実行する。Electron 42 以降は
  `pnpm install` 時に Electron 本体をダウンロードしなくなったが、electron-vite 5 は
  ダウンロード済みの本体（`node_modules/electron/path.txt`）を前提にしているため。
  本体があれば `install-electron` は何もしない。

  **依存の置き場所**: `dependencies` には、main / preload が実行時に `node_modules` から
  読み込むパッケージだけを置く（現在は `@agentclientprotocol/sdk`・その peer の `zod`・
  `ignore`）。electron-builder は `dependencies` を依存先ごと配布物に入れる一方、renderer の
  ライブラリ（React・Mermaid・shiki など）は Vite が `out/renderer` にバンドル済みで、
  `node_modules` 側は実行時に一度も読まれないため。renderer 用のライブラリや、main でも
  バンドルに含めたいもの（ESM 専用の `electron-store`）は `devDependencies` に置く
  （electron-vite は `dependencies` 以外をバンドルに含める）。これで `app.asar` は
  約 256 MB → 約 31 MB になった。

  **サードパーティのライセンス表示**: `pnpm build` のたびに
  `out/THIRD_PARTY_NOTICES.txt` が生成される（`scripts/thirdPartyNotices.ts`。
  `rollup-plugin-license` を main / preload / renderer の各ビルドに入れている）。対象は
  バンドルに実際に含まれたパッケージと、`dependencies` を推移的に辿った実行時依存で、
  ビルドツールは含まない。electron-builder の `extraFiles` で、このファイルと自前の
  `LICENSE`（`LICENSE.txt` として）を配布物のルートに置く。Electron / Chromium の表示
  （`LICENSE.electron.txt`・`LICENSES.chromium.html`）は electron-builder が自動で入れる。
  パッケージ自体にライセンスファイルが同梱されていないもの（`react-arborist` など）は
  本文の代わりに注記が入る。生成物なのでリポジトリにはコミットしない。

  TypeScript は 6.0 に留めている。7.0（Go 製のネイティブ版）は従来の JavaScript API を
  持たず、型情報を使う lint（typescript-eslint、対応は `<6.1`）が動かないため。tsconfig は
  7.0 で削除された設定（`baseUrl`、`moduleResolution: "Node"`）を使わない形にしてあるので、
  typescript-eslint が 7.0 に対応したら `typescript` を差し替えるだけで移行できる。
  同様に、vite は electron-vite 5（安定版）が対応する 7 系に留めている（vite 8 対応の
  electron-vite 6 はベータ版のため）。

  単体テストは `test/` 配下に置き、Electron や `sbx` に依存しない純粋なロジック
  （ACP イベントの翻訳、スナップショットの蓄積と比較、差分計算、文字コード・改行の扱い、
  パス変換など）を対象にする。`electron` を読み込むモジュールは `vi.mock('electron')` で
  差し替えて検証する。e2e テストは未整備で、ACP 接続や sbx 呼び出しを伴う経路は実機で確認する。

## 開発時の注意点

* **ネイティブモジュールを追加しない。** `node-pty` や `better-sqlite3` の
  ようなネイティブモジュールは、macOS のコード署名対象が増えたり、
  Electron のバージョン × OS × CPU アーキテクチャごとのビルドが必要になったりと、
  配布を複雑にする。理由は
  [decisions.md の F-2b](./design/decisions.md#f-2b-ネイティブモジュールをゼロにする) を参照。
* **シークレットはサンドボックス内で管理する。** エージェントの認証情報などは
  `sbx secret` 経由でサンドボックス内に置き、ホスト側（このリポジトリや `.env`
  など）には置かない。
* **ホストに git や特定のエージェントを前提にしない。** shovel 自体が
  「前提条件を最小化する」ことを設計原則としている
  （[decisions.md の A-3-1](./design/decisions.md#a-3-1-対象ユーザー) 参照）。
  開発時もこの前提を崩さないコードにする。

## トラブルシューティング

| 症状 | 対処 |
| :--- | :--- |
| `mise: command not found` | シェルの起動ファイルへの activate 行の追加と、シェルの再起動を確認する |
| `mise install` がツールを見つけられない | `mise trust` を先に実行したか確認する |
| `sbx diagnose` が失敗する | 出力されたメッセージに従う（`sbx login` 未実施、など） |
