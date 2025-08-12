# 技術スタック

- ランタイム: Node.js >= 18（ESM）
- 言語: JavaScript (ES Modules, `.mjs`)
- プロトコル/SDK: Model Context Protocol (`@modelcontextprotocol/sdk`)
- API クライアント: `openai` (Responses API 利用)
- スキーマ: `zod`
- 設定/秘密情報: `dotenv` + 環境変数 `OPENAI_API_KEY`
- OS 前提: Darwin (macOS) での開発・動作
