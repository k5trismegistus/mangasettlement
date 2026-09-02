# Codex Working Rules

## Repository guide: Manga Settlement

家庭内 LAN で利用する、zip 形式の漫画ライブラリ用 Web アプリケーションである。`library/` に置かれた zip を直接読み込み、SQLite に索引・タグ・メモ・ジョブ状態を保持し、サムネイルを `thumbnail/` にキャッシュする。Web UI と JSON API は同じ Fastify サーバーから提供する。

### Technical baseline

* Runtime: Node.js の ESM プロジェクト。パッケージマネージャーは npm とし、ロックファイルは `package-lock.json` を正とする。
* Backend: TypeScript、Fastify、`better-sqlite3`。エントリポイントは `src/server.ts`。
* Frontend: React、Vite、Material UI。フロントエンドは `frontend/`、ビルド結果は `dist/public/`。
* Persistence: SQLite は `data/app.sqlite`。ライブラリ本体は `library/`、サムネイルは `thumbnail/`。
* Authentication: 全画面・全 API に Basic 認証を適用する。設定は `.env` の `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`、任意で `HOST` / `PORT`。

### Project map

* `src/server.ts`: 起動、環境変数読込、DB 初期化、認証、API と静的ファイル配信の登録。
* `src/routes/api.ts`: HTTP API。入力検証、HTTP ステータス、エラー形式をここで統一する。
* `src/repositories/`: SQLite への読み書き。DB の操作は可能な限りここへ置く。
* `src/jobs.ts`: refresh とサムネイル生成のプロセス内ジョブ管理。
* `src/zip.ts`: zip 内エントリの読み取りと画像の扱い。
* `src/http/`: リクエスト値のパース、共通レスポンス。
* `src/media/`: プレースホルダーなどの画像補助。
* `frontend/src/main.tsx`: 現在の単一 React エントリポイント。UI のスタイルは `frontend/src/styles.css`。
* `docs/`: 要件・API・DB・ジョブ・画面の設計資料。特に `docs/api.md`、`docs/database.md`、`docs/job.md`、`docs/page.md` を関連変更時の参照先とする。

### Standard local commands

```bash
npm install
cp .env.example .env
npm run init
npm run dev
npm run typecheck
npm run build
npm run start
```

* `npm run init` は `library/`、`thumbnail/`、`data/` と SQLite schema を初期化する。既存の利用データがある環境で実行する前は、必要性と影響を確認する。
* `npm run dev` はバックエンドの watch と Vite 開発サーバーを起動する。Vite は `/api` をポート 3000 のバックエンドへプロキシする。
* `npm run build` はサーバーとフロントエンドをビルドする。`npm run start` の前に必要である。
* 自動テスト用のスクリプトは現時点ではない。コード変更の最低限の検証は `npm run typecheck` と、変更範囲に応じた `npm run build` とする。API・UI・DB・zip 処理に触れた場合は、可能な範囲でローカルの手動確認も行う。

### Data, security, and compatibility rules

* `library/` の zip はユーザーの一次データである。読み取り専用として扱い、内容・名前・配置を変更、削除、展開保存しない。
* `data/app.sqlite`、`thumbnail/`、`library/` は実行時データであり `.gitignore` の対象である。削除、再生成、DB schema 変更、実データを伴う migration は、明示的な依頼または事前承認なしに行わない。
* `.env` は秘密情報を含む。値を表示、コミット、ドキュメントへ転記しない。設定項目の追加時は値を含めず `.env.example` と README を更新する。
* Basic 認証は API・画像・静的 UI を含めて一貫して維持する。認証の回避、無効化、認証情報のハードコードは行わない。
* zip の識別子は SHA-256、欠損ファイルは `is_missing` で保持する。更新・名前変更・欠損時の扱いを変更する場合は、既存データとの互換性を確認する。
* サムネイル生成の失敗は個別ページの失敗として扱い、ライブラリ全体の閲覧や後続ジョブを不要に停止させない。

### Change-specific checks

* API を変更する場合は、HTTP メソッド、パス、JSON 形式、エラーコード、既存 UI への影響を確認し、`docs/api.md` との整合を保つ。既存クライアント互換性を壊す変更は事前に相談する。
* DB を変更する場合は、既存の `CREATE TABLE IF NOT EXISTS` ベースの初期化だけで既存 DB に必要な列やデータが確実に反映されるかを確認する。互換性のない変更は migration 方針とバックアップ方針を先に提示する。
* ジョブを変更する場合は、同時実行数 1、refresh の多重起動拒否、起動時の中断ジョブ復旧、サムネイル失敗時の継続を維持する。
* zip・画像処理を変更する場合は、日本語ファイル名、入れ子ディレクトリ、自然順のページ並び、対応画像形式、破損 zip / 破損画像のエラー処理を意識する。
* UI を変更する場合は、主対象である iPhone の縦持ち・片手操作・狭い画面を優先する。必要に応じて PC のレスポンシブ表示も確認し、見開き、右綴じ / 左綴じ、タップ / スワイプ、2本指ズームを壊さない。
* 機能仕様やセットアップ方法に変更がある場合は、該当する `docs/` と `README.md` を必要な範囲で同期する。実装と資料が矛盾した場合は、変更依頼・現行コード・ユーザー確認の優先順位を明確にする。

## 1. Understand before acting

依頼を受けたら、十分な情報がないまま実装や成果物作成を開始しない。

まず必要な範囲で、目的、要件、制約、既存仕様、影響範囲、不明点を把握する。

不明点は次のように扱う。

* 結果や方針を大きく左右する → 実行前に質問する
* 既存コードや既存仕様から合理的に判断できる → 既存パターンに従う
* 軽微で容易に修正可能 → 仮定して進めてよい

質問が必要な場合は細かく何度も聞かず、可能な限りまとめる。
選択肢がある場合は、質問だけでなく推奨案と理由も示す。

メッセージが明らかに途中送信の場合は、作業を開始せず続きを確認する。

## 2. Plan before significant work

複数箇所にまたがる変更、設計判断を伴う変更、既存仕様へ影響する変更では、実装前に短い方針を提示する。

方針には必要に応じて、変更対象、実装方法、影響範囲、リスク、テスト方法を含める。

単純な調査や明白な局所修正では、形式的な計画は不要。

## 3. Ask before external or risky actions

調査・読み取りと、外部環境へ作用する操作を区別する。

次の操作は、ユーザーがその具体的な操作を明示的に依頼している場合を除き、実行前に「何を・なぜ・どこに対して行うか」を説明して承認を得る。

* SSH / SSM / kubectl exec 等による外部環境への接続
* EKS / Kubernetes / AWS / GCP / Azure 等への変更操作
* 本番・ステージング環境でのコマンド実行
* DBや外部サービスへの書き込み
* migrationの実行
* deploy / release
* データ削除や不可逆操作
* 課金や大きな計算資源を消費する操作

「調べて」「直して」などの一般的な依頼を、これらの操作への包括的な許可とは解釈しない。

安全なローカル調査や読み取りは、確認待ちにせず進めてよい。

## 4. Agree on content before expensive artifacts

PowerPoint、PDF、図、長大なドキュメントなど、生成コストの大きい成果物はいきなり作成しない。

まずテキストで次を整理する。

* 目的
* 想定読者
* 伝えるべき内容
* 構成・アウトライン
* 必要に応じて各セクションの要点

ユーザーと内容・構成を固めてから、実ファイルや最終成果物を生成する。

すでに内容が十分確定しており、ユーザーが明示的にその内容で成果物作成を指示した場合は、この確認を省略してよい。

## 5. Respect the existing repository

コードを変更する場合は、対象に適用される AGENTS.md と既存コードを確認する。

必要に応じて次を確認する。

* git status と現在のブランチ
* 未コミット変更
* 関連する実装、テスト、型、設定、ドキュメント
* 類似する既存実装

既存の未コミット変更はユーザーまたは別作業によるものとして扱い、明示的な指示なしに削除、巻き戻し、上書き、無関係な整形をしない。

一般的なベストプラクティスより、既存コードベースの設計、命名、テスト方針、ディレクトリ構成との整合性を優先する。

ただし、明確な不具合、セキュリティ問題、データ破壊リスクは盲目的に踏襲しない。

## 6. Keep changes scoped

依頼達成に直接必要な変更だけを行う。

明示的な依頼または事前確認なしに、次を行わない。

* スコープ外のリファクタリング
* 大規模なアーキテクチャ変更
* 新しい外部依存関係の追加
* 大量ファイルの自動整形
* 未要求の機能や抽象化の追加

必要だと判断した場合は、実施前に理由、影響範囲、代替案を提示する。

## 7. Test behavior, preferably test-first

テスト可能なコード変更では、既存のテスト方針に従って検証する。

既存のテスト基盤があり、変更する振る舞いを適切に表現できる場合は、原則として失敗するテストを先に追加してから実装する。

ただし、次の場合は形式的なTDDを必須としない。

* テスト基盤がない、または不安定
* 文言、設定、ドキュメントのみの変更
* 環境依存で自動テスト化が現実的でない
* 調査しないと適切なテストを設計できない

テストは可能な限り実装内部ではなく、外部から観測可能な振る舞いを保証する。

次の場合は、テストを書く前にケース案を提示して確認する。

* テストによって新しい仕様を固定する
* 期待値に複数の妥当な解釈がある
* 既存挙動を維持するか変更するか判断が必要
* 重要な業務ルールを新たに定義する

確認する場合は、質問だけでなく推奨するテストケースと理由も示す。

## 8. Verify and report truthfully

変更後は、影響範囲に応じてテスト、lint、typecheck、build、手動確認など必要な検証を行う。

まず変更箇所に近い検証を行い、必要に応じて範囲を広げる。

実行していないテストや確認していない挙動を、実行済み・確認済みとして報告しない。

検証できなかった重要事項がある場合は、その理由と残るリスクを明示する。

スコープ外の問題は原則として勝手に修正しない。
明確な不具合、セキュリティリスク、データ破壊リスク、重大な運用問題など、対応価値の高いものだけ報告する。

## 9. Do not publish without permission

実装依頼を、Gitや外部サービスへの公開操作の許可とは解釈しない。

ユーザーの明示的な指示なしに次を行わない。

* commit
* push / force push
* branch削除
* tag作成
* PR作成・マージ
* release作成
* git worktree の利用

リポジトリ固有の明示的なルールがある場合はそれに従う。

## 10. Task management

タスク管理には、原則として GitHub Issues ではなく以下の Notion データベースを使用する。

### Projects

複数タスクを伴う中期的な改修で、ユーザーが明確に「プロジェクト化する」と指定したものを管理する。

https://app.notion.com/p/cuusoo/Projects-2f875dfda994808da984cc79e4d01ee8

### Dev Kanban

それ以外の個別タスクや先行タスクを管理する。

https://app.notion.com/p/cuusoo/5b38a2992a034b54aca89ddad2d37c12?v=0fd22b378e464db69887c6fb3c3a8511

GitHub Issues は、ユーザーが明示的に GitHub Issue の作成・更新を依頼した場合のみ使用する。

「タスク化して」「TODOにして」「後続タスクを作って」などの依頼を、GitHub Issue 作成の許可とは解釈しない。

タスク管理への追加・更新自体が依頼されていない場合は、Notion・GitHubを含め、外部のタスクを自動的に作成・更新しない。
