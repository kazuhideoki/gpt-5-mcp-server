// src/schemas.ts
import { z } from "zod";

// 最小MVPの入力フィールドのみを受け付ける
// - model: モデルID
// - input: 単一テキストプロンプト
// - reasoning_effort: 推論強度（reasoning.effort に変換）

export const requestArgs = {
  model: z
    .enum(["gpt-5", "gpt-5-mini", "gpt-5-nano"])
    .describe(
      "モデルID。許可: `gpt-5` | `gpt-5-mini` | `gpt-5-nano`。未指定時は `gpt-5`。",
    )
    .default("gpt-5"),

  input: z
    .string()
    .min(1, "input は必須です")
    .describe("単一のテキスト入力。Responses API の `input` に渡します。"),

  reasoning_effort: z
    .enum(["minimal", "low", "medium", "high"])
    .optional()
    .describe("推論強度（reasoning.effort）を指定します。")
    .default("medium"),
} as const;

// 不明なキーはエラーにするため strict
export const requestSchema = z.object(requestArgs).strict();
