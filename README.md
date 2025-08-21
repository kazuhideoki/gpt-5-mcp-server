# gpt-5-mcp-server (最小MVP)

OpenAI Responses API への極薄い MCP サーバーです。指定できるのは下記のみです。

- model: 実行するモデルID（許可: `gpt-5` / `gpt-5-mini` / `gpt-5-nano`。既定: `gpt-5`）
- input: 単一のテキスト入力（必須）
- reasoning_effort: `minimal | low | medium | high`（任意）
- web_search: `true | false`（任意、既定: `true`）
  - 備考: `web_search` を有効にすると Responses API の `web_search_preview` ツールが付与されます。
  - 制約: `reasoning_effort` が `minimal` の場合は `web_search` は利用不可（`false` を指定、または effort を `low` 以上に）

その他のパラメータは受け付けません（未知のキーはエラー）。

## セットアップ

1. `OPENAI_API_KEY` を環境変数、もしくは `.env` に設定します。

```
OPENAI_API_KEY=sk-...
```

2. ビルド・起動

```
npm install
npm run start
```

標準入出力（stdio）で MCP として待ち受けます。MCP クライアント側でコマンドとしてこのサーバーを起動する設定を行ってください。

## MCP クライアント連携例（.mcp.json）

以下は MCP クライアント（例: Claude Desktop など）で本サーバーを登録する `.mcp.json` の例です。`OPENAI_API_KEY` はご自身のキーに置き換えてください。既存の設定がある場合は `mcpServers` 配下に追記してください。

```json
{
  "mcpServers": {
    "gpt": {
      "command": "bun",
      "args": [
        "/Users/username/gpt-5-mcp-server/src/index.ts"
      ],
      "env": {
        "OPENAI_API_KEY": "sk-xxxx"
      }
    }
  }
}
```

### npx 版（ビルド不要・tsx 推奨）

ビルド不要で TypeScript/ESM を直接起動したい場合は `npx tsx` が高速・安定です。

```json
{
  "mcpServers": {
    "gpt": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "/Users/username/gpt-5-mcp-server/src/index.ts"
      ],
      "env": {
        "OPENAI_API_KEY": "sk-xxxx"
      }
    }
  }
}
```
