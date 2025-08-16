import { z } from "zod";

// requestArgs: ZodRawShape for the GPT-5 Responses API passthrough
export const requestArgs: Record<string, z.ZodTypeAny> = {
  // 基本
  model: z.string().describe("利用するモデル。既定は gpt-5。").default("gpt-5"),

  // 入力の与え方（いずれか必須）
  input: z
    .union([
      z.string(),
      z.array(z.union([z.string(), z.object({}).passthrough()])),
      z.object({}).passthrough(),
    ])
    .optional()
    .describe("Responses API の input。文字列/配列/オブジェクトを許可"),
  messages: z
    .array(z.object({}).passthrough())
    .optional()
    .describe("chat 互換の messages。与えた場合は input として転送"),
  prompt: z
    .string()
    .optional()
    .describe("簡易入力。与えた場合は input として転送"),
  instructions: z
    .union([
      z.string(),
      z.array(z.string()),
      z.object({}).passthrough(),
      z.array(z.object({}).passthrough()),
    ])
    .optional()
    .describe("開発者/システム指示"),

  // サンプリング・長さ
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  max_tokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("互換用。max_output_tokens に写像"),

  stop: z.union([z.string(), z.array(z.string())]).optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),

  // GPT‑5 新パラメータ
  verbosity: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe("出力の長さヒント"),
  reasoning: z
    .object({
      effort: z.enum(["minimal", "low", "medium", "high"]).optional(),
    })
    .optional()
    .describe("推論深度設定（o1系と同様の表現）"),
  reasoning_effort: z
    .enum(["minimal", "low", "medium", "high"])
    .optional()
    .describe("互換用。reasoning.effort に写像"),

  // ツール呼び出し・構造化出力
  tools: z
    .array(
      z.union([
        // Function calling（ルートに name/parameters を置く公式形）
        z
          .object({
            type: z.literal("function"),
            name: z.string(),
            description: z.string().optional(),
            parameters: z.object({}).passthrough().optional(),
            strict: z.boolean().optional(),
          })
          .passthrough(),

        // Web search（プレビュー）
        z.object({ type: z.literal("web_search_preview") }).passthrough(),

        // File search（最小構成）
        z
          .object({
            type: z.literal("file_search"),
            vector_store_ids: z.array(z.string()).optional(),
          })
          .passthrough(),

        // Remote MCP（require_approval を含む）
        z
          .object({
            type: z.literal("mcp"),
            server_label: z.string(),
            server_url: z.string(),
            require_approval: z
              .enum(["never", "auto", "manual"]) // 互換のため緩めに許容
              .optional(),
          })
          .passthrough(),
      ]),
    )
    .optional()
    .default([{ type: "web_search_preview" }]),
  tool_choice: z
    .union([z.enum(["none", "auto"]), z.object({}).passthrough()])
    .optional(),
  parallel_tool_calls: z.boolean().optional(),
  response_format: z.object({}).passthrough().optional(), // JSON/Structured Outputs など

  // ログ/再現性
  logprobs: z.boolean().optional(),
  top_logprobs: z.number().int().optional(),
  seed: z.number().optional(),
  user: z.string().optional(),
  metadata: z.object({}).passthrough().optional(),

  // ストリーミングは MCP 的に非対応（ここでは false に強制）
  stream: z.boolean().optional(),

  // 何でも追加したいとき用
  extra: z.object({}).passthrough().optional(),
};

// Zod object for parsing/normalization in code
export const requestSchema = z.object(requestArgs).passthrough();

// Small schema for the openai_models tool
export const openaiModelsInputSchema = {
  prefix: z.string().default("gpt-5"),
} as const;

