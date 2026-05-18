import argparse
import json
import re
import sys
from pathlib import Path


SECTIONS = ("goii", "bunpo", "chokkai")
FIELD_KEY_RE = re.compile(r"^[a-z]\d+")


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


def check_test(base_dir, public_root, test_id):
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
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    public_root = Path(args.public_root) if args.public_root else None
    tests = args.tests or discover_tests(base_dir)

    all_results = []
    for test_id in tests:
        all_results.extend(check_test(base_dir, public_root, test_id))

    failures = [line for line in all_results if line.startswith("FAIL")]
    warnings = [line for line in all_results if line.startswith("WARN")]
    oks = [line for line in all_results if line.startswith("OK")]

    for line in failures + warnings + oks:
        print(line)
    print(f"SUMMARY: {len(failures)} fail, {len(warnings)} warn, {len(oks)} ok")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
