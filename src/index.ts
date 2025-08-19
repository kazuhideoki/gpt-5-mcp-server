// gpt5-mcp-server.ts
// Node >= 18 推奨。TypeScript (ESM) で動作します。

import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";
import OpenAI from "openai";
import { requestArgs, requestSchema, openaiModelsInputSchema } from "./schemas.js";
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
// スキーマは src/schemas.ts に分離

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

  // --- tools の文字列→オブジェクト正規化 + 表記ゆれ吸収 ---
  const normalizeTool = (t: any) => {
    if (typeof t === "string") {
      const key = t.trim().toLowerCase();
      if (key === "web_search" || key === "web_search_preview") return { type: "web_search_preview" };
      if (key === "file_search") return { type: "file_search" };
      return { type: key };
    }
    if (t && typeof t === "object" && t.type === "web_search") {
      // ドキュメント表記ゆれ対策
      return { ...t, type: "web_search_preview" };
    }
    return t;
  };

  if (Array.isArray((body as any).tools)) {
    (body as any).tools = (body as any).tools.map(normalizeTool);
  } else if ((body as any).tools == null) {
    // デフォルトで Web 検索を 1 つ付ける
    (body as any).tools = [{ type: "web_search_preview" }];
  }

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

  // ---- verbosity（上位互換）→ text.verbosity へ移行 ----
  const moveVerbosityToText = () => {
    const v = (body as any).verbosity;
    if (!v) return;
    delete (body as any).verbosity;
    const text = (body as any).text && typeof (body as any).text === "object" ? (body as any).text : {};
    (body as any).text = { ...text, verbosity: v };
  };
  moveVerbosityToText();

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
      // モデル×ツール非対応の簡易警告（-mini / -nano × web_search_preview）
      try {
        const modelId = String((body as any).model ?? "");
        const tools = Array.isArray((body as any).tools) ? (body as any).tools : [];
        const hasWebSearch = tools.some((t: any) => t && typeof t === "object" && t.type === "web_search_preview");
        if (hasWebSearch && /-(mini|nano)\b/.test(modelId)) {
          console.error(
            `[gpt5-mcp] Warning: Model '${modelId}' may not support web_search_preview. Consider 'gpt-5' or 'gpt-5-chat-latest', or set tool_choice:"none".`,
          );
        }
      } catch {}

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
      // 可能な限り詳細を返す
      const anyErr = err as any;
      const message = anyErr?.message ?? String(err);
      const status = anyErr?.status ?? anyErr?.response?.status;
      const code = anyErr?.code ?? anyErr?.response?.data?.error?.code;
      const param = anyErr?.param ?? anyErr?.response?.data?.error?.param;
      const details = anyErr?.response?.data
        ? `\nDetails: ${JSON.stringify(anyErr.response.data, null, 2)}`
        : "";
      const composed = [
        "Error:",
        message,
        status ? `(status ${status})` : "",
        code ? `(code ${code})` : "",
        param ? `(param ${param})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      try {
        console.error(
          "[gpt5-mcp] request failed with body =",
          JSON.stringify(normalizeRequest(args), null, 2),
        );
      } catch {}
      return {
        content: [{ type: "text", text: `${composed}${details}` }],
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
    inputSchema: openaiModelsInputSchema,
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
