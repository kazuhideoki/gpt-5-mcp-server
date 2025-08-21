# gpt-5-mcp-server (最小MVP)

OpenAI Responses API への極薄い MCP サーバーです。指定できるのは下記のみです。

- model: 実行するモデルID（許可: `gpt-5` / `gpt-5-mini` / `gpt-5-nano`。既定: `gpt-5`）
- input: 単一のテキスト入力（必須）
- reasoning_effort: `minimal | low | medium | high`（任意）

Web検索（`web_search_preview`）は既定で常時オンです。スキーマには含めません。その他のパラメータは受け付けません（未知のキーはエラー）。

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

## 提供ツール

- `gpt5`: 最小ブリッジ（上記3項目のみ）。Web検索は常時オン。

入力例（概念図）:

```
{
  "model": "gpt-5-mini",
  "input": "次の文章を要約してください",
  "reasoning_effort": "medium"
}
```

出力は Responses API の `output_text` を優先してテキストとして返却します。

## 互換・注意事項

- `messages` や `tools`、`max_tokens` などは受け付けません（エラー）。
- mini / nano 系モデルは `web_search_preview` に非対応の可能性があります（内部ログに注意喚起を出します）。
- 参考スクリプト: `scripts/openai_api.sh`（シェルから Responses API を叩く簡易例）。
