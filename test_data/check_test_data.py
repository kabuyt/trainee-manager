import argparse
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path


SECTIONS = ("goii", "bunpo", "chokkai")
FIELD_KEY_RE = re.compile(r"^[a-z]\d+")
SUPABASE_URL = "https://ajmdpkwqyeyzemeoojwd.supabase.co"


def load_json(path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def collect_question_fields(block):
    fields = set()
    for obj in walk(block):
        field_id = obj.get("field_id")
        if isinstance(field_id, str):
            fields.add(field_id)
        for key in ("a_field", "b_field", "price_field", "country_field"):
            value = obj.get(key)
            if isinstance(value, str):
                fields.add(value)
    return fields


def collect_image_refs(block):
    refs = []
    for obj in walk(block):
        for key in ("image_src", "src"):
            value = obj.get(key)
            if isinstance(value, str) and looks_like_image(value):
                refs.append(value)
    return refs


def looks_like_image(value):
    lower = value.lower()
    return lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"))


def collect_rule_fields(rule):
    fields = set()
    for field_id in rule.get("field_ids", []) or []:
        if isinstance(field_id, str):
            fields.add(field_id)
    for group in rule.get("groups", []) or []:
        for field_id in group:
            if isinstance(field_id, str):
                fields.add(field_id)
    for item in rule.get("items", []) or []:
        if not isinstance(item, dict):
            continue
        for key in ("a_field", "b_field", "price_field", "country_field"):
            field_id = item.get(key)
            if isinstance(field_id, str):
                fields.add(field_id)
    return fields


def collect_answer_fields(answer_key):
    if isinstance(answer_key, dict):
        return {k for k in answer_key.keys() if isinstance(k, str) and FIELD_KEY_RE.match(k)}
    return set()


def estimate_rule_points(rule):
    method = rule.get("method")
    if method == "manual":
        return None
    points_each = rule.get("points_each", rule.get("points_per_field", 1))
    if isinstance(rule.get("field_ids"), list):
        return len(rule["field_ids"]) * points_each
    if isinstance(rule.get("groups"), list):
        if isinstance(rule.get("group_points"), list):
            return sum(rule["group_points"])
        points_per_field = rule.get("points_per_field", points_each)
        return sum(len(group) for group in rule["groups"]) * points_per_field
    return None


def normalized_text(value):
    return str(value).strip().lower()


def flatten_expected(value):
    if isinstance(value, list):
        out = []
        for item in value:
            out.extend(flatten_expected(item))
        return out
    if value is None or isinstance(value, dict):
        return []
    return [str(value)]


def normalize_for_shift(value):
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("\u0111", "d").replace("\u0110", "d")
    return re.sub(r"[。、，,\.\s]+", "", text)


def strict_variants(value):
    variants = []
    for item in flatten_expected(value):
        for part in re.split(r"[／/]", item):
            normalized = normalize_for_shift(part)
            if len(normalized) >= 2:
                variants.append(normalized)
    return variants


def strict_match(actual, expected):
    actual_variants = strict_variants(actual)
    expected_variants = strict_variants(expected)
    if not actual_variants or not expected_variants:
        return False
    return any(actual == expected for actual in actual_variants for expected in expected_variants)


def get_expected_for_field(answer_key, field_id, index):
    if isinstance(answer_key, list):
        if 0 <= index < len(answer_key):
            return answer_key[index]
        return None
    if isinstance(answer_key, dict):
        return answer_key.get(field_id)
    return None


def warn_short_flex_answers(section_id, block_id, rule, answer_key, warnings):
    if rule.get("method") not in ("flex_match", "vietnamese_fuzzy"):
        return
    if rule.get("exact_only") is True:
        return
    if isinstance(answer_key, dict):
        entries = answer_key.items()
    elif isinstance(answer_key, list):
        field_ids = rule.get("field_ids", []) or []
        entries = zip(field_ids, answer_key)
    else:
        entries = []
    for field_id, expected in entries:
        for variant in flatten_expected(expected):
            compact = normalized_text(variant)
            compact = re.sub(r"[\s,./、。，・]+", "", compact)
            has_latin = re.search(r"[A-Za-zÀ-ỹĐđ]", compact) is not None
            if has_latin and 0 < len(compact) <= 2:
                warnings.append(
                    f"WARN {section_id}/{block_id}: short flex answer '{variant}' for {field_id} may overmatch"
                )


def public_image_candidates(public_root, test_id, ref):
    ref_path = Path(ref.replace("/", "\\"))
    return [
        public_root / "static" / test_id / ref_path,
        public_root / test_id / ref_path,
        public_root / ref_path,
        public_root / "common" / ref_path,
    ]


def load_service_key(base_dir):
    for env_path in (base_dir.parent / ".env.local", base_dir / ".env.local"):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("SUPABASE_SERVICE_KEY="):
                return line.split("=", 1)[1].strip()
    cache_path = base_dir / ".service_key.cache"
    if cache_path.exists():
        return cache_path.read_text(encoding="utf-8", errors="ignore").strip()
    return ""


def supabase_get(path, service_key):
    request = urllib.request.Request(
        f"{SUPABASE_URL}{path}",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def check_shift_suspicions(base_dir, test_id, answer_root, min_count):
    service_key = load_service_key(base_dir)
    if not service_key:
        return [f"WARN {test_id}: shift-check skipped because Supabase service key was not found"]

    select = urllib.parse.quote("id,answers_json", safe=",")
    path = (
        f"/rest/v1/test_results?test_name=eq.{test_id}"
        f"&answers_json=not.is.null&select={select}&order=created_at.asc"
    )
    try:
        submissions = supabase_get(path, service_key)
    except Exception as exc:
        return [f"WARN {test_id}: shift-check could not read test_results: {exc}"]

    suspicious = {}
    for row in submissions:
        answers = row.get("answers_json") or {}
        if not isinstance(answers, dict):
            continue
        for section_id in SECTIONS:
            section = answer_root.get(section_id) or {}
            answer_key = section.get("answer_key") or {}
            scoring_rules = section.get("scoring_rules") or {}
            for block_id, rule in scoring_rules.items():
                if not isinstance(rule, dict):
                    continue
                field_ids = rule.get("field_ids") or []
                if not isinstance(field_ids, list) or len(field_ids) < 2:
                    continue

                block_key = answer_key.get(block_id)
                expected_by_field = []
                for index, field_id in enumerate(field_ids):
                    expected = get_expected_for_field(block_key, field_id, index)
                    if expected is not None and strict_variants(expected):
                        expected_by_field.append((field_id, expected))

                for field_id, expected in expected_by_field:
                    actual = answers.get(field_id)
                    if actual in (None, "") or strict_match(actual, expected):
                        continue
                    for other_field, other_expected in expected_by_field:
                        if other_field == field_id:
                            continue
                        if strict_match(actual, other_expected):
                            key = (section_id, block_id, field_id, other_field)
                            item = suspicious.setdefault(key, {"count": 0, "examples": []})
                            item["count"] += 1
                            if len(item["examples"]) < 2:
                                item["examples"].append(str(actual))
                            break

    warnings = []
    for (section_id, block_id, field_id, other_field), item in sorted(
        suspicious.items(),
        key=lambda pair: (-pair[1]["count"], pair[0]),
    ):
        if item["count"] < min_count:
            continue
        examples = ", ".join(item["examples"])
        suffix = f" (examples: {examples})" if examples else ""
        warnings.append(
            f"WARN {test_id}/{section_id}/{block_id}: possible shifted answer key "
            f"{field_id} may match {other_field} in {item['count']} submissions{suffix}"
        )

    warnings.append(f"OK {test_id}: shift-check scanned {len(submissions)} submissions")
    return warnings


def check_section(base_dir, public_root, test_id, section_id, answer_root, results):
    question_path = base_dir / f"{test_id}_{section_id}_questions.json"
    if not question_path.exists():
        if section_id in answer_root:
            results.append(f"WARN {test_id}/{section_id}: answer data exists but question file is missing")
        return

    try:
        questions = load_json(question_path)
    except Exception as exc:
        results.append(f"FAIL {test_id}/{section_id}: cannot parse question JSON: {exc}")
        return

    if not isinstance(questions, list):
        results.append(f"FAIL {test_id}/{section_id}: question JSON should be a list")
        return

    section = answer_root.get(section_id)
    if not isinstance(section, dict):
        results.append(f"WARN {test_id}/{section_id}: missing section in answer keys")
        return

    answer_key = section.get("answer_key", {}) or {}
    scoring_rules = section.get("scoring_rules", {}) or {}
    question_blocks = {}
    for block in questions:
        if not isinstance(block, dict) or not block.get("id"):
            continue
        sub_sections = [
            sub for sub in block.get("sub_sections", []) or []
            if isinstance(sub, dict) and sub.get("sub_id")
        ]
        if sub_sections:
            for sub in sub_sections:
                question_blocks[sub["sub_id"]] = sub
        else:
            question_blocks[block["id"]] = block
    question_block_ids = set(question_blocks)
    answer_block_ids = set(answer_key.keys())
    scoring_block_ids = set(scoring_rules.keys())

    missing_answer = question_block_ids - answer_block_ids
    missing_scoring = question_block_ids - scoring_block_ids
    unused_answer = answer_block_ids - question_block_ids
    unused_scoring = scoring_block_ids - question_block_ids

    for block_id in sorted(missing_answer):
        results.append(f"WARN {test_id}/{section_id}/{block_id}: question block has no answer_key block")
    for block_id in sorted(missing_scoring):
        results.append(f"WARN {test_id}/{section_id}/{block_id}: question block has no scoring rule")
    for block_id in sorted(unused_answer):
        results.append(f"WARN {test_id}/{section_id}/{block_id}: answer_key block has no question block")
    for block_id in sorted(unused_scoring):
        results.append(f"WARN {test_id}/{section_id}/{block_id}: scoring rule has no question block")

    for block_id, block in sorted(question_blocks.items()):
        q_fields = collect_question_fields(block)
        b_answer = answer_key.get(block_id, {})
        b_rule = scoring_rules.get(block_id, {})
        r_fields = collect_rule_fields(b_rule) if isinstance(b_rule, dict) else set()
        if isinstance(b_answer, list) and r_fields:
            a_fields = set(r_fields)
        else:
            a_fields = collect_answer_fields(b_answer)

        for field_id in sorted(r_fields - q_fields):
            results.append(f"WARN {test_id}/{section_id}/{block_id}: scoring field {field_id} is not in questions")
        for field_id in sorted(a_fields - q_fields):
            results.append(f"WARN {test_id}/{section_id}/{block_id}: answer field {field_id} is not in questions")
        for field_id in sorted(r_fields - a_fields):
            if isinstance(b_answer, dict):
                results.append(f"WARN {test_id}/{section_id}/{block_id}: scoring field {field_id} has no answer")
        for field_id in sorted(a_fields - r_fields):
            if isinstance(b_rule, dict) and r_fields:
                results.append(f"WARN {test_id}/{section_id}/{block_id}: answer field {field_id} is not scored")

        total_points = block.get("total_points")
        estimated = estimate_rule_points(b_rule) if isinstance(b_rule, dict) else None
        if isinstance(total_points, (int, float)) and isinstance(estimated, (int, float)):
            if total_points != estimated:
                results.append(
                    f"WARN {test_id}/{section_id}/{block_id}: total_points {total_points} != scoring estimate {estimated}"
                )

        if isinstance(b_rule, dict):
            warn_short_flex_answers(section_id, block_id, b_rule, b_answer, results)

        for ref in collect_image_refs(block):
            if public_root and not any(path.exists() for path in public_image_candidates(public_root, test_id, ref)):
                results.append(f"WARN {test_id}/{section_id}/{block_id}: image not found: {ref}")

    results.append(f"OK {test_id}/{section_id}: checked {len(question_blocks)} blocks")


def check_test(base_dir, public_root, test_id, shift_check=False, shift_min_count=2):
    answer_path = base_dir / f"{test_id}_answer_keys.json"
    results = []
    if not answer_path.exists():
        return [f"FAIL {test_id}: answer key file is missing"]
    try:
        answer_root = load_json(answer_path)
    except Exception as exc:
        return [f"FAIL {test_id}: cannot parse answer key JSON: {exc}"]
    for section_id in SECTIONS:
        check_section(base_dir, public_root, test_id, section_id, answer_root, results)
    if shift_check:
        results.extend(check_shift_suspicions(base_dir, test_id, answer_root, shift_min_count))
    return results


def discover_tests(base_dir):
    tests = set()
    for path in base_dir.glob("test*_answer_keys.json"):
        tests.add(path.name.split("_", 1)[0])
    return sorted(tests, key=lambda name: int(name.replace("test", "")))


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Check test JSON consistency without modifying data.")
    parser.add_argument("tests", nargs="*", help="Example: test3 test4. Omit to check all tests.")
    parser.add_argument("--public-root", default=str(Path.home() / "Desktop" / "Webテスト_公開用"))
    parser.add_argument(
        "--shift-check",
        action="store_true",
        help="Also inspect stored submissions for answers that match a different field in the same block.",
    )
    parser.add_argument(
        "--shift-min-count",
        type=int,
        default=2,
        help="Minimum repeated shifted-answer pattern count to warn about.",
    )
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    public_root = Path(args.public_root) if args.public_root else None
    tests = args.tests or discover_tests(base_dir)

    all_results = []
    for test_id in tests:
        all_results.extend(check_test(base_dir, public_root, test_id, args.shift_check, args.shift_min_count))

    failures = [line for line in all_results if line.startswith("FAIL")]
    warnings = [line for line in all_results if line.startswith("WARN")]
    oks = [line for line in all_results if line.startswith("OK")]

    for line in failures + warnings + oks:
        print(line)
    print(f"SUMMARY: {len(failures)} fail, {len(warnings)} warn, {len(oks)} ok")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
