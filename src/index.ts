// gpt5-mcp-server.ts
// Node >= 18 推奨。TypeScript (ESM) で動作します。

import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";
import OpenAI from "openai";
import { requestArgs, requestSchema } from "./schemas.js";
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

function buildRequest(args: unknown): Record<string, unknown> {
  const parsed = requestSchema.parse(args);
  const { model, input, reasoning_effort, web_search } = parsed as {
    model: string;
    input: string;
    reasoning_effort?: "minimal" | "low" | "medium" | "high";
    web_search?: boolean;
  };

  const body: Record<string, unknown> = {
    model: model ?? "gpt-5",
    input,
  };
  const useWeb = web_search ?? true;
  if (useWeb) body.tools = [{ type: "web_search_preview" }];
  if (reasoning_effort) body.reasoning = { effort: reasoning_effort };

  return body;
}

// ---- GPT-5 呼び出しツール（Responses API パススルー）----
server.registerTool(
  "gpt5",
  {
    title: "OpenAI GPT-5 (最小MVP)",
    description:
      'モデル/推論強度/ウェブ検索フラグのみ指定可能な最小ブリッジ。web_search は既定でオン。reasoning_effort="minimal" のとき、または gpt-5-mini / gpt-5-nano のときは web_search を使えません。',
    inputSchema: requestArgs,
  },
  async (args: unknown) => {
    try {
      const body = buildRequest(args);

      const resp: any = await openai.responses.create(body);
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
          JSON.stringify(buildRequest(args), null, 2),
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
// 追加ツールは提供しない（MVP）

// ---- 起動（stdio）----
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[gpt5-mcp] started (OPENAI_API_KEY source: ${keySource}).`);
