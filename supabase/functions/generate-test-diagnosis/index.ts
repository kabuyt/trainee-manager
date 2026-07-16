import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
});

const sectionNames: Record<string, string> = {
  goii: "語彙",
  bunpo: "文法",
  chokkai: "聴解",
};

function stripHtml(value: unknown) {
  return String(value || "")
    .replace(/<ruby>(.*?)<rt>.*?<\/rt><\/ruby>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function selectedValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return (value as Record<string, unknown>).selected;
  }
  return value;
}

function normalize(value: unknown) {
  return String(value ?? "").trim().replace(/✕/g, "×");
}

function expectedValue(answerKey: Record<string, unknown>, blockId: string, fieldId: string) {
  const nested = answerKey?.[blockId];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const value = (nested as Record<string, unknown>)[fieldId];
    if (value !== undefined) return value;
  }
  return answerKey?.[fieldId];
}

function isCorrect(actual: unknown, expected: unknown) {
  if (actual && typeof actual === "object" && !Array.isArray(actual)) {
    const stored = (actual as Record<string, unknown>).correct;
    if (typeof stored === "boolean") return stored;
  }
  const values = Array.isArray(expected) ? expected : [expected];
  return values.some(value => normalize(selectedValue(actual)) === normalize(value));
}

function blockLabel(questions: Array<Record<string, unknown>>, blockId: string) {
  const block = questions.find(question => question?.id === blockId);
  const title = stripHtml(block?.title_html || block?.title || blockId)
    .replace(/^問題\s*\d+[．.、]?\s*/, "")
    .trim();
  return title || blockId;
}

function storedCorrectSummary(
  answers: Record<string, unknown>,
  sections: Array<Record<string, any>>,
) {
  const entries = Object.entries(answers).filter(([, value]) =>
    value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).correct === "boolean"
  );
  if (!entries.length) return null;

  const prefixBySection: Record<string, string> = { goii: "v", bunpo: "g", chokkai: "l" };
  const summaries = sections.map(section => {
    const prefix = prefixBySection[section.section_type];
    if (!prefix) return null;
    const groups: Record<string, Array<Record<string, unknown>>> = {};
    for (const [fieldId, rawValue] of entries) {
      const match = new RegExp(`^${prefix}(\\d+)`, "i").exec(fieldId);
      if (!match) continue;
      const groupId = `${prefix}${match[1]}`;
      if (!groups[groupId]) groups[groupId] = [];
      groups[groupId].push(rawValue as Record<string, unknown>);
    }
    const currentBlockIds = Object.keys(section.scoring_rules || {});
    const blocks = Object.keys(groups)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      .map((groupId, index) => {
        const values = groups[groupId];
        const correct = values.filter(value => value.correct === true).length;
        const blockId = currentBlockIds[index] || groupId;
        return {
          label: blockLabel(section.questions || [], blockId),
          correct,
          total: values.length,
          rate: values.length ? Math.round((correct / values.length) * 100) : 0,
        };
      });
    const correct = blocks.reduce((sum, block) => sum + block.correct, 0);
    const total = blocks.reduce((sum, block) => sum + block.total, 0);
    return { sectionType: section.section_type, correct, total, blocks };
  }).filter(Boolean) as Array<{
    sectionType: string;
    correct: number;
    total: number;
    blocks: Array<{ label: string; correct: number; total: number; rate: number }>;
  }>;
  return summaries.some(summary => summary.total > 0) ? summaries : null;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Supabase environment is incomplete" }, 500);

  const authorization = request.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await adminClient
    .from("user_profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return json({ error: "Admin access required" }, 403);
  if (!openaiApiKey) return json({ error: "OPENAI_API_KEY is not configured" }, 503);

  let payload: { test_result_id?: string; force?: boolean };
  try {
    payload = await request.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!payload.test_result_id) return json({ error: "test_result_id is required" }, 400);

  const { data: result, error: resultError } = await adminClient
    .from("test_results")
    .select("id,trainee_id,test_name,test_date,answers_json,score_vocab,score_grammar,score_listening,score_conversation,excluded,ai_diagnosis,ai_diagnosis_json,ai_diagnosis_model,ai_diagnosis_generated_at")
    .eq("id", payload.test_result_id)
    .single();
  if (resultError || !result) return json({ error: "Test result not found" }, 404);
  if (result.excluded) return json({ error: "Excluded results cannot be diagnosed" }, 409);
  if (!/^marugoto_[12]$/.test(result.test_name)) return json({ error: "AI diagnosis is enabled for Marugoto 1 and 2 only" }, 400);
  if (result.ai_diagnosis && !payload.force) {
    return json({
      cached: true,
      diagnosis: result.ai_diagnosis,
      structured: result.ai_diagnosis_json,
      model: result.ai_diagnosis_model,
      generated_at: result.ai_diagnosis_generated_at,
    });
  }

  const { data: sections, error: sectionError } = await adminClient
    .from("test_sections")
    .select("section_type,questions,answer_key,scoring_rules")
    .eq("test_id", result.test_name);
  if (sectionError || !sections?.length) return json({ error: "Scoring definition not found" }, 409);

  const answers = (result.answers_json || {}) as Record<string, unknown>;
  const storedSummary = storedCorrectSummary(answers, sections);
  const sectionSummary = sections.map(section => {
    const saved = storedSummary?.find(summary => summary.sectionType === section.section_type);
    if (saved) {
      return {
        section: sectionNames[section.section_type] || section.section_type,
        score: section.section_type === "goii" ? result.score_vocab
          : section.section_type === "bunpo" ? result.score_grammar
          : result.score_listening,
        correct: saved.correct,
        total: saved.total,
        rate: saved.total ? Math.round((saved.correct / saved.total) * 100) : 0,
        blocks: saved.blocks,
      };
    }
    const blocks = Object.entries(section.scoring_rules || {}).map(([blockId, ruleValue]) => {
      const rule = ruleValue as Record<string, unknown>;
      const fieldIds = Array.isArray(rule.field_ids) ? rule.field_ids as string[] : [];
      let correct = 0;
      for (const fieldId of fieldIds) {
        const expected = expectedValue(section.answer_key || {}, blockId, fieldId);
        if (expected !== undefined && isCorrect(answers[fieldId], expected)) correct += 1;
      }
      return {
        label: blockLabel(section.questions || [], blockId),
        correct,
        total: fieldIds.length,
        rate: fieldIds.length ? Math.round((correct / fieldIds.length) * 100) : 0,
      };
    });
    const correct = blocks.reduce((sum, block) => sum + block.correct, 0);
    const total = blocks.reduce((sum, block) => sum + block.total, 0);
    return {
      section: sectionNames[section.section_type] || section.section_type,
      score: section.section_type === "goii" ? result.score_vocab
        : section.section_type === "bunpo" ? result.score_grammar
        : result.score_listening,
      correct,
      total,
      rate: total ? Math.round((correct / total) * 100) : 0,
      blocks,
    };
  });

  const diagnosisInput = {
    test: result.test_name === "marugoto_1" ? "まるごとL1-L9総合" : "まるごとL10-L18総合",
    scores: {
      vocabulary: result.score_vocab,
      grammar: result.score_grammar,
      listening: result.score_listening,
      conversation: result.score_conversation,
    },
    sections: sectionSummary,
  };
  const inputHash = await sha256(JSON.stringify(diagnosisInput));
  const model = Deno.env.get("OPENAI_DIAGNOSIS_MODEL") || "gpt-5.4-mini";

  const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 900,
      instructions: [
        "あなたは外国人技能実習生向け日本語教育の主任講師です。",
        "匿名化された試験集計だけを根拠に、企業担当者向けの客観的な日本語診断を作成してください。",
        "人格・能力・将来性を断定せず、試験で観察できる学習傾向だけを述べてください。",
        "入力にない事実を補わず、点数と問題群の正答率に矛盾しない内容にしてください。",
        "各項目は自然な日本語の常体で、具体的かつ簡潔にしてください。",
        "指導方針は次の1か月に授業で実行できる練習を示してください。",
      ].join("\n"),
      input: JSON.stringify(diagnosisInput),
      text: {
        format: {
          type: "json_schema",
          name: "japanese_learning_diagnosis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string", description: "全体傾向を1〜2文で述べる" },
              strengths: { type: "string", description: "具体的な強みを1〜2文で述べる" },
              weaknesses: { type: "string", description: "具体的な課題を1〜2文で述べる" },
              guidance: { type: "string", description: "次月の指導方針を1〜2文で述べる" },
            },
            required: ["summary", "strengths", "weaknesses", "guidance"],
          },
        },
      },
    }),
  });

  const openaiData = await openaiResponse.json();
  if (!openaiResponse.ok) {
    console.error("OpenAI error", openaiResponse.status, openaiData);
    return json({ error: "AI diagnosis generation failed" }, 502);
  }
  const outputText = (openaiData.output || [])
    .flatMap((item: Record<string, unknown>) => Array.isArray(item.content) ? item.content : [])
    .find((content: Record<string, unknown>) => content.type === "output_text")?.text;
  if (!outputText) return json({ error: "AI returned no diagnosis" }, 502);

  let structured: Record<string, string>;
  try {
    structured = JSON.parse(String(outputText));
  } catch (_) {
    return json({ error: "AI returned invalid structured output" }, 502);
  }
  const diagnosis = [
    structured.summary,
    `強み：${structured.strengths}`,
    `課題：${structured.weaknesses}`,
    `指導方針：${structured.guidance}`,
  ].join("\n");
  const generatedAt = new Date().toISOString();

  const { error: updateError } = await adminClient
    .from("test_results")
    .update({
      ai_diagnosis: diagnosis,
      ai_diagnosis_json: structured,
      ai_diagnosis_model: model,
      ai_diagnosis_input_hash: inputHash,
      ai_diagnosis_generated_at: generatedAt,
    })
    .eq("id", result.id);
  if (updateError) return json({ error: "Failed to save diagnosis" }, 500);

  return json({ cached: false, diagnosis, structured, model, generated_at: generatedAt });
}

export default { fetch: handleRequest };
