// gpt5-mcp-server.ts
// Node >= 18 推奨。TypeScript (ESM) で動作します。

import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";

/** .env があれば .env の OPENAI_API_KEY を優先し、無ければ環境変数を使う */
// 先頭の import 群に追加

function loadOpenAIKey(): { key: string | null; source: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(here, ".env"), // src 配下に置く場合
    path.resolve(here, "..", ".env"), // ルートに置く場合（src/..）
  ];

  // 既に環境変数があればそれを初期値に
  let key = process.env.OPENAI_API_KEY;
  let source: string = key ? "env" : "";

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const parsed = dotenv.parse(fs.readFileSync(p));
      if (parsed.OPENAI_API_KEY && parsed.OPENAI_API_KEY.trim() !== "") {
        key = parsed.OPENAI_API_KEY.trim();
        source = `.env:${p}`;
        break;
      }
    }
  }

  if (!key) {
    // ここでは throw せず、呼び出し側で扱う（B とセット）
    return { key: null, source: "not-found" };
  }
  process.env.OPENAI_API_KEY = key;
  return { key, source };
}

const { key: OPENAI_API_KEY, source: keySource } = loadOpenAIKey();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY ?? undefined });

// ===== MCP Server =====
const server = new McpServer({
  name: "gpt5-mcp",
  version: "1.0.0",
});

// ---- 入力スキーマ ----
// できる限り GPT-5/Responses API の項目をカバーしつつ、未知の拡張は extra で受け取ってそのままパススルー。
// registerTool への引数は ZodRawShape（素のオブジェクト）を渡す必要があるため、shape を分離
const requestArgs: Record<string, z.ZodTypeAny> = {
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
  // OpenAI Responses API の tools 仕様に合わせて union を定義
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
// 既存の正規化処理（normalizeRequest）用に Zod オブジェクトを併存
const requestSchema = z.object(requestArgs).passthrough();

function normalizeRequest(args: unknown): Record<string, unknown> {
  const parsed = requestSchema.parse(args);

  const {
    model,
    input,
    messages,
    prompt,
    max_tokens,
    reasoning_effort,
    response_format, // Chat/Responses API 旧パラメータ（互換のため受け取り）
    extra,
    stream, // MCP ではストリーミングしない
    ...rest
  } = parsed;

  // 旧 response_format は REST に展開せず（APIで400になるため）、必要に応じて text.format に変換する
  const { response_format: _omitRF, ...restWithoutRF } = rest as Record<
    string,
    unknown
  >;

  const body: Record<string, unknown> = {
    model: model ?? "gpt-5",
    ...restWithoutRF,
  };

  // 入力の統一
  if (input !== undefined) {
    body.input = input;
  } else if (Array.isArray(messages) && messages.length > 0) {
    // Responses API は message 配列も input として受け付けます（空配列は無視）
    body.input = messages;
  } else if (prompt !== undefined) {
    body.input = prompt;
  } else if (messages !== undefined && Array.isArray(messages) && messages.length === 0) {
    // messages が空配列かつ prompt も無い場合はエラー
    throw new Error("messages が空です。prompt か input を指定してください。");
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

  // response_format -> text.format への移行対応
  // 代表的なケースのみサポート：json / json_object は text.format = "json" に変換
  if (response_format !== undefined) {
    try {
      const rf: any = response_format;
      const currentText =
        (body as any).text && typeof (body as any).text === "object"
          ? (body as any).text
          : {};
      const setTextFormat = (fmt: "json" | "plain") => {
        (body as any).text = { ...currentText, format: fmt };
      };

      if (typeof rf === "string") {
        if (rf === "json") setTextFormat("json");
      } else if (rf && typeof rf === "object") {
        const t = rf.type ?? rf.format; // 旧: { type: "json_object" } / 一部: { format: "json" }
        if (t === "json" || t === "json_object") {
          setTextFormat("json");
        } else if (t === "json_schema") {
          // 新APIでは text.format にスキーマ指定が存在しないため、互換として json を指定
          // 参照用に元値は body.response_format_original に残す（サーバ側で無視されても安全）
          setTextFormat("json");
          (body as any).response_format_original = rf;
        }
      }
    } catch {
      // フォールバック：変換に失敗しても本体処理は継続
    }
  }

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
    inputSchema: requestArgs,
  },
  async (args: unknown) => {
    try {
      const body = normalizeRequest(args);
      const resp: any = await openai.responses.create(body as any); // Responses API
      // 可能ならテキストを取り出す。無ければ JSON を文字列化。
      let text = "";
      if (typeof resp.output_text === "string") {
        text = resp.output_text;
      } else if (resp?.output && Array.isArray(resp.output)) {
        text = resp.output
          .map((o: any) =>
            Array.isArray(o.content)
              ? o.content
                  .map((c: any) =>
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
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
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
    inputSchema: {
      prefix: z.string().default("gpt-5"),
    },
  },
  async ({ prefix }: { prefix: string }) => {
    try {
      const list = await openai.models.list();
      const ids =
        list?.data
          ?.filter((m) => typeof m.id === "string" && m.id.startsWith(prefix))
          .map((m) => m.id) ?? [];
      return {
        content: [
          { type: "text", text: ids.join(", ") || "(見つかりませんでした)" },
        ],
      };
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
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
