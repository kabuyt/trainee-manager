#!/usr/bin/env python3
"""Strict, deterministic verifier for the monthly all-choice revamp."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


SECTIONS = ("goii", "bunpo", "chokkai")
TARGET_TESTS = ("test2", "test3", "test4", "test5")
ALLOWED_METHODS = {
    "radio_exact", "exact_match", "ox_match", "normalized_match", "unordered_tokens",
    # Retained all-choice compound controls. pair_match intentionally awards a
    # pair only when both selects are correct; replacing it with exact_match
    # would introduce unintended partial credit.
    "pair_match",
}
TILE_TYPES = {"word_puzzle", "tile_select"}
SELECT_INPUT_TYPES = {"select", "radio", "checkbox", "dropdown"}
MEDIA_KEYS = {"src", "image_src", "illustration_src", "audio_src"}
TRANSCRIPT_REQUIREMENTS = {
    "test4": {"chokkai": {"c2", "c6"}},
}


@dataclass(frozen=True)
class Finding:
    level: str
    location: str
    message: str

    def render(self) -> str:
        return f"{self.level} {self.location}: {self.message}"


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def walk(value: Any, ancestors: tuple[dict[str, Any], ...] = ()) -> Iterable[tuple[dict[str, Any], tuple[dict[str, Any], ...]]]:
    if isinstance(value, dict):
        yield value, ancestors
        next_ancestors = ancestors + (value,)
        for child in value.values():
            yield from walk(child, next_ancestors)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child, ancestors)


def collect_fields(questions: list[dict[str, Any]]) -> tuple[dict[str, list[dict[str, Any]]], dict[str, str]]:
    occurrences: dict[str, list[dict[str, Any]]] = {}
    field_blocks: dict[str, str] = {}
    for block in questions:
        block_id = str(block.get("id", "<missing>"))
        for obj, ancestors in walk(block):
            field_id = obj.get("field_id")
            if not isinstance(field_id, str) or not field_id:
                continue
            inherited_manual = any(parent.get("grading") == "manual" for parent in ancestors)
            choices = obj.get("choices", obj.get("options"))
            dynamic_choices = bool(obj.get("options_dynamic")) or any(
                parent.get("options_dynamic")
                or parent.get("dynamic_options")
                or parent.get("correct_pool")
                or parent.get("extra_pool")
                or parent.get("pool_correct")
                or parent.get("c12_option_sets")
                for parent in ancestors
            )
            occurrences.setdefault(field_id, []).append(
                {
                    "input_type": obj.get("input_type"),
                    "choices": choices,
                    "dynamic_choices": dynamic_choices,
                    "manual": inherited_manual or obj.get("grading") == "manual",
                }
            )
            field_blocks[field_id] = block_id
    return occurrences, field_blocks


def collect_rule_fields(rule: dict[str, Any]) -> list[str]:
    fields: list[str] = []
    for field_id in rule.get("field_ids", []) or []:
        if isinstance(field_id, str):
            fields.append(field_id)
    for group in rule.get("groups", []) or []:
        for field_id in group:
            if isinstance(field_id, str):
                fields.append(field_id)
    for item in rule.get("items", []) or []:
        if not isinstance(item, dict):
            continue
        for key in ("a_field", "b_field", "price_field", "country_field"):
            field_id = item.get(key)
            if isinstance(field_id, str):
                fields.append(field_id)
    return fields


def answer_for_field(answer_key: dict[str, Any], rule_id: str, field_id: str, index: int) -> Any:
    source = answer_key.get(rule_id)
    if source is None and field_id in answer_key:
        return answer_key[field_id]
    if isinstance(source, dict):
        return source.get(field_id)
    if isinstance(source, list) and 0 <= index < len(source):
        return source[index]
    return None


def pair_answer_for_field(
    answer_key: dict[str, Any], rule_id: str, rule: dict[str, Any], field_id: str
) -> Any:
    source = answer_key.get(rule_id)
    if not isinstance(source, list):
        return None
    for pair_index, pair in enumerate(rule.get("items", []) or []):
        if pair_index >= len(source) or not isinstance(source[pair_index], dict):
            continue
        if pair.get("a_field") == field_id:
            return source[pair_index].get("a")
        if pair.get("b_field") == field_id:
            return source[pair_index].get("b")
    return None


def choice_values(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    values: list[str] = []
    for choice in raw:
        if isinstance(choice, dict):
            if choice.get("value") is not None:
                values.append(str(choice["value"]))
        elif choice is not None:
            values.append(str(choice))
    return values


def accepted_values(expected: Any) -> list[str]:
    if expected is None or isinstance(expected, dict):
        return []
    if isinstance(expected, list):
        result: list[str] = []
        for item in expected:
            result.extend(accepted_values(item))
        return result
    return [str(expected)]


def estimate_points(rule: dict[str, Any]) -> float | None:
    if isinstance(rule.get("group_points"), list):
        return float(sum(rule["group_points"]))
    if isinstance(rule.get("groups"), list):
        per_field = float(rule.get("points_per_field", rule.get("points_each", 1)))
        return sum(len(group) for group in rule["groups"]) * per_field
    if isinstance(rule.get("items"), list) and not rule.get("field_ids"):
        return len(rule["items"]) * float(rule.get("points_each", 1))
    if isinstance(rule.get("field_ids"), list):
        return len(rule["field_ids"]) * float(rule.get("points_each", rule.get("points_per_field", 1)))
    return None


def media_path(public_root: Path, test_id: str, ref: str) -> Path | None:
    if ref.startswith(("http://", "https://", "data:", "/")):
        return None
    clean = Path(ref.replace("\\", "/"))
    if clean.parts and clean.parts[0] == "static":
        return public_root / clean
    return public_root / "static" / test_id / clean


def verify_converted_listening_transcripts(
    base_dir: Path,
    test_id: str,
    questions_by_section: dict[str, list[dict[str, Any]]],
    answer_root: dict[str, Any],
) -> list[Finding]:
    requirements = TRANSCRIPT_REQUIREMENTS.get(test_id, {})
    if not requirements:
        return []
    transcript_path = base_dir / f"{test_id}_audio_transcripts.json"
    try:
        transcripts = load_json(transcript_path)
    except Exception as exc:
        return [Finding("FAIL", test_id, f"cannot load converted-listening transcripts: {exc}")]
    if not isinstance(transcripts, dict):
        return [Finding("FAIL", test_id, "converted-listening transcript file is not an object")]

    findings: list[Finding] = []
    for section_id, block_ids in requirements.items():
        blocks = {
            str(block.get("id")): block
            for block in questions_by_section.get(section_id, [])
            if isinstance(block, dict)
        }
        section_answers = answer_root.get(section_id, {})
        answer_key = section_answers.get("answer_key", {}) if isinstance(section_answers, dict) else {}
        scoring_rules = section_answers.get("scoring_rules", {}) if isinstance(section_answers, dict) else {}
        manual_fields = {
            field_id
            for rule in scoring_rules.values()
            if isinstance(rule, dict) and rule.get("method") == "manual"
            for field_id in collect_rule_fields(rule)
        }
        for block_id in sorted(block_ids):
            location = f"{test_id}/{section_id}/{block_id}"
            block = blocks.get(block_id)
            if block is None:
                findings.append(Finding("FAIL", location, "converted listening block is missing"))
                continue
            fields, _ = collect_fields([block])
            covered_fields: dict[str, Any] = {}
            audio_refs: set[str] = set()
            for obj, _ in walk(block):
                ref = obj.get("audio_src")
                if isinstance(ref, str) and ref:
                    audio_refs.add(ref)
            if not audio_refs:
                findings.append(Finding("FAIL", location, "converted listening block has no audio"))
            for ref in sorted(audio_refs):
                name = Path(ref.replace("\\", "/")).name
                entry = transcripts.get(name)
                audio_loc = f"{location}/{name}"
                if not isinstance(entry, dict):
                    findings.append(Finding("FAIL", audio_loc, "transcript entry is missing"))
                    continue
                transcript = entry.get("transcript")
                if not isinstance(transcript, (str, list)) or not transcript:
                    findings.append(Finding("FAIL", audio_loc, "transcript text is empty"))
                entry_fields = entry.get("fields")
                if not isinstance(entry_fields, dict):
                    findings.append(Finding("FAIL", audio_loc, "transcript field mapping is missing"))
                    continue
                for field_id, value in entry_fields.items():
                    if field_id in covered_fields and covered_fields[field_id] != value:
                        findings.append(Finding("FAIL", audio_loc, f"conflicting transcript answer for {field_id}"))
                    covered_fields[field_id] = value

            for field_id in sorted(fields):
                if field_id in manual_fields:
                    continue
                field_loc = f"{location}/{field_id}"
                if field_id not in covered_fields:
                    findings.append(Finding("FAIL", field_loc, "converted listening field is absent from transcript mapping"))
                    continue
                expected = None
                if isinstance(answer_key, dict):
                    if field_id in answer_key:
                        expected = answer_key[field_id]
                    else:
                        for source in answer_key.values():
                            if isinstance(source, dict) and field_id in source:
                                expected = source[field_id]
                                break
                if expected is None:
                    findings.append(Finding("FAIL", field_loc, "converted listening answer is missing"))
                    continue
                if str(covered_fields[field_id]) not in accepted_values(expected):
                    findings.append(Finding("FAIL", field_loc, "transcript answer disagrees with answer key"))
            unknown_fields = sorted(set(covered_fields) - set(fields))
            for field_id in unknown_fields:
                findings.append(Finding("FAIL", f"{location}/{field_id}", "transcript maps an unrendered field"))
    return findings


def verify_section(
    test_id: str,
    section_id: str,
    questions: list[dict[str, Any]],
    answer_key: dict[str, Any],
    scoring_rules: dict[str, Any],
    public_root: Path,
) -> list[Finding]:
    location = f"{test_id}/{section_id}"
    findings: list[Finding] = []
    fields, field_blocks = collect_fields(questions)

    for field_id, occurrences in sorted(fields.items()):
        if len(occurrences) != 1:
            findings.append(Finding("FAIL", f"{location}/{field_id}", f"rendered {len(occurrences)} times"))

    scored_by: dict[str, list[str]] = {}
    section_points = 0.0
    for rule_id, rule in sorted(scoring_rules.items()):
        rule_loc = f"{location}/{rule_id}"
        if not isinstance(rule, dict):
            findings.append(Finding("FAIL", rule_loc, "scoring rule is not an object"))
            continue
        method = rule.get("method")
        if method not in ALLOWED_METHODS:
            findings.append(Finding("FAIL", rule_loc, f"disallowed scoring method {method!r}"))
        if method in {"normalized_match", "unordered_tokens"}:
            rule_fields = collect_rule_fields(rule)
            source_types = {field_blocks.get(field_id) for field_id in rule_fields}
            block_types = {
                str(block.get("id")): str(block.get("type")) for block in questions if isinstance(block, dict)
            }
            if not source_types or any(block_types.get(block_id) not in TILE_TYPES for block_id in source_types):
                findings.append(Finding("FAIL", rule_loc, f"{method} is allowed only for retained tile puzzles"))

        points = estimate_points(rule)
        if points is None:
            findings.append(Finding("FAIL", rule_loc, "cannot determine rule point total"))
        else:
            section_points += points

        rule_fields = collect_rule_fields(rule)
        if not rule_fields:
            findings.append(Finding("FAIL", rule_loc, "scoring rule has no fields"))
        if len(rule_fields) != len(set(rule_fields)):
            findings.append(Finding("FAIL", rule_loc, "scoring rule contains duplicate fields"))

        for index, field_id in enumerate(rule_fields):
            scored_by.setdefault(field_id, []).append(rule_id)
            field_loc = f"{rule_loc}/{field_id}"
            if field_id not in fields:
                findings.append(Finding("FAIL", field_loc, "scored field is not rendered"))
                continue
            expected = (
                pair_answer_for_field(answer_key, rule_id, rule, field_id)
                if method == "pair_match"
                else answer_for_field(answer_key, rule_id, field_id, index)
            )
            if expected is None and method != "manual":
                findings.append(Finding("FAIL", field_loc, "has no answer"))

            meta = fields[field_id][0]
            if meta.get("input_type") == "text":
                findings.append(Finding("FAIL", field_loc, "typed input remains"))
            if meta.get("manual"):
                findings.append(Finding("FAIL", field_loc, "manual-grading marker remains"))

            is_selection = meta.get("input_type") in SELECT_INPUT_TYPES or meta.get("choices") is not None
            if is_selection and not meta.get("dynamic_choices"):
                choices = choice_values(meta.get("choices"))
                if len(choices) < 2:
                    findings.append(Finding("FAIL", field_loc, "selection field has fewer than two choices"))
                if len(choices) != len(set(choices)):
                    findings.append(Finding("FAIL", field_loc, "choice values are duplicated"))
                expected_values = accepted_values(expected)
                if expected_values and not any(value in choices for value in expected_values):
                    findings.append(Finding("FAIL", field_loc, "answer is absent from choice values"))

    for field_id in sorted(fields):
        owners = scored_by.get(field_id, [])
        if not owners:
            findings.append(Finding("FAIL", f"{location}/{field_id}", "rendered field is not scored"))
        elif len(owners) > 1:
            findings.append(Finding("FAIL", f"{location}/{field_id}", f"scored by multiple rules: {owners}"))

    if abs(section_points - 100.0) > 1e-9:
        findings.append(Finding("FAIL", location, f"scoring rules total {section_points:g}, expected 100"))

    seen_media: set[str] = set()
    for obj, _ in walk(questions):
        for key in MEDIA_KEYS:
            ref = obj.get(key)
            if not isinstance(ref, str) or not ref or ref in seen_media:
                continue
            seen_media.add(ref)
            path = media_path(public_root, test_id, ref)
            if path is not None and not path.exists():
                findings.append(Finding("FAIL", location, f"missing media {ref} ({path})"))

    return findings


def verify_test(base_dir: Path, public_root: Path, test_id: str) -> list[Finding]:
    findings: list[Finding] = []
    answer_path = base_dir / f"{test_id}_answer_keys.json"
    try:
        root = load_json(answer_path)
    except Exception as exc:
        return [Finding("FAIL", test_id, f"cannot load {answer_path.name}: {exc}")]

    questions_by_section: dict[str, list[dict[str, Any]]] = {}
    for section_id in SECTIONS:
        question_path = base_dir / f"{test_id}_{section_id}_questions.json"
        if not question_path.exists():
            findings.append(Finding("FAIL", f"{test_id}/{section_id}", f"missing {question_path.name}"))
            continue
        try:
            questions = load_json(question_path)
        except Exception as exc:
            findings.append(Finding("FAIL", f"{test_id}/{section_id}", f"cannot parse questions: {exc}"))
            continue
        section = root.get(section_id, {}) if isinstance(root, dict) else {}
        if not isinstance(questions, list) or not isinstance(section, dict):
            findings.append(Finding("FAIL", f"{test_id}/{section_id}", "invalid top-level JSON shape"))
            continue
        questions_by_section[section_id] = questions
        findings.extend(
            verify_section(
                test_id,
                section_id,
                questions,
                section.get("answer_key", {}) or {},
                section.get("scoring_rules", {}) or {},
                public_root,
            )
        )
    findings.extend(
        verify_converted_listening_transcripts(
            base_dir,
            test_id,
            questions_by_section,
            root if isinstance(root, dict) else {},
        )
    )
    return findings


def main() -> int:
    default_public = Path(__file__).resolve().parents[2] / "nihongo-test-1-4ka"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tests", nargs="*", help="test2 through test5; omit to verify all targets")
    parser.add_argument("--public-root", type=Path, default=default_public)
    parser.add_argument("--json", action="store_true", help="emit machine-readable findings")
    args = parser.parse_args()

    invalid_tests = sorted(set(args.tests) - set(TARGET_TESTS))
    if invalid_tests:
        parser.error(f"unsupported target(s): {', '.join(invalid_tests)}")

    base_dir = Path(__file__).resolve().parent
    findings: list[Finding] = []
    for test_id in args.tests or TARGET_TESTS:
        findings.extend(verify_test(base_dir, args.public_root.resolve(), test_id))
    findings.sort(key=lambda item: (item.location, item.message, item.level))

    if args.json:
        print(json.dumps([finding.__dict__ for finding in findings], ensure_ascii=False, indent=2))
    else:
        for finding in findings:
            print(finding.render())
        print(f"SUMMARY: {sum(item.level == 'FAIL' for item in findings)} fail")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
