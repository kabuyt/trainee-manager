type Rule = Record<string, any>;

export type BlockAssessment = {
  correct: number;
  total: number;
};

function selectedValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return (value as Record<string, unknown>).selected;
  }
  return value;
}

function normalize(value: unknown, options: Rule = {}) {
  let text = String(selectedValue(value) ?? "").trim();
  if (options.normalizeSpaces) text = text.replace(/\s+/g, " ");
  if (options.caseInsensitive) text = text.toLowerCase();
  if (options.stripAccents) {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d").replace(/Đ/g, "D");
  }
  if (options.stripPunctuation) text = text.replace(/[、。，．・,.\s]+/g, "");
  if (options.stripSuffix) text = text.replace(new RegExp(`${options.stripSuffix}$`), "");
  if (options.stripHyphens) text = text.replace(/[-ー－]/g, "");
  return text.replace(/✕/g, "×");
}

function getExpected(answerKey: unknown, fieldId: string, index?: number) {
  if (Array.isArray(answerKey)) {
    if (typeof index === "number" && index >= 0 && index < answerKey.length) return answerKey[index];
    const match = /(\d+)[a-z]*$/.exec(fieldId);
    if (match) return answerKey[Number(match[1]) - 1];
    return undefined;
  }
  if (answerKey && typeof answerKey === "object") {
    const values = answerKey as Record<string, unknown>;
    if (values[fieldId] !== undefined) return values[fieldId];
    for (const nested of Object.values(values)) {
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const value = (nested as Record<string, unknown>)[fieldId];
        if (value !== undefined) return value;
      }
    }
  }
  return undefined;
}

function exact(actual: unknown, expected: unknown, options: Rule = {}) {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  const actualValue = normalize(actual, options);
  return expectedValues.some(value => normalize(value, options) === actualValue);
}

function flex(actual: unknown, expected: unknown, rule: Rule) {
  const options = {
    caseInsensitive: rule.case_insensitive !== false,
    normalizeSpaces: rule.normalize_spaces !== false,
    stripAccents: rule.strip_accents !== false,
    stripSuffix: rule.strip_suffix,
    stripPunctuation: rule.strip_punctuation === true,
  };
  const separators = new RegExp(`[${String(rule.separator || "／").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}、/,，]`);
  const expectedValues = (Array.isArray(expected) ? expected : [expected])
    .flatMap(value => String(value).split(separators))
    .map(value => normalize(value, options)).filter(Boolean);
  const actualValues = String(selectedValue(actual) ?? "").split(separators)
    .map(value => normalize(value, options)).filter(Boolean);
  return expectedValues.some(expectedValue => actualValues.some(actualValue =>
    rule.exact_only === true
      ? actualValue === expectedValue
      : actualValue === expectedValue || actualValue.includes(expectedValue) || expectedValue.includes(actualValue)
  ));
}

function parseArray(value: unknown) {
  const selected = selectedValue(value);
  if (Array.isArray(selected)) return selected;
  if (typeof selected !== "string") return [];
  try {
    const parsed = JSON.parse(selected);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return selected.split(",").map(item => item.trim()).filter(Boolean);
  }
}

function fieldCorrect(actual: unknown, expected: unknown, method: string, rule: Rule) {
  if (expected === undefined || expected === null) return null;
  if (method === "ox_match") return exact(actual, expected);
  if (method === "phone_match") return exact(actual, expected, { stripHyphens: true });
  if (method === "normalized_match") {
    return exact(actual, expected, { stripPunctuation: true, caseInsensitive: true });
  }
  if (["flex_match", "vietnamese_fuzzy"].includes(method)) return flex(actual, expected, rule);
  if (["multi_field_flex", "array_flex"].includes(method)) {
    return exact(actual, expected, { caseInsensitive: true, stripSuffix: rule.strip_suffix });
  }
  if (method === "split_match") {
    const values = (Array.isArray(expected) ? expected : [expected])
      .flatMap(value => String(value).split(rule.separator || "／"));
    return exact(actual, values, { caseInsensitive: rule.case_insensitive !== false, stripSuffix: rule.strip_suffix });
  }
  if (method === "substring_match") {
    const actualValue = normalize(actual);
    const expectedValue = normalize(expected);
    return actualValue.length >= Number(rule.min_length || 3) &&
      (expectedValue.includes(actualValue) || actualValue.includes(expectedValue));
  }
  if (method === "unordered_tokens") {
    const actualValue = normalize(actual, { caseInsensitive: true });
    const sortedActual = [...actualValue].sort().join("");
    return (Array.isArray(expected) ? expected : [expected]).some(value => {
      const expectedValue = normalize(value, { caseInsensitive: true });
      return expectedValue === actualValue || [...expectedValue].sort().join("") === sortedActual;
    });
  }
  return exact(actual, expected);
}

function assessFields(rule: Rule, answerKey: unknown, answers: Record<string, unknown>, fieldIds: string[], method: string) {
  let correct = 0;
  let total = 0;
  fieldIds.forEach((fieldId, index) => {
    const expected = getExpected(answerKey, fieldId, index);
    const result = fieldCorrect(answers[fieldId], expected, method, rule);
    if (result === null) return;
    total += 1;
    if (result) correct += 1;
  });
  return { correct, total };
}

export function assessBlock(rule: Rule, answerKey: unknown, answers: Record<string, unknown>): BlockAssessment {
  const method = String(rule.method || "");
  if (!method || method === "manual") return { correct: 0, total: 0 };

  if (method === "multi_field_group") {
    let correct = 0;
    const groups = Array.isArray(rule.groups) ? rule.groups : [];
    groups.forEach((group: string[]) => {
      const result = assessFields(rule, answerKey, answers, group, "exact_match");
      if (result.total === group.length && result.correct === result.total) correct += 1;
    });
    return { correct, total: groups.length };
  }

  if (method === "pair_match") {
    const items = Array.isArray(rule.items) ? rule.items : [];
    let correct = 0;
    let total = 0;
    items.forEach((item: Rule, index: number) => {
      const expected = Array.isArray(answerKey) ? answerKey[index] || {} : answerKey || {};
      const aExpected = Array.isArray(answerKey) ? expected.a : getExpected(answerKey, item.a_field);
      const bExpected = Array.isArray(answerKey) ? expected.b : getExpected(answerKey, item.b_field);
      if (aExpected === undefined || bExpected === undefined) return;
      total += 1;
      if (exact(answers[item.a_field], aExpected) && exact(answers[item.b_field], bExpected)) correct += 1;
    });
    return { correct, total };
  }

  if (method === "bucket_sort") {
    let correct = 0;
    const fieldIds = Array.isArray(rule.field_ids) ? rule.field_ids : [];
    fieldIds.forEach((fieldId: string, index: number) => {
      const expected = getExpected(answerKey, fieldId, index);
      if (expected === undefined) return;
      const expectedValues = new Set(Array.isArray(expected) ? expected.map(String) : [String(expected)]);
      const actualValues = parseArray(answers[fieldId]).map(String);
      const hasAll = [...expectedValues].every(value => actualValues.includes(value));
      const hasTrap = actualValues.some(value => (rule.trap_keys || []).includes(value));
      if (hasAll && !hasTrap) correct += 1;
    });
    return { correct, total: fieldIds.length };
  }

  if (method === "price_country") {
    const fields = (rule.items || []).flatMap((item: Rule) => [item.price_field, item.country_field]).filter(Boolean);
    return assessFields(rule, answerKey, answers, fields, "exact_match");
  }

  if (method === "mixed_ox_manual") {
    return assessFields(rule, answerKey, answers, rule.ox_field_ids || [], "ox_match");
  }
  if (["mixed_select_manual", "mixed_text_select"].includes(method)) {
    return assessFields(rule, answerKey, answers, rule.select_field_ids || [], "exact_match");
  }
  if (method === "mixed_select_text") {
    let correct = 0;
    let total = 0;
    (rule.items || []).forEach((item: Rule) => {
      const expected = getExpected(answerKey, item.field_id);
      const result = fieldCorrect(answers[item.field_id], expected, item.method || "exact_match", item);
      if (result === null) return;
      total += 1;
      if (result) correct += 1;
    });
    return { correct, total };
  }

  const aliases: Record<string, string> = {
    multi_field_exact: "exact_match",
    multi_field_match: "exact_match",
    multi_accept: "exact_match",
    array_exact: "exact_match",
    exact_match_mixed: "exact_match",
  };
  const effectiveMethod = aliases[method] || method;
  return assessFields(rule, answerKey, answers, rule.field_ids || [], effectiveMethod);
}
