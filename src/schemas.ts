// src/schemas.ts
import { z } from "zod";

export const requestArgs = {
  model: z
    .enum(["gpt-5", "gpt-5-mini", "gpt-5-nano"])
    .describe(
      [
        "使用するモデル。未指定時は gpt-5。",
        "",
        "使い分けの目安:",
        "- gpt-5: 最高品質。複雑な推論/設計レビュー/高度なコード生成やバグ修正、エージェント実行に最適。精度重視で遅延とコストを許容できるときに。",
        "- gpt-5-mini: 高速・低コスト。よく定義されたタスク（短文要約、説明生成、テンプレ生成、チャットの一次応答、バッチ処理）に。",
        "- gpt-5-nano: 超低レイテンシ/軽量タスク向け。キーワード抽出、ルーティング、簡易分類、エッジ用途や大量同時実行に。",
        "",
        "ヒント: 不確実性が高い課題や根拠提示が必要な調査は gpt-5、応答の均質化や大量処理は gpt-5-mini/ nano を選択。",
      ].join("\n"),
    )
    .default("gpt-5"),

  input: z
    .string()
    .min(1, "input は必須です")
    .describe("単一のテキスト入力。Responses API の `input` に渡します。"),

  reasoning_effort: z
    .enum(["minimal", "low", "medium", "high"])
    .optional()
    .describe(
      [
        "推論強度（reasoning.effort）。思考トークン量に上限を設け、精度/コスト/レイテンシを調整します。既定: medium。",
        "",
        "使い分け:",
        "- minimal: 速度/コスト最優先。抽出・単純分類・短文の定型生成など“考えずに処理”できるタスク向け（web_search とは併用不可）。",
        "- low: 軽い段取りが必要な要約・言い換え・フォーム埋めの下書き、簡単な調べ物など",
        "- medium: 既定。数段階の推論が要る一般的な分析/コード改変/要件整理に。複数ソースにあたるべき調べ物など",
        "- high: 複雑な要件統合・長い思考過程が必要な設計検討/リサーチ統合/厳密なコード変換など。最大限に情報収集するときなど。",
        "",
        "指標: 納期がタイト/バッチ大量=下げる、正答性・一貫性が最重要=上げる。",
      ].join("\n"),
    )
    .default("medium"),

  web_search: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      [
        "Web 検索の有効/無効（既定: 有効）。Responses API では tools の web_search を利用します。",
        "",
        "有効にする場面:",
        "- 最新情報/相場/ニュース/仕様変更の影響を確認したいとき",
        "- 参考リンクや出典を伴う要約/比較を生成したいとき",
        "",
        "無効にする場面:",
        "- 入力だけで十分完結する（再現性や速度が重要）",
        "- 社内/非公開データのみを根拠にしたい、決定論的出力を守りたい",
        "",
        "制約（本スキーマの運用ルール）:",
        '- reasoning_effort が "minimal" の場合は使用不可（false を指定、または effort を low 以上に）。',
        "",
        "ヒント: 調査→要約の2段構えにする場合、まず web_search=true で情報収集、次に結果を input に貼り再度 web_search=false で整形すると高速・安定。",
      ].join("\n"),
    ),
} as const;

// 不明なキーはエラーにするため strict。
export const requestSchema = z
  .object(requestArgs)
  .strict()
  .superRefine((val, ctx) => {
    const effort = val.reasoning_effort;
    const ws = val.web_search ?? true;
    if (effort === "minimal" && ws) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["web_search"],
        message:
          'reasoning_effort が "minimal" の場合、web_search は利用できません（false にするか effort を low 以上にしてください）',
      });
    }
  });
