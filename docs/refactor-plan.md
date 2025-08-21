# index.ts リファクタリング提案（MVP を維持）

## 概要
- 型安全・責務分離・エラー整形・ログ指針を中心に、MVPの挙動を維持しつつ堅牢化。
- 入力検証の安全化、レスポンス抽出の一元化、キー管理/起動フローの明確化を提案。
- 変更は段階導入でき、公開I/F（MCPツール仕様）は不変。

## 主な改善ポイント
- 型安全強化: zod推論とOpenAI SDK型の活用。
- 入力検証: `safeParse` による人間可読なエラー返却。
- レスポンス抽出: 純粋関数で一元化。
- Web検索制約: model/effortに応じた事前抑制。
- エラー整形: 共通フォーマッタ関数で標準化。
- キー管理: 起動時/実行時の明確なフィードバック。
- ロギング: プレフィックス統一とDEBUG切替、PII配慮。
- 構成定数化: 既定モデル/ツール/制約の集中管理。
- I/O分離: env・request・response・error・handlerを分割。
- 起動/終了: 例外ログとSIGINT/SIGTERM対応。

## 提案詳細

### 1) 型安全の強化（zod推論 + OpenAI型の自動導出）
- 変更内容:
  - zodの推論を使い、不要な `as` キャストを排除。
  - `openai.responses.create` の引数・戻り値型を関数型から導出して利用。
- 理由: 推論ベースで変更に強く、コンパイル時に不整合を検知できるため。
- 影響範囲: buildRequest/レスポンス抽出/ハンドラ内の `any` を削減。
- 注意点: OpenAI SDKの型名に依存しないよう `Parameters`/`ReturnType` を使う。
- コード例:
  ```ts
  import type { z } from "zod";
  type Request = z.infer<typeof requestSchema>;
  type ResponsesCreateParams = Parameters<typeof openai.responses.create>[0];
  type ResponsesCreateResult = Awaited<ReturnType<typeof openai.responses.create>>;
  ```

### 2) 入力バリデーションの `safeParse` 化
- 変更内容:
  - `buildRequest` で `parse` → `safeParse` にし、失敗時は人間可読な短いメッセージを返却（公開I/Fは維持、ツール返却本文で通知）。
- 理由: 入力不備が例外に埋もれるのを防ぎ、原因把握を容易にする。
- 影響範囲: `buildRequest`/ツールハンドラの `try/catch` 内ロジック。
- 注意点: MCPの `inputSchema` で事前検証される前提でも冗長なく軽量。
- 差分例:
  ```ts
  function buildRequest(args: unknown): ResponsesCreateParams | { errorText: string } {
    const parsed = requestSchema.safeParse(args);
    if (!parsed.success) {
      const msg = parsed.error.errors
        .map(e => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return { errorText: `Invalid arguments: ${msg}` };
    }
    const { model, input, reasoning_effort, web_search } = parsed.data as Request;
    // 以降は現行ロジック
  }
  ```

### 3) Web検索の使用制約を事前適用
- 変更内容:
  - `reasoning_effort === "minimal"` または `model ∈ {gpt-5-mini, gpt-5-nano}` の際は `tools` を付与しない。必要時はログで通知。
- 理由: API側の拒否前に意図どおりの挙動とし、試行錯誤の無駄を削減。
- 影響範囲: `buildRequest`（公開I/F不変）。
- 注意点: 出力メッセージ本文には混ぜず、サーバログのみ。
- コード例:
  ```ts
  const DEFAULT_MODEL = "gpt-5";
  const SEARCH_TOOL = { type: "web_search_preview" } as const;
  const DISALLOW_SEARCH_MODELS = new Set(["gpt-5-mini", "gpt-5-nano"]);
  const modelEffortDisallows = reasoning_effort === "minimal" || DISALLOW_SEARCH_MODELS.has(model);
  const useWeb = (web_search ?? true) && !modelEffortDisallows;
  if (!useWeb && (web_search ?? true)) console.error("[gpt5-mcp] web_search disabled by model/effort constraint.");
  if (useWeb) body.tools = [SEARCH_TOOL];
  ```

### 4) レスポンス→テキスト抽出の一元化
- 変更内容:
  - `extractText(resp: ResponsesCreateResult): string` を定義し、ハンドラはこれを利用。
- 理由: ネスト分岐と `any` を排し、テスト可能で仕様差分に強い関数に。
- 影響範囲: ハンドラ内の出力整形。
- 注意点: 将来のAPI変更に備え `JSON.stringify` フォールバックを維持。
- コード例:
  ```ts
  function extractText(resp: ResponsesCreateResult): string {
    if (typeof (resp as any).output_text === "string") return (resp as any).output_text;
    const out = (resp as any).output;
    if (Array.isArray(out)) {
      return out
        .map(o => Array.isArray(o?.content)
          ? o.content
              .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
              .filter(Boolean)
              .join("\n")
          : "")
        .filter(Boolean)
        .join("\n");
    }
    return JSON.stringify(resp, null, 2);
  }
  ```

### 5) エラーハンドリングの共通化
- 変更内容:
- `formatOpenAIError(err: unknown): string` を作り、`status/code/param/Details` を組み立てる処理を分離。
- 理由: 可読性と再利用性の向上、再評価による二次例外を防止。
- 影響範囲: `catch` 節。
- 注意点: PII/キーは出力しない。詳細を全量ではなく丸める選択肢も検討。
- コード例:
  ```ts
  function formatOpenAIError(err: unknown): string {
    const e = err as any;
    const message = e?.message ?? String(err);
    const status = e?.status ?? e?.response?.status;
    const code = e?.code ?? e?.response?.data?.error?.code;
    const param = e?.param ?? e?.response?.data?.error?.param;
    const details = e?.response?.data
      ? `\nDetails: ${JSON.stringify(e.response.data, null, 2)}`
      : "";
    return [
      "Error:",
      message,
      status && `(status ${status})`,
      code && `(code ${code})`,
      param && `(param ${param})`,
    ].filter(Boolean).join(" ") + details;
  }
  ```

### 6) OpenAIキー管理の明確化
- 変更内容:
  - 起動時: キー未検出なら警告ログを出しつつ起動継続（現状踏襲）。
  - 実行時: キー未設定なら即座にユーザ向けの明快なエラーを返却。
- 理由: 失敗原因の早期発見とリトライ容易化。
- 影響範囲: ツールハンドラ先頭にガード追加。
- 差分例:
  ```ts
  if (!OPENAI_API_KEY) {
    return {
      content: [{ type: "text", text: "OPENAI_API_KEY not found. Please set it in environment or .env." }],
      isError: true,
    };
  }
  ```

### 7) ロギングの改善
- 変更内容:
  - ログプレフィックス統一、`DEBUG` 環境変数で冗長ログ切り替え、API応答の一部のみ出力。
  - エラー時は構築済みの `body` を `JSON.stringify` して出す（キー/PIIを含まないよう注意）。
- 理由: 運用しやすさ・機密情報の混入防止。
- 影響範囲: `console.error` 箇所。

### 8) 関数分割によるI/O分離とテスト容易性
- 変更内容:
  - env: `loadOpenAIKey`
  - request: `buildRequest`
  - response: `extractText`
  - error: `formatOpenAIError`
  - handler: gpt5 tool resolver（上記関数のオーケストレーション）
- 理由: 純粋関数の単体テストが容易になり、将来の拡張（ツール追加）にも流用可能。

### 9) 構成値の定数化
- 変更内容: `DEFAULT_MODEL`, `SEARCH_TOOL`, `DISALLOW_SEARCH_MODELS` を定義し集中管理。

### 10) 起動/終了フローの健全化
- 変更内容:
  - `server.connect(transport)` の例外ログ、`SIGINT/SIGTERM` で優雅に終了。
- コード例:
  ```ts
  try {
    await server.connect(transport);
  } catch (e) {
    console.error("[gpt5-mcp] failed to start:", e);
    process.exit(1);
  }
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => process.exit(0));
  }
  ```

## 追加の品質向上
- エラー種別に応じたヒント（429/5xx 等）。
- 環境変数でデフォルトモデルや検索有効化の上書き可（既定は現状維持）。
- 純粋関数（build/extract/format）のユニットテスト追加。

## 段階的導入計画
1. 型導入と関数抽出（`extractText`, `formatOpenAIError`）— 挙動不変。
2. `buildRequest` を `safeParse` 化、構成値の定数化。
3. Web検索制約の事前適用とログ追加。
4. キーガード/ロギング/起動・終了フロー強化。
5. 純粋関数のユニットテスト整備。

