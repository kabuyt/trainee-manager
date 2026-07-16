import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assessBlock } from "../supabase/functions/generate-test-diagnosis/diagnosis-aggregation.ts";

function expected(answerKey: any, fieldId: string, index?: number) {
  if (Array.isArray(answerKey)) {
    if (typeof index === "number" && index < answerKey.length) return answerKey[index];
    const match = /(\d+)[a-z]*$/.exec(fieldId);
    return match ? answerKey[Number(match[1]) - 1] : undefined;
  }
  if (answerKey?.[fieldId] !== undefined) return answerKey[fieldId];
  for (const nested of Object.values<any>(answerKey || {})) {
    if (nested?.[fieldId] !== undefined) return nested[fieldId];
  }
  return undefined;
}

function firstAccepted(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function perfectAnswers(rule: any, answerKey: any) {
  const answers: Record<string, unknown> = {};
  const setFields = (fieldIds: string[]) => fieldIds.forEach((fieldId, index) => {
    answers[fieldId] = firstAccepted(expected(answerKey, fieldId, index));
  });

  if (rule.method === "bucket_sort") {
    (rule.field_ids || []).forEach((fieldId: string, index: number) => {
      const value = expected(answerKey, fieldId, index);
      answers[fieldId] = Array.isArray(value) ? value : [value];
    });
  } else if (rule.method === "multi_field_group") {
    setFields((rule.groups || []).flat());
  } else if (rule.method === "pair_match") {
    (rule.items || []).forEach((item: any, index: number) => {
      const value = Array.isArray(answerKey) ? answerKey[index] : answerKey;
      answers[item.a_field] = Array.isArray(answerKey) ? value?.a : expected(answerKey, item.a_field);
      answers[item.b_field] = Array.isArray(answerKey) ? value?.b : expected(answerKey, item.b_field);
    });
  } else if (rule.method === "price_country") {
    setFields((rule.items || []).flatMap((item: any) => [item.price_field, item.country_field]));
  } else if (rule.method === "mixed_ox_manual") {
    setFields(rule.ox_field_ids || []);
  } else if (["mixed_select_manual", "mixed_text_select"].includes(rule.method)) {
    setFields(rule.select_field_ids || []);
  } else if (rule.method === "mixed_select_text") {
    setFields((rule.items || []).map((item: any) => item.field_id));
  } else {
    setFields(rule.field_ids || []);
    if (rule.method === "split_match") {
      (rule.field_ids || []).forEach((fieldId: string, index: number) => {
        answers[fieldId] = String(firstAccepted(expected(answerKey, fieldId, index)) ?? "")
          .split(rule.separator || "／")[0];
      });
    }
  }
  return answers;
}

let checkedBlocks = 0;
for (let testNumber = 1; testNumber <= 8; testNumber += 1) {
  const file = path.join(import.meta.dirname, `test${testNumber}_answer_keys.json`);
  const test = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const section of Object.values<any>(test)) {
    for (const [blockId, rule] of Object.entries<any>(section.scoring_rules || {})) {
      if (!rule?.method || rule.method === "manual") continue;
      const answerKey = section.answer_key?.[blockId] ?? section.answer_key ?? {};
      const assessment = assessBlock(rule, answerKey, perfectAnswers(rule, answerKey));
      assert.ok(assessment.total > 0, `test${testNumber}/${blockId}/${rule.method} has no assessable items`);
      assert.equal(
        assessment.correct,
        assessment.total,
        `test${testNumber}/${blockId}/${rule.method} should be perfect`,
      );
      const blankAssessment = assessBlock(rule, answerKey, {});
      assert.equal(
        blankAssessment.total,
        assessment.total,
        `test${testNumber}/${blockId}/${rule.method} should keep its item count for blank answers`,
      );
      assert.equal(
        blankAssessment.correct,
        0,
        `test${testNumber}/${blockId}/${rule.method} should reject blank answers`,
      );
      checkedBlocks += 1;
    }
  }
}

console.log(`diagnosis aggregation: ${checkedBlocks} auto-graded blocks passed`);
