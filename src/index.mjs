// gpt5-mcp-server.mjs
// Node >= 18 推奨。ESM (mjs) でそのまま動きます。

import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/** .env があれば .env の OPENAI_API_KEY を優先し、無ければ環境変数を使う */
function loadOpenAIKey() {
  const envPath = path.resolve(process.cwd(), ".env");
  let source = "env";
  let key = process.env.OPENAI_API_KEY;

  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    if (parsed.OPENAI_API_KEY && parsed.OPENAI_API_KEY.trim() !== "") {
      key = parsed.OPENAI_API_KEY.trim();
      source = ".env";
    }
  }
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY が見つかりません。`.env` か環境変数に OPENAI_API_KEY を設定してください。",
    );
  }
  // OpenAI SDK が参照できるように明示的に反映
  process.env.OPENAI_API_KEY = key;
  return { key, source };
}

const { key: OPENAI_API_KEY, source: keySource } = loadOpenAIKey();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===== MCP Server =====
const server = new McpServer({
  name: "gpt5-mcp",
  version: "1.0.0",
});

// ---- 入力スキーマ ----
// できる限り GPT-5/Responses API の項目をカバーしつつ、未知の拡張は extra で受け取ってそのままパススルー。
const requestSchema = z
  .object({
    // 基本
    model: z
      .string()
      .describe("利用するモデル。既定は gpt-5。")
      .default("gpt-5"),

    // 入力の与え方（いずれか必須）
    input: z
      .any()
      .optional()
      .describe("Responses API の input。文字列/メッセージ配列/複合入力など"),
    messages: z
      .any()
      .optional()
      .describe("chat 互換の messages。与えた場合は input として転送"),
    prompt: z
      .string()
      .optional()
      .describe("簡易入力。与えた場合は input として転送"),
    instructions: z
      .union([z.string(), z.array(z.any()), z.record(z.any())])
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
    tools: z.array(z.any()).optional(),
    tool_choice: z.any().optional(),
    parallel_tool_calls: z.boolean().optional(),
    response_format: z.any().optional(), // JSON/Structured Outputs など

    // ログ/再現性
    logprobs: z.boolean().optional(),
    top_logprobs: z.number().int().optional(),
    seed: z.number().optional(),
    user: z.string().optional(),
    metadata: z.record(z.any()).optional(),

    // ストリーミングは MCP 的に非対応（ここでは false に強制）
    stream: z.boolean().optional(),

    // 何でも追加したいとき用
    extra: z.record(z.any()).optional(),
  })
  .passthrough();

function normalizeRequest(args) {
  const parsed = requestSchema.parse(args);

  const {
    model,
    input,
    messages,
    prompt,
    max_tokens,
    reasoning_effort,
    extra,
    stream, // MCP ではストリームしない
    ...rest
  } = parsed;

  const body = { model: model ?? "gpt-5", ...rest };

  // 入力の統一
  if (input !== undefined) {
    body.input = input;
  } else if (messages !== undefined) {
    // Responses API は message 配列も input として受け付けます
    body.input = messages;
  } else if (prompt !== undefined) {
    body.input = prompt;
  } else {
    throw new Error("input / messages / prompt のいずれかを指定してください。");
  }

  // 互換エイリアス
  if (body.max_output_tokens == null && typeof max_tokens === "number") {
    body.max_output_tokens = max_tokens;
  }
  if (!body.reasoning && reasoning_effort) {
    body.reasoning = { effort: reasoning_effort };
  }

  // 明示的にストリーミング無効化（MCP ツール結果は一括返却）
  if (stream) body.stream = false;

  // 任意拡張のパススルー
  if (extra && typeof extra === "object") Object.assign(body, extra);

  return body;
}

// ---- GPT-5 呼び出しツール（Responses API パススルー）----
server.registerTool(
  "gpt5",
  {
    title: "OpenAI GPT-5 (Responses API)",
    description:
      "GPT-5 へのフルパラメータ・パススルー呼び出し。input/messages/prompt いずれかで入力を渡せます。" +
      "verbosity / reasoning(effort) / response_format / tools 等にも対応。",
    inputSchema: requestSchema,
  },
  async (args) => {
    try {
      const body = normalizeRequest(args);
      const resp = await openai.responses.create(body); // Responses API
      // 可能ならテキストを取り出す。無ければ JSON を文字列化。
      let text = "";
      if (typeof resp.output_text === "string") {
        text = resp.output_text;
      } else if (resp?.output && Array.isArray(resp.output)) {
        text = resp.output
          .map((o) =>
            Array.isArray(o.content)
              ? o.content
                  .map((c) =>
                    "text" in c && typeof c.text === "string" ? c.text : "",
                  )
                  .filter(Boolean)
                  .join("\n")
              : "",
          )
          .filter(Boolean)
          .join("\n");
      } else {
        text = JSON.stringify(resp, null, 2);
      }
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? err.message
          : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// ---- おまけ：利用可能な gpt-5* モデルを列挙するツール ----
server.registerTool(
  "openai_models",
  {
    title: "OpenAI models list (gpt-5*)",
    description: "OpenAI の gpt-5 系モデル ID を列挙します。",
    inputSchema: z.object({
      prefix: z.string().default("gpt-5"),
    }),
  },
  async ({ prefix }) => {
    try {
      const list = await openai.models.list();
      const ids =
        list?.data
          ?.filter((m) => typeof m.id === "string" && m.id.startsWith(prefix))
          .map((m) => m.id) ?? [];
      return {
        content: [
          { type: "text", text: ids.join("\n") || "(見つかりませんでした)" },
        ],
      };
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? err.message
          : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// ---- 起動（stdio）----
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[gpt5-mcp] started (OPENAI_API_KEY source: ${keySource}).`);
