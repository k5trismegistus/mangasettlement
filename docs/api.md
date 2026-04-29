# API設計ドラフト v0.2

## 方針

- Web画面とAPIは同一Node.jsサーバーで提供する
- APIはJSONを基本とする
- 画像取得APIのみ画像バイナリを返す
- 全画面・全APIにBasic認証を適用する
- 認証情報は `.env` で管理する
- zip内画像は展開保存せず、リクエスト時にzipから読み出す
- 保留事項は残さず、本設計時点の決定事項として定義する

---

## 認証

### Basic認証

環境変数:

- `BASIC_AUTH_USER`
- `BASIC_AUTH_PASSWORD`

対象:

- Web画面
- API
- 画像取得API
- サムネイル取得API

---

## API一覧

## 1. ライブラリ一覧取得

- Method: GET
- Path: `/api/libraries`

### Query

- `q`: ファイル名検索キーワード（部分一致）
- `tag`: タグ名（完全一致）
- `include_missing`: 欠損zipを含めるか
- `limit`: 取得件数
- `offset`: 取得開始位置

### 仕様

- 更新日時降順で返す
- 通常は欠損zipを除外する
- `include_missing=true` の場合のみ欠損zipも返す
- `q` 指定時はファイル名部分一致検索
- `tag` 指定時はタグ完全一致検索
- `q` と `tag` の同時指定時はAND条件

### Response

- `items`
  - `id`
  - `file_name`
  - `page_count`
  - `cover_thumbnail_url`
  - `tags`
  - `is_missing`
  - `updated_at`
- `total`
- `limit`
- `offset`

---

## 2. ライブラリ詳細取得

- Method: GET
- Path: `/api/libraries/:id`

### Response

- `id`
- `sha256`
- `file_name`
- `file_path`
- `file_size`
- `file_mtime`
- `page_count`
- `cover_page`
- `tags`
- `memo`
- `is_missing`
- `created_at`
- `updated_at`

---

## 3. ページ一覧取得

- Method: GET
- Path: `/api/libraries/:id/pages`

### 仕様

- ページ番号順に返す
- サムネイルURLを含める
- 原寸画像URLを含める
- 未生成・生成失敗ページも返す

### Response

- `library_id`
- `pages`
  - `page_no`
  - `entry_name`
  - `thumbnail_url`
  - `image_url`
  - `thumb_status`
  - `width`
  - `height`

---

## 4. 原寸画像取得

- Method: GET
- Path: `/api/libraries/:id/pages/:page/image`

### 仕様

- zipから該当ページを読み出して返す
- `Content-Type` は画像形式に応じて設定する
- zipファイルは展開保存しない
- 欠損zipは404
- ページ未存在は404
- zip読み込み失敗は500
- Range RequestはMVPでは非対応
- Cache-Controlを設定する

---

## 5. サムネイル取得

- Method: GET
- Path: `/api/libraries/:id/pages/:page/thumbnail`

### 仕様

- 生成済みならサムネイル画像を返す
- 未生成ならプレースホルダー画像を返す
- 生成失敗ならエラー画像を返す
- 画像形式はwebp
- 保存先は `thumbnail/<sha256>/`
- Cache-Controlを設定する

---

## 6. リフレッシュ開始

- Method: POST
- Path: `/api/refresh`

### 仕様

- `library/` をスキャンする
- 新規zipを検出する
- 更新zipを検出する
- 名前変更zipを検出する
- 削除zipを検出する
- 重い処理はバックグラウンドジョブ化する
- 実行中ジョブがある場合は多重起動を拒否する
- 即時レスポンスを返す

### 正常Response

- `job_id`
- `status`

### 実行中Response

- HTTP 409 Conflict
- `error.code = REFRESH_ALREADY_RUNNING`

---

## 7. ジョブ状態取得

- Method: GET
- Path: `/api/jobs/:id`

### Response

- `id`
- `type`
- `status`
- `progress`
- `message`
- `created_at`
- `started_at`
- `finished_at`

### status

- `queued`
- `running`
- `done`
- `error`

---

## 8. タグ更新

- Method: PUT
- Path: `/api/libraries/:id/tags`

### Request

- `tags`: 文字列配列

### 仕様

- タグは自由入力
- 存在しないタグは自動作成する
- 空配列なら全削除する
- zip単位で管理する

### Response

- `id`
- `tags`

---

## 9. メモ更新

- Method: PUT
- Path: `/api/libraries/:id/memo`

### Request

- `memo`: 文字列

### 仕様

- zip単位で管理する
- メモ全文検索はMVP対象外

### Response

- `id`
- `memo`

---

## 10. タグ一覧取得

- Method: GET
- Path: `/api/tags`

### 仕様

- 登録済みタグ一覧を返す
- タグフィルタUIや入力補完で利用する
- 名前昇順で返す

### Response

- `tags`
  - `id`
  - `name`
  - `library_count`

---

# エラーレスポンス

## 基本形式

- `error`
  - `code`
  - `message`

## エラーコード

- `AUTH_REQUIRED`
- `NOT_FOUND`
- `LIBRARY_MISSING`
- `PAGE_NOT_FOUND`
- `ZIP_READ_ERROR`
- `INVALID_REQUEST`
- `REFRESH_ALREADY_RUNNING`
- `INTERNAL_ERROR`

---

# APIの決定事項

- タグ検索は完全一致
- ファイル名検索は部分一致
- 欠損zipはDB保持、通常一覧では非表示
- refresh jobの多重起動は禁止
- サムネイル形式はwebp固定
- 画像API / サムネイルAPIはCache-Controlあり
- Range RequestはMVP対象外
