# shovel 未決事項

確定した決定は `docs/design/decisions.md` を参照。

---

## A. 要検証（実機での確認が必要。設計の分岐点）

| ID | 検証したいこと | 何が決まるか |
| :--- | :--- | :--- |
| ~~**V-1**~~ | ~~`sbx create <AGENT> <scratch> <project>:ro` で、追加ワークスペースがコンテナ内のどのパスにマウントされるか。そこへの書き込みが実際に失敗するか~~ | ❌ **検証不要になった（2026-09-17）。** Read only モードは対応しないと最終決定した（decisions.md A-3-4）。理由は A-3-8 で復元機能を廃止したのと同じ——中途半端な保証は無保証より悪い。マウント位置の検証結果がどちらに転んでも結論は変わらないため、検証する意味がなくなった |
| ~~**V-2**~~ | ~~`sbx create claude` の環境で ACP アダプタが動き、プロンプトが通るか~~ | ✅ **解決（2026-09-14）。** アダプタの起動を確認し、`sbx exec -i` の stdio に ACP v1 で `initialize` → `session/new` → `session/prompt` が届く。**N-2-5 のエージェント対応表の前提が実物で検証された** |
| ~~**V-3**~~ | ~~`sbx create claude` の環境内で Claude Code が OAuth ログインを通せるか~~ | ✅ **解決（2026-09-14）。** サンドボックス内で `authMethod: "claude.ai"` / `subscriptionType: "pro"` を確認（`configDirectory` が `/home/agent/.claude` であることから、ホストではなくコンテナ内の状態）。**Claude Pro / Max のサブスクリプションで動く。** API キー必須という参入障壁が消えた |
| ~~**V-4**~~ | ~~`@agentclientprotocol/sdk` v1.4.0 が `session/list` / `session/resume` / `session/delete` / `configOptions` を型として提供しているか~~ | ✅ **解決（2026-09-16）。提供している。** `AGENT_METHODS` に `session_load` / `session_resume` / `session_list` / `session_delete` があり、`LoadSessionRequest` 等の型も揃っている。対応可否は `agentCapabilities.loadSession`（boolean）と `agentCapabilities.sessionCapabilities.{list,delete,resume,close,fork}`（`{}` = 対応 / 欠落・null = 非対応）で分かる。**ただし高水準ヘルパーは `session/new` 専用**: `ctx.buildSession().start()` が返す `ActiveSession` に更新を流し込む `attachSession` が private なので、load/resume は生の `ctx.request(...)` ＋ `session/update` 通知の自前ルーティングで実装する（`connection.ts` の `ManualSession`）。SDK 内部の通知ルータは `Handled.no` を返すので、`onNotification(session_update, ...)` を重ねても `session/new` 側の経路は壊れない（実機の in-memory エージェントで確認済み） |
| ~~**V-5**~~ | ~~Electron の `webContents.findInPage()` をトランスクリプト検索に使ったとき、サイドバーや入力欄へのヒットが実用上許容できるか~~ | ✅ **解決（2026-09-29）。許容する方針で進める。** サイドバー・入力欄への誤ヒットは許容範囲と判断し、`webContents.findInPage()` をそのまま使う。**→ 2026-10-06 改訂:** 実装すると検索欄自身へのヒットとフォーカス奪取が問題になったため、CSS Custom Highlight API による自前検索に切り替えた（decisions.md N-1-a） |
| ~~**V-6**~~ | ~~Windows での `sbx` の動作、およびパス表現の扱い~~ | ✅ **解決（2026-09-14）。** Windows で `sbx` は動作し、`create` / `ls --json` を確認。パス規則は MSYS 形式（`C:\Users\...` → `/c/Users/...`）。詳細は decisions.md N-6a |
| ~~**V-7**~~ | ~~`mise` の Windows サポート状況~~ | ✅ **解決（2026-09-14）。mise は Windows を正式にサポートしている**（Scoop / WinGet で導入、シムディレクトリは `%LOCALAPPDATA%\mise\shims`）。「Windows サポートが弱い」という当初の記述は**誤りだった**。ただし既知の粗さはある（Scoop のマニフェストが tool-shims を PATH に追加しない、WinGet 経由で `mise-shim.exe` のリンクが作られない場合がある）。**「推奨・必須ではない」という方針は維持**するが、その理由は Windows ではなく「ツールを強制しない」原則（A-3-1） |
| ~~**V-8**~~ | ~~N-3-6 (A)(B)「ターン終了時に展開中フォルダだけ `readdir`」で、実際の利用体験が成立するか~~ | ❌ **検証不要になった（2026-09-29）。** 変更検知（ファイル監視）自体をやらないと決定したため、`chokidar` を入れるかどうかを判断する検証の前提が消えた |
| ~~**V-9**~~ | ~~バインドマウント越しにサンドボックス内で git を動かしたとき、uid の差で `safe.directory` 警告が出るか~~ | ❌ **検証不要になった。** A-3-7（「変更」サイドバーの回復 UI）を decisions.md A-3-8 で廃止したため、shovel 自身は git を一切実行しなくなった。エージェントが自分の判断でサンドボックス内 git を使うことは妨げないが、その場合の挙動はエージェント自身の責任範囲であり shovel が検証する対象ではない |
| ~~**V-10**~~ | ~~`@agentclientprotocol/claude-agent-acp` が `initialize` のレスポンスで `authMethods` を返すか~~ | ❌ **検証不要になった（2026-09-29）。** Claude 側の ACP 実装を確認した結果、`authMethods` ベースの認証 UI はエージェントごとに個別実装が要ること、実装のバリエーションが多いこと、サンドボックスの制約（ポート開放が要る等）など課題が多く、Claude 以外のエージェントへの対応まで見込むとコストに見合わないと判断した。**shovel はエージェントの認証プロセスそのものには関与しない**（N-2-7b の「状態確認と誘導のみ」を維持・強化する形）。`authMethods` を読み取って動的に認証 UI を出す方向は採らない |
| ~~**V-11**~~ | ~~`sbx login` の再認証が必要になったとき、`sbx diagnose` で検出できるか~~ | ✅ **解決（2026-09-29）。** `sbx diagnose --json` の `checks` 配列に `"name": "Authentication"` という専用チェックがある。認証済みは `status: "pass"`, `message: "authenticated"`。**別環境での実測で未認証時の値も確認できた**：`status: "fail"`, `message: "not signed in"`, `hint: "Run: sbx login"`。`status !== "pass"` を見るだけで機械的に検出でき、`hint` の文言をそのまま誘導表示に使える。検出後の導線は N-2-7b の L1（OS のターミナルを開いて `sbx login`）どおり。なお同じ実測で「未認証だと `Daemon diagnostics` チェックが `skip`（`daemon requires auth for diagnostics`）になる」ことも分かった——認証切れは他チェックの結果にも波及しうるので、判定は `Authentication` チェック単体の `status` を見ることに留めるべき |
| ~~**V-12**~~ | ~~`sbx secret set --oauth` は openai 以外に広がるか~~ | ❌ **不要になった。** エージェント自身の OAuth（`claude auth login`）を使うため、`sbx` の OAuth に依存しない |
| ~~**V-13**~~ | ~~Claude Code の OAuth がローカルコールバックを要求するか~~ | ❌ **不要になった。** 認証フローをターミナルに委ね、shovel はコールバックを受けないため。`sbx ports --publish` も不要 |
| ~~**V-14**~~ | ~~Windows で stdio の改行が `\r\n` になるか~~ | ✅ **検証不要にした（2026-09-14）。** 確かめるより**行分割で両方を許容する方が安く確実**なため、設計規則に格上げした（architecture.md §3） |
| ~~**V-15**~~ | ~~Windows の `sbx` は `.exe` か `.cmd` か~~ | ✅ **解決（2026-09-14）。** `C:\Users\<user>\AppData\Local\DockerSandboxes\bin\sbx.exe` の実行可能ファイル。`shell: false` のまま `spawn` でき、「シェルを介さない」という前提（architecture.md §3）が Windows でも守られる |
| ~~**V-16**~~ | ~~Windows で `node_modules` などの深い階層が `MAX_PATH`（260 文字）に触れないか~~ | ✅ **解決（2026-09-29）。問題なしと判断。** shovel のファイルツリー/ファイラーはコーディング用エディタ（IDE 相当のプロジェクト全体編集）ではないため、深い階層を持つ `node_modules` 等を前提にした操作は想定しない |
| ~~**V-17**~~ | ~~エージェントの認証はサンドボックス間で共有されるか~~ | ✅ **解決（2026-09-14）。共有される。** 一度もログインしていない新しいサンドボックスが `loggedIn: true` を返すことを確認。**プロジェクト作成フローにログインステップは不要。** ただし `loggedIn` 以外のフィールドは欠落・`null` になりうるため依存しないこと（decisions.md N-2-7b） |
| ~~**V-18**~~ | ~~認証が共有される**仕組み**（`sbx secret` のプロキシ注入か、共有ボリュームか）。`sbx logout` の影響範囲~~ | ✅ **解決済み扱いとする（2026-09-29）。** `sbx` の内部の仕組みには shovel は関与しない方針とした。引き続き**挙動だけを前提にし仕組みには依存しない**（decisions.md N-2-7b）。今後仕組みが変わっても shovel 側の実装に影響しないよう作ってあるため、この先追加で調査する予定もない |
| ~~**V-19**~~ | ~~`@agentclientprotocol/claude-agent-acp` は `agent_message_chunk` に ACP v1 の任意フィールド `messageId` を実際に付けて送ってくるか~~ | ✅ **検証済み（2026-09-30）。送ってくる。** decisions.md C-4 の `messageId` 比較は shovel の主対象エージェントで実際に機能する前提で進めてよい |
| **V-20** | 日本語・空白を含むファイル名を添付したとき、claude-agent-acp 経由でエージェントが正しく Read できるか。shovel は `resource_link` の URI を `file://` ＋ 生のパスで組み立てており、パーセントエンコードしていない（RFC 上は誤り）。エンコードすると、モデルが `%E3%…` のまま Read しようとするおそれがある | `connection.ts` の `prompt()` で URI をエンコードするかどうか。変える場合は `translate.ts` の `chipFromUri`（replay 時のチップ復元）も合わせて直す（decisions.md G-1-5a） |
| **V-21** | Markdown の印刷用表示（decisions.md N-3-10）から OS の印刷ダイアログを出し、PDF に保存したときの仕上がり（図の大きさ・改ページ・コードブロックの地の色）。開発用サンドボックスには印刷系が無く、ダイアログも PDF 出力も確かめられていない（画面の描画・描画完了待ち・ウィンドウの開閉は確認済み） | `print.css` の改ページ・図の最大高さ・余白の調整が要るか |
| **V-22** | TTY モード（decisions.md N-4）のバイト列が `sbx exec -i` のパイプを通っても欠けず・変わらずに届くか。特に Windows の `sbx.exe` 経由（改行の変換、`\x03` や ESC の扱い、base64 の長い引数）。試作は `sbx exec` を通さずに確認しただけ | TTY モードを Windows でも出すか。ラッパーの起動方法を変える必要があるか |
| **V-23** | 対応表の各エージェントのテンプレート（claude 以外も含む）に `python3` が入っているか | TTY モードを使えないテンプレートがどれだけあるか。代替（`script` など）を再検討するか |
| **V-24** | 実際に TUI を求めるツール（MCP の設定・認証など）が TTY モードで最後まで操作できるか（矢印キーの方式、Space での複数選択、ブラウザを開く OAuth との組み合わせ） | xterm.js の設定やラッパーに追加が要るか |
| **V-25** | CodeMirror 6 のエディタ（decisions.md N-3-1「改訂（2026-10-17）」）で、日本語 IME の変換中の入力・確定・取り消しが崩れないか（macOS / Windows の実機。変換中の Enter・Tab・Cmd/Ctrl+F、自動保存や外部変更の読み直しと変換中が重なったとき、選択とカーソルを CodeMirror が描く `drawSelection` との組み合わせ）。開発用サンドボックス（Xvfb）では IME を確かめられない | CodeMirror に回避の設定が要るか。変換中は自動保存・読み直しを遅らせる必要があるか |

---

## B. 未議論の論点

議論順の想定。上ほど上流。

| ID | 論点 | 概要 |
| :--- | :--- | :--- |
| ~~**C-1 / C-2**~~ | ~~セッション履歴~~ | ✅ **方針決定（2026-09-29）。Local Record First を採用**（decisions.md C-1/C-2）。ローカルスナップショットに1件でも記録があれば `session/load` の replay で上書きしない——エージェントはコンテキストを要約・省略することがあり、replay はエージェント側で圧縮された記憶でしかないため。**実装済み（2026-09-30）**：replay 抑制を `src/main/acp/connection.ts`（`startRestoredSession` / `reconcileReplay`）に実装した |
| **C-1/C-2 補遺** | 履歴一覧の和集合化 | ✅ **方針決定（2026-09-30、decisions.md C-1/C-2 補遺・C-5 追記）**：履歴一覧を `session/list` とローカル記録の和集合にし、行ごとに状態を表示する。削除は可能なら `session/delete` を送り、送れなくても `.deleted` の `acpSessionId` で一覧から除外する。使われなかったセッションの破棄は、下記の検証結果により実装しない。**実装済み（2026-09-30）**：`sessionManager.ts` の `listHistory` / `deleteHistorySession` / `resumeAgentSession`、履歴パネルの状態アイコン。**検証結果（2026-09-30）**：`claude-agent-acp` の `session/list` は**プロンプト未送信のセッションを返さない**。**要検証（残り）**：別 `cwd` のセッションを返すか |
| **C-3** | アプリ外セッションの範囲 | ✅ 解決済み（decisions.md C-3）。同一サンドボックス内でターミナルから動かしたセッションのみが対象 |
| ~~**C-4**~~ | ~~セッションのバックアップ~~ | ✅ **方針決定・UI決定（2026-09-30）。** 採用（decisions.md C-4）：`load` 対応時のみ、`agent_message` の ACP `messageId` だけで食い違いを検出する。一致すれば何もしない、食い違えば今のローカルを `.backup` へ退避してから replay 側の内容を新しい表示にする——**「保存は切り詰めない、表示はエージェントに追従させる」の2軸**。バックアップは自動削除しない（無期限に残す）。V-19（`messageId` を送るか）は検証済み(送ってくる)。UI はサイドバーの行展開＋控えめな notice 通知（`ui.md`「チャット履歴パネル」）。**実装済み（2026-09-30）**：`SnapshotEntry.messageId`、`snapshot.ts` の `.backup` 読み書き、`messageId` 比較と表示の置き換え、notice 行、サイドバーのバックアップ展開 |
| ~~**C-5**~~ | ~~ソフトデリート／Read Only タブ~~ | ✅ **方針決定・UI決定（2026-09-30）。** 削除は即時完全削除ではなく `{sessionId}.json.{epochMillis}.deleted` へ退避し、そのセッションのバックアップ(C-4)があれば同様に個別リネームして残す（decisions.md C-5、`flows.md` の削除フローも更新済み）。再発見導線はサイドバーの「削除済みを表示」トグル。Read Only タブは既存の `HistoryView` に `readOnlyKind` を追加して流用（再開/新規開始は隠す）。完全削除のタイミングは設けない（無期限保持）。**実装済み（2026-09-30）**：`softDeleteSnapshot()`、「削除済みを表示」トグル、`HistoryView` の `readOnlyKind`。`session/delete` の送信は未実装 |
| ~~**C-6**~~ | ~~ローカルセッション検索~~ | ✅ **方針・UI決定（2026-09-30、decisions.md C-6 / `ui.md`「チャット履歴パネル」）**：チャット履歴パネルの「履歴」見出し右寄せに検索アイコン(🔎)。検索範囲はプロジェクトの全ローカルスナップショット(現在・`.backup`・`.deleted`)、見出し自体の表示条件も同様に揃える。結果表示は **Gemini のセッション検索を参考にした平易なスニペット表示**（タイトル太字＋マッチ箇所を平文抜粋＋右寄せ日付、プレビュー欄無し）を採用。**実装済み（2026-09-30）**：`src/shared/plainText.ts`（平文抽出・一文抜粋）、`src/main/domain/localSearch.ts`（検索と打ち切り）、`LocalSearchDialog` |
| **N-3** | エディタ / Diff / ファイラー | **実装量が最大。** IDE が無償提供していたもの（Diff ビューア、エディタ、ファイルツリー、ファイル関連付け起動）を全て自作する必要がある。**設計としては N-3-1〜N-3-8 すべて決定済み**（N-3-7 は廃止、N-3-6 は2026-09-30 に「変更」サイドバー廃止後の状態へ更新）。**Diff ビューア（N-3-8）・ファイルツリー（N-3-4/5）・Markdown エディタ（N-3-3）・関連付け起動（N-3-2）は実装済み**。ファイラーのコンテンツ検索（N-3-11、2026-10-08。2026-10-19 にファイル名も対象に）と、開いているファイルのパス表示（N-3-13）も実装済み |
| ~~**N-5**~~ | ~~編集ロック~~ | ✅ **決定済み（decisions.md N-5）。ターン実行中の編集ロックは対応しない。** 最大10タブが並行してターンを走らせるためほぼ常にロックされた状態になり、中心的ユースケースと衝突する。代わりに autosave ＋ 競合コピーで解く |
| ~~**D-3**~~ | ~~外部変更の検知~~ | ✅ **決定済み（decisions.md N-3-6、2026-09-30 に整合性を修正）。** ツリーは展開中フォルダのみ・開いているファイルは再読込、いずれもターン終了時（`chokidar` 等の常時監視はしない、V-8 で恒久決定）。`tool_call` の `locations`/`diffs` は使わず、単純に「展開中フォルダだけ readdir」で済ませる方針。「何が変わったかを知らせ、戻せるようにする」責務は「変更」サイドバー廃止（A-3-8）に伴い無くなった——知らせる方はトランスクリプトの per-tool-call diff（N-3-8）が担い、戻す仕組みは作らない |
| ~~**D-4**~~ | ~~巨大ディレクトリ~~ | ✅ **決定済み（decisions.md N-3-9、`ui.md` §9、2026-09-30）。** `node_modules`/`.git` の扱いは N-3-5（薄く表示／既定非表示）と遅延展開（N-3-4）で既に解決済み。残っていた「展開しようとして失敗する場合」は、原因を区別せず淡色の「…」プレースホルダ＋ツールチップのみで済ませ、通知は出さないと決定 |
| ~~**N-4**~~ | ~~`sbx exec` 一発実行~~ | ✅ **決定済み（decisions.md N-4、2026-09-30）。** 出力はストリーム表示。安全性は①隔離のみが担う（旧「④回復」参照は A-3-8 廃止に伴い削除、承認カードも通さずユーザー自身の判断に委ねる）。**履歴の持ち方**：コマンド文字列のみ保存（出力ログ等は保存しない）／同じコマンドは MRU 方式で重複させない／保持件数は最新20件／UI は↑キーと履歴一覧パネルを併用／選択しても即実行せず入力欄に差し込むだけ／ピン留め最大10件（20件の外・再実行しても位置固定・外すと履歴の先頭へ、2026-10-03） |
| ~~**G-1**~~ | ~~チャット画面の構成要素~~ | ✅ **決定済み（2026-09-30 確認）。** 入力欄／アクションバー(Mode/Model/Effort/トークン使用量) は decisions.md G-1-4・G-1-8、`ui.md` §8。コンテキストチップは decisions.md G-1-5、`ui.md` §7。思考ログ表示エリアは `ui.md` §6。背景タブの通知は decisions.md G-1-4(旧)、`ui.md` §4。CLAUDE.md の実装状況メモとも一致しており、実装済み。`open-issues.md` の記述だけが更新されずに取り残されていた（ついでに decisions.md 側の「G-1-4」重複採番・「G-1-5」番号衝突も修正済み） |
| ~~**G-3**~~ | ~~オンボーディングと空状態~~ | ✅ **決定済み（2026-09-30 確認）。** 初回起動フロー・空状態は decisions.md G-3-1/G-3-2/G-3-3、空状態のモックアップは `ui.md` §2 に追加済み。複数プロジェクトの同時実行は architecture.md（単一インスタンス＋複数ウィンドウ、VS Code と同じモデル）で既に可能と規定済み。`open-issues.md` の記述だけが更新されずに取り残されていた |
| ~~**F-1**~~ | ~~Electron のプロセス構成~~ | ✅ **決定済み（decisions.md F-1）。** main（ACPクライアント/sbx実行/fs/git/永続化/ログ/ウィンドウ管理）・preload（`contextBridge`）・renderer（ウィンドウごと）の3層。IPCは`sessionId → webContents`でルーティング。`contextIsolation: true`/`nodeIntegration: false`/CSP/`will-navigate`封鎖も決定済み |
| ~~**F-2**~~ | ~~設定の永続化~~ | ✅ **決定済み（decisions.md F-2 / F-2b）。** プロジェクト一覧・設定・ウィンドウ状態・サイドバー幅は`electron-store`、セッションスナップショットは個別JSONファイル。SQLiteは不採用。ネイティブモジュールもゼロ（`node-pty`/`better-sqlite3`とも不使用） |
| ~~**F-3**~~ | ~~配布とコード署名~~ | ✅ **決定済み（decisions.md F-3）。** v0(署名無し)→v1(macOSのみ$99/年)→v2(Windows証明書追加)の段階導入。`electron-builder`設定は最初から書いておき証明書は後から差し込む。年間費用の確定は設計段階では不要と判断 |
| ~~**F-4**~~ | ~~自動更新~~ | ✅ **決定済み（decisions.md F-4）。** `electron-updater`の構成のみ先に入れ、署名後に有効化する（署名が無いと自動更新自体が機能しないため F-3 に従属） |
| ~~**F-5**~~ | ~~i18n~~ | ✅ **決定済み（decisions.md F-5 新設 / `ui.md` §13）。** 英語・日本語をサポート。初期言語は`app.getLocale()`、設定で変更可能。ファイル名・識別子に言語依存文字列を入れない原則も決定済み |
| ~~**N-6**~~ | ~~Windows 対応~~ | ✅ **クローズ（2026-09-30）。** 依存していた V-6（`sbx` は Windows で動作、パスは MSYS 形式）・V-7（mise は Windows 正式サポート）はいずれも解決済み（decisions.md N-6a）。追加の設計判断は無く、その内容に沿って実装するのみ |
