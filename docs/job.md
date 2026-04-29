# バックグラウンドジョブ設計ドラフト v0.1

## 方針

- 重い処理はバックグラウンドジョブとして実行する
- MVPではNode.jsプロセス内の簡易キューで管理する
- 外部ジョブキューやRedisは使わない
- 同時実行数は1
- ジョブ状態はSQLiteに保存する
- アプリ再起動後もジョブ状態を確認できるようにする

---

# ジョブ一覧

1. refresh
2. thumbnail_generate

---

# 1. refresh ジョブ

## 目的

`library/` ディレクトリ内のzipファイル状態をDBへ反映する。

---

## 実行タイミング

- トップページのリフレッシュボタン押下時
- `/api/refresh` 呼び出し時

---

## 多重起動制御

- refreshジョブ実行中は新しいrefreshジョブを開始しない
- 実行中に `/api/refresh` が呼ばれた場合は409 Conflictを返す
- エラーコードは `REFRESH_ALREADY_RUNNING`

---

## 処理手順

1. `library/` ディレクトリを再帰的に走査する
2. 拡張子 `.zip` のファイルを検出する
3. DB上の既存libraries情報と照合する
4. file_size と file_mtime が一致するファイルは既存扱いにする
5. 変更があるファイルのみ sha256 を計算する
6. 新規zipを登録する
7. 更新zipを再解析する
8. ファイル名変更zipは file_name / file_path を更新する
9. 削除されたzipは `is_missing = 1` にする
10. 新規または更新zipのページ一覧を作成する
11. 新規または更新zipに対して thumbnail_generate ジョブを作成する
12. refreshジョブを完了状態にする

---

## 新規zip判定

条件:

- sha256 がDBに存在しない

処理:

- librariesに新規登録
- pagesを作成
- thumbnail_generateジョブを作成

---

## 更新zip判定

条件:

- file_path が同じ
- file_size または file_mtime が変化している
- sha256も変化している

処理:

- librariesを更新
- 既存pagesを削除して再作成
- 既存サムネイルを削除
- thumbnail_generateジョブを作成

---

## ファイル名変更判定

条件:

- sha256 がDBに存在する
- file_path または file_name が変化している

処理:

- librariesの file_name / file_path / file_mtime を更新する
- pagesは再作成しない
- サムネイルは再利用する

---

## 削除zip判定

条件:

- DBに存在する file_path が `library/` に存在しない

処理:

- `is_missing = 1` にする
- 通常一覧からは非表示
- DBレコードとサムネイルは削除しない

---

# 2. thumbnail_generate ジョブ

## 目的

zip内画像からページサムネイルを生成する。

---

## 実行タイミング

- refreshジョブで新規zipまたは更新zipが見つかったとき

---

## 処理手順

1. 対象libraryを取得する
2. 対象libraryのpagesをページ番号順に取得する
3. thumb_statusが `done` でないページを処理対象にする
4. zipから対象画像を読み出す
5. 画像を300px四方に収まるよう縮小する
6. webp形式で保存する
7. 保存先は `thumbnail/<sha256>/<page_no>.webp`
8. 成功時は thumb_status を `done` にする
9. 失敗時は thumb_status を `error` にする
10. 全ページ処理後にジョブを完了状態にする

---

## サムネイルサイズ

- 最大幅: 300px
- 最大高さ: 300px
- アスペクト比は維持する
- 余白追加はしない

---

## サムネイル形式

- webp固定

---

## サムネイル生成失敗時

- 該当ページの thumb_status を `error` にする
- ページ自体は存在扱いにする
- UIではエラー画像を表示する
- ジョブ全体は継続する

---

# ジョブ状態

## status

- `queued`
- `running`
- `done`
- `error`

---

## progress

- 0〜100の整数
- 処理対象件数に対する完了件数で算出する

---

## message

- 現在処理中の内容を短い文字列で保存する
- UIの進捗表示に使用する

例:

- `Scanning library directory`
- `Hashing file: sample.zip`
- `Generating thumbnails: 12/200`
- `Completed`

---

# アプリ起動時のジョブ復旧

## 方針

- 前回起動中に中断されたジョブを安全に扱う

## 処理

- `running` 状態のジョブは起動時に `error` に変更する
- message に `Interrupted by application shutdown` を保存する
- `queued` 状態の thumbnail_generate ジョブは再開対象にする
- `queued` 状態の refresh ジョブは削除またはerror扱いにする

---

# ジョブキュー実行ルール

## 同時実行数

- 1

## 優先順位

1. refresh
2. thumbnail_generate

## 実行順

- queued状態のジョブを作成日時順で取得する
- refreshジョブを優先する
- thumbnail_generateは1ライブラリ単位で実行する

---

# 閲覧中の挙動

## サムネイル生成中

- トップページとビューアは利用可能
- 未生成サムネイルはプレースホルダー表示
- 生成済みになったサムネイルは再取得時に表示される

## refresh中

- 既存ライブラリの閲覧は可能
- refresh完了後に一覧を再取得する
- refresh中の新規zipは完了まで一覧に出ない

---

# ジョブ設計の決定事項

- MVPではNode.jsプロセス内キューを使う
- Redisなど外部キューは使わない
- 同時実行数は1
- refreshジョブの多重起動は禁止
- thumbnail_generateは1ライブラリ単位で作成する
- サムネイル生成失敗はページ単位で扱い、ジョブ全体は継続する
- running状態のジョブはアプリ起動時にerrorへ変更する
- queued状態のthumbnail_generateジョブはアプリ起動後に再開する
