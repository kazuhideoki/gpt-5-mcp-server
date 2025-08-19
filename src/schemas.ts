// src/schemas.ts
import { z } from "zod";

/**
 * Zod shapes for the GPT-5 Responses API passthrough.
 * Notes about server behavior (implementation detail of this MCP server):
 * - One of `input` | `messages` | `prompt` MUST be provided. The server normalizes as:
 *   priority = input > (non-empty) messages > prompt. Empty `messages` is an error.
 * - `max_tokens` is mapped to `max_output_tokens` and not sent to the OpenAI API.
 * - `stream` is always disabled by this server (responses are returned as a single MCP tool result).
 * - `response_format` is accepted for backward compatibility. When possible the server maps it to
 *   `text.format` (e.g., "json" / "json_object" → "json"). The original is preserved in
 *   `response_format_original` for inspection.
 */

// Request argument fields (top-level). Each field is passed through to the OpenAI Responses API
// unless otherwise stated in its description.
export const requestArgs: Record<string, z.ZodTypeAny> = {
  // ===== Core =====
  model: z
    .string()
    .describe(
      "Model identifier to execute (e.g., `gpt-5`, `gpt-5-mini`). Value is forwarded to the API as `model`.",
    )
    .default("gpt-5"),

  // ===== Input selection (one of these is required) =====
  input: z
    .union([
      z.string(),
      z.array(z.union([z.string(), z.object({}).passthrough()])),
      z.object({}).passthrough(),
    ])
    .optional()
    .describe(
      [
        "Primary request payload forwarded as `input` to the Responses API.",
        "Allowed shapes:",
        "- string: single text prompt",
        "- array: message/content parts array (objects are passed through verbatim)",
        "- object: structured input (e.g., multi-modal parts or `text` options)",
        "If provided, this server uses it verbatim as the API `input`.",
      ].join("\n"),
    ),

  messages: z
    .array(z.object({}).passthrough())
    .optional()
    .describe(
      [
        "Chat-style message array (objects are passed through verbatim).",
        "If present and non-empty, this server forwards it as the API `input`.",
        "If present and empty, the server raises an error.",
      ].join("\n"),
    ),

  prompt: z
    .string()
    .optional()
    .describe(
      "Simple text prompt. If `input` is not provided and `messages` is absent, the server forwards `prompt` as the API `input`.",
    ),

  instructions: z
    .union([
      z.string(),
      z.array(z.string()),
      z.object({}).passthrough(),
      z.array(z.object({}).passthrough()),
    ])
    .optional()
    .describe(
      [
        "High-level instructions forwarded as `instructions`.",
        "Accepts string, string[], object, or object[]. Objects are passed through verbatim.",
      ].join("\n"),
    ),

  // ===== Sampling & length =====
  temperature: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe(
      "Sampling temperature. Higher values increase randomness; lower values make outputs more deterministic.",
    ),

  top_p: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Nucleus sampling threshold. The model samples only from the smallest set of tokens whose cumulative probability exceeds this value.",
    ),

  max_output_tokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Hard upper bound on the number of tokens generated in the response. Generation stops when this limit is reached.",
    ),

  max_tokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Compatibility alias. This server maps `max_tokens` → `max_output_tokens` and does not forward `max_tokens` to the API.",
    ),

  stop: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      [
        "One or more stop strings. Generation halts when the first stop sequence is produced.",
        "Stop sequences themselves are omitted from the returned text.",
      ].join("\n"),
    ),

  frequency_penalty: z
    .number()
    .optional()
    .describe(
      "Penalizes tokens proportionally to their frequency in the generated text to reduce repetition. Effective only for models/endpoints that support it.",
    ),

  presence_penalty: z
    .number()
    .optional()
    .describe(
      "Penalizes tokens that have already appeared, biasing toward introducing new tokens. Effective only for models/endpoints that support it.",
    ),

  // ===== GPT-5 / Responses-specific extensions =====
  // 互換エイリアス（Deprecated）: top-level で指定された場合でもサーバ側で text.verbosity に移行します
  verbosity: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe(
      "DEPRECATED alias. The server will move this into `text.verbosity` for the Responses API.",
    ),

  reasoning: z
    .object({
      effort: z.enum(["minimal", "low", "medium", "high"]).optional(),
    })
    .optional()
    .describe(
      [
        "Reasoning configuration. `effort` controls the model’s internal reasoning budget.",
        "Higher values allow the model to allocate more tokens/time to reasoning, which may affect latency and token usage.",
      ].join("\n"),
    ),

  reasoning_effort: z
    .enum(["minimal", "low", "medium", "high"])
    .optional()
    .describe(
      "Compatibility alias for `reasoning.effort`. This server maps it into `reasoning.effort`.",
    ),

  // ===== Tools & structured output =====
  tools: z
    .array(
      z.union([
        // 文字列シンタックスも許容（例: "web_search_preview" / "web_search" / "file_search"）
        z
          .enum(["web_search", "web_search_preview", "file_search"])
          .describe(
            "Shorthand form. The server will normalize to the proper tool object.",
          ),
        // Custom function tool (JSON Schema parameters)
        z
          .object({
            type: z.literal("function"),
            name: z.string(),
            description: z
              .string()
              .optional()
              .describe(
                "Human-readable purpose of the function. Used by the model to decide when to call it.",
              ),
            parameters: z
              .object({})
              .passthrough()
              .optional()
              .describe(
                [
                  "JSON Schema for the function’s arguments.",
                  "Common keys: `type`, `properties`, `required`.",
                ].join("\n"),
              ),
            strict: z
              .boolean()
              .optional()
              .describe(
                "If true, the model is constrained to produce arguments that satisfy the provided schema more strictly.",
              ),
          })
          .passthrough()
          .describe(
            "Custom function tool. Enables the model to emit a tool call with JSON arguments conforming to the given schema.",
          ),

        // Built-in web search (preview)
        z
          .object({ type: z.literal("web_search_preview") })
          .passthrough()
          .describe(
            "Built-in web search tool (preview). When enabled, the model may issue web search calls in its response.",
          ),

        // Built-in file search (RAG)
        z
          .object({
            type: z.literal("file_search"),
            vector_store_ids: z
              .array(z.string())
              .optional()
              .describe(
                "IDs of vector stores to query against. If omitted, the provider default is used.",
              ),
          })
          .passthrough()
          .describe(
            "Built-in retrieval tool over previously uploaded files. The model may cite retrieved snippets in its response.",
          ),

        // Remote MCP tool
        z
          .object({
            type: z.literal("mcp"),
            server_label: z
              .string()
              .describe("Identifier label for the remote MCP server."),
            server_url: z
              .string()
              .describe("Endpoint URL of the remote MCP server."),
            require_approval: z
              .enum(["never", "auto", "manual"])
              .optional()
              .describe(
                [
                  "Approval mode before sending data to the remote MCP server.",
                  "- `manual`: user approval required per call",
                  "- `auto`: approval automatically granted per policy",
                  "- `never`: no approval required",
                ].join("\n"),
              ),
          })
          .passthrough()
          .describe(
            "Declares a remote MCP server as a tool. The model may call tools exposed by that server.",
          ),
      ]),
    )
    .optional()
    .default([{ type: "web_search_preview" }])
    .describe(
      [
        "Tool declarations available to the model. If omitted, this server provides `[ { type: 'web_search_preview' } ]` by default.",
        "Tool calls (if any) appear in the response; execution policy is influenced by `tool_choice`.",
      ].join("\n"),
    ),

  tool_choice: z
    .union([z.enum(["none", "auto"]), z.object({}).passthrough()])
    .optional()
    .describe(
      [
        "Controls tool usage:",
        "- `auto`: the model may call any declared tool",
        "- `none`: the model will not call tools",
        "Object form can force a specific tool call (e.g., `{ type: 'function', function: { name: 'get_weather' } }`).",
      ].join("\n"),
    ),

  parallel_tool_calls: z
    .boolean()
    .optional()
    .describe(
      "If true, the model may emit multiple tool calls in parallel in a single turn (subject to model and runtime support).",
    ),

  response_format: z
    .object({})
    .passthrough()
    .optional()
    .describe(
      [
        "Backward-compatibility container for structured-output directives.",
        "This server attempts to map common cases to `text.format`:",
        '- `"json"` or `{ type: "json" | "json_object" }` → `text.format = "json"`',
        '- `{ type: "json_schema", ... }` → `text.format = "json"`; original preserved as `response_format_original`',
      ].join("\n"),
    ),

  // ===== Logging / reproducibility =====
  logprobs: z
    .boolean()
    .optional()
    .describe(
      "Requests token-level log probabilities in the response content, if supported by the selected model and endpoint.",
    ),

  top_logprobs: z
    .number()
    .int()
    .optional()
    .describe(
      "When `logprobs` is true, specifies how many alternative tokens (per position) to include with their log probabilities.",
    ),

  seed: z
    .number()
    .optional()
    .describe(
      "Sampling seed. Using the same seed with identical parameters increases output reproducibility; determinism is not guaranteed.",
    ),

  user: z
    .string()
    .optional()
    .describe(
      "Opaque end-user identifier forwarded as `user` to the API for monitoring and abuse detection.",
    ),

  metadata: z
    .object({})
    .passthrough()
    .optional()
    .describe(
      "Arbitrary request metadata forwarded as `metadata`. Contents are not interpreted by this server.",
    ),

  // ===== Streaming =====
  stream: z
    .boolean()
    .optional()
    .describe(
      "Streaming flag accepted for compatibility. This server always disables streaming and returns a single aggregated result.",
    ),

  // ===== Passthrough for future/advanced fields =====
  extra: z
    .object({})
    .passthrough()
    .optional()
    .describe(
      [
        "Passthrough object merged into the request. Use to send fields not explicitly modeled here.",
        "Examples: `text: { format: 'json', verbosity: 'low' }`, `include: ['citations']`, `store: true`.",
      ].join("\n"),
    ),
};

// Object schema used by the server to parse and normalize inputs
export const requestSchema = z.object(requestArgs).passthrough();

// Small schema for the `openai_models` tool
export const openaiModelsInputSchema = {
  prefix: z
    .string()
    .default("gpt-5")
    .describe(
      "Prefix string to filter model IDs when listing (e.g., `gpt-5` lists models whose IDs start with `gpt-5`).",
    ),
} as const;
