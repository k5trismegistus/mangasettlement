# DB設計ドラフト v0.1

## 方針

- DBは SQLite
- マイグレーション可能な構成にする
- zipファイル本体は保存しない
- 管理情報・検索情報・UI設定のみ保持する

---

# テーブル一覧

1. libraries
2. pages
3. tags
4. library_tags
5. app_settings
6. jobs（任意: サムネイル生成管理）

---

# 1. libraries

zipライブラリ本体の管理テーブル

| カラム名   | 型          | 説明               |
| ---------- | ----------- | ------------------ |
| id         | INTEGER PK  | 内部ID             |
| sha256     | TEXT UNIQUE | zip識別子          |
| file_name  | TEXT        | 表示ファイル名     |
| file_path  | TEXT        | library内相対パス  |
| file_size  | INTEGER     | バイト数           |
| file_mtime | INTEGER     | 更新日時(epoch)    |
| page_count | INTEGER     | 総ページ数         |
| cover_page | INTEGER     | 表紙ページ番号     |
| memo       | TEXT        | メモ               |
| is_missing | INTEGER     | ファイル欠損フラグ |
| created_at | INTEGER     | 初回登録日時       |
| updated_at | INTEGER     | 最終更新日時       |

---

# 2. pages

zip内ページ情報

| カラム名     | 型         | 説明                         |
| ------------ | ---------- | ---------------------------- |
| id           | INTEGER PK | 内部ID                       |
| library_id   | INTEGER FK | libraries.id                 |
| page_no      | INTEGER    | 表示順ページ番号             |
| entry_name   | TEXT       | zip内部パス                  |
| width        | INTEGER    | 画像幅                       |
| height       | INTEGER    | 画像高さ                     |
| thumb_status | TEXT       | none / queued / done / error |

制約:

- UNIQUE(library_id, page_no)

---

# 3. tags

タグマスタ

| カラム名 | 型          | 説明   |
| -------- | ----------- | ------ |
| id       | INTEGER PK  | ID     |
| name     | TEXT UNIQUE | タグ名 |

---

# 4. library_tags

ライブラリとタグの中間テーブル

| カラム名   | 型         | 説明         |
| ---------- | ---------- | ------------ |
| library_id | INTEGER FK | libraries.id |
| tag_id     | INTEGER FK | tags.id      |

制約:

- UNIQUE(library_id, tag_id)

---

# 5. app_settings

全体設定

| カラム名 | 型      | 説明           |
| -------- | ------- | -------------- |
| key      | TEXT PK | 設定キー       |
| value    | TEXT    | 設定値(JSON可) |

保存例:

- viewer.defaultBinding = rtl
- viewer.preloadCount = 2
- auth.enabled = true

---

# 6. jobs（任意）

バックグラウンド処理管理

| カラム名   | 型         | 説明                      |
| ---------- | ---------- | ------------------------- |
| id         | INTEGER PK | ID                        |
| type       | TEXT       | thumbnail_generate        |
| target_id  | INTEGER    | library_id                |
| status     | TEXT       | queued/running/done/error |
| message    | TEXT       | ログ                      |
| created_at | INTEGER    | 作成日時                  |

---

# インデックス

## libraries

- INDEX file_name
- INDEX updated_at
- INDEX is_missing

## pages

- INDEX library_id

## tags

- UNIQUE name

---

# 検索仕様

## ファイル名検索

- libraries.file_name LIKE '%keyword%'

## タグ検索

- tags.name 完全一致 / 部分一致

## 両方指定

- AND 条件

---

# リフレッシュ時の更新ルール

## 新規zip

- libraries追加
- pages追加
- thumbnail queue追加

## 更新zip

- libraries更新
- pages再生成
- サムネイル再生成

## 名前変更のみ

- file_name / file_path 更新

## 削除zip

- is_missing = 1

---

# 削除ポリシー（現時点案）

- 物理削除せず履歴保持
- UIでは通常非表示
- 再配置されたら復帰可能

---

# 次フェーズ候補

- API詳細設計
- 画面遷移設計
- バックグラウンドジョブ設計
- ディレクトリ構成/実装構成
- 開発タスク分解
