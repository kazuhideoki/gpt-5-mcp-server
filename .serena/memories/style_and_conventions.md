# コードスタイル / 規約

- モジュール: ESM (`import`/`export`)、拡張子は `.mjs`
- 命名: camelCase（関数/変数）、UPPER_SNAKE_CASE（環境変数）
- 型: JavaScript + Zod による実行時バリデーション
- 例外処理: `try/catch` でツール呼び出しを保護し、`isError` とメッセージを返却
- コメント: 日本語コメントで要点を説明
- 環境変数の扱い: `.env` を許容するが、秘密はコミットしない
- Lint/Format: 現状設定なし（必要なら ESLint/Prettier を追加検討）
