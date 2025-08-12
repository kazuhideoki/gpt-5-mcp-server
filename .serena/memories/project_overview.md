# プロジェクト概要

- 名称: gpt-5-mcp-server
- 目的: OpenAI Responses API (GPT-5系) を MCP サーバーとして公開し、MCP クライアントから `gpt5` ツールでフルパラメータ呼び出しや、`openai_models` でモデル一覧取得を可能にする。
- ターゲット環境: Node.js 18+ / ESM (`.mjs`)
- 主要依存: `@modelcontextprotocol/sdk`, `openai`, `zod`, `dotenv`
- エントリポイント: `src/index.mjs`
- 重要設定:
  - 環境変数 `OPENAI_API_KEY`（`.env` または環境変数）。`src/index.mjs` の `loadOpenAIKey()` が `.env`/環境変数から読み込み。
  - `.mcp.json` に MCP サーバー設定あり（`serena`, `gpt`）。秘密情報はコミットしないこと。

## 構成 (ルート)
- `src/index.mjs`: MCP サーバー本体（`gpt5`/`openai_models` ツール定義、stdio で起動）
- `package.json`: スクリプトと依存
- `.mcp.json`: MCP クライアント向けサーバー登録例
- `.env`/`.env.example`: API キーの配置例
- `.serena/`: Serena 設定（`project.yml`）

## 実装ハイライト
- Zod でツール入力をスキーマ化、`normalizeRequest()` で Responses API 互換に正規化
- `openai.responses.create(body)` を呼び出し、`output_text` もしくは `output` からテキストを抽出
- `StdioServerTransport` で MCP プロトコル接続
