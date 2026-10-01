# shovel（シャベル）

Docker Sandboxes の中で動く AI エージェントを、ACP（Agent Client Protocol）で
ホスト PC から操作するチャットアプリケーション。

* 非エンジニアを含む対象者向けのローカルチャットアプリ
* プロジェクトに関係なく AI と壁打ちできる
* コードの編集権限がない人でも、AI との対話でコードや仕様を理解できる

設計は [docs/design/](./docs/design/) を参照。

## 採用技術

* Electron + React + TypeScript
* [ACP 公式 TypeScript SDK](https://github.com/agentclientprotocol)（`@agentclientprotocol/sdk`, v1）
* Tailwind CSS + shadcn/ui
* pnpm

詳細は [docs/design/architecture.md](./docs/design/architecture.md) の
「技術スタック」を参照。

## 開発環境

ツールのバージョン管理には [mise](https://mise.jdx.dev/) を使用する
（推奨。必須ではない）。

開発環境の構築手順、開発時の注意点は
**[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)** を参照。

対応 OS（アプリの動作対象）は Windows / macOS。
ただし本リポジトリで**開発環境の構築手順をサポートするのは macOS と Linux のみ**。
Windows でも開発自体は可能だが、環境構築手順は各自で用意する必要がある。
