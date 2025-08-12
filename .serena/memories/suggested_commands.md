# よく使うコマンド

## セットアップ
- Node バージョン確認: `node -v`
- 依存インストール: `npm ci`（または `npm i`）

## 起動
- MCP サーバー起動: `npm start`（= `node src/index.mjs`）
- 直接起動（キー同時指定）: `OPENAI_API_KEY=YOUR_KEY node src/index.mjs`

## 動作確認（MCP クライアント側の例）
- `.mcp.json` の設定で `gpt` サーバーを登録している場合、MCP クライアントから `gpt5` ツールを呼び出し可能。
  - 例: `gpt5` に `{"input":"hello","model":"gpt-5"}` を渡す
- モデル一覧: `openai_models`（任意の `prefix` 指定可、既定は `gpt-5`）

## 補助
- 環境変数の確認: `printenv | grep OPENAI_API_KEY`
- .env ロード順: カレント/.src/ルートの `.env` を順に探索

## macOS ユーティリティ
- ファイル探索（浅め）: `find . -maxdepth 2 -type f | sort`
- 文字列検索: `grep -R "pattern" .`
