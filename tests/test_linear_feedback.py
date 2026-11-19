#!/usr/bin/env python3
"""Host tests for tools/linear_feedback.py."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import linear_feedback as lf  # noqa: E402


def make_raw_issue(
    identifier: str,
    *,
    title: str = "Fix cover title truncation",
    description: str = "Long Chinese titles clip in Play Manager.",
    team_key: str = "SAAN",
    project_name: str = "CoverArts Launcher",
    state_type: str = "unstarted",
    priority: int = 2,
    created_at: str = "2026-11-18T10:00:00.000Z",
    labels: list[str] | None = None,
    comments: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "id": f"uuid-{identifier.lower()}",
        "identifier": identifier,
        "title": title,
        "description": description,
        "url": f"https://linear.app/saan/issue/{identifier}",
        "priority": priority,
        "createdAt": created_at,
        "team": {"id": "team-saan", "key": team_key},
        "project": {"name": project_name},
        "state": {"id": "state-todo", "name": "Todo", "type": state_type},
        "labels": {"nodes": [{"id": f"lbl-{name}", "name": name} for name in (labels or [])]},
        "comments": {"nodes": comments or []},
    }


class LinearFeedbackTests(unittest.TestCase):
    def test_branch_name_for_issue(self) -> None:
        self.assertEqual(lf.branch_name_for_issue("SAAN-42"), "feedback/saan-42")
        self.assertEqual(lf.branch_name_for_issue("  SAAN-108 "), "feedback/saan-108")
        with self.assertRaises(ValueError):
            lf.branch_name_for_issue("   ")

    def test_select_candidate_filters_and_ranks_by_priority_then_age(self) -> None:
        issues = [
            lf.normalize_issue(
                make_raw_issue(
                    "SAAN-10",
                    priority=2,
                    labels=["auto-pr", "pr-opened"],
                )
            ),
            lf.normalize_issue(
                make_raw_issue(
                    "SAAN-11",
                    priority=1,
                    labels=["auto-pr"],
                )
            ),
            lf.normalize_issue(
                make_raw_issue(
                    "SAAN-12",
                    priority=2,
                    created_at="2026-11-18T08:00:00.000Z",
                    labels=["auto-pr"],
                )
            ),
            lf.normalize_issue(
                make_raw_issue(
                    "SAAN-13",
                    priority=2,
                    created_at="2026-11-18T07:00:00.000Z",
                    labels=["auto-pr"],
                )
            ),
            lf.normalize_issue(
                make_raw_issue(
                    "OTHER-1",
                    team_key="OTHER",
                    priority=1,
                    labels=["auto-pr"],
                )
            ),
        ]

        # SAAN-11 has an open branch, so SAAN-13 (high priority, oldest) wins.
        selected = lf.select_candidate_issue(
            issues,
            exclude_branches={"feedback/saan-11"},
        )
        self.assertIsNotNone(selected)
        assert selected is not None
        self.assertEqual(selected["identifier"], "SAAN-13")

        # Explicit issue selection bypasses label/branch filters.
        explicit = lf.select_candidate_issue(issues, explicit_issue_id="SAAN-10")
        self.assertIsNotNone(explicit)
        assert explicit is not None
        self.assertEqual(explicit["identifier"], "SAAN-10")

    def test_normalize_issue_skips_bot_marker_comments(self) -> None:
        raw = make_raw_issue(
            "SAAN-20",
            labels=["auto-pr"],
            comments=[
                {
                    "id": "c1",
                    "body": f"{lf.COMMENT_MARKER}\nOld bot status",
                    "createdAt": "2026-11-18T09:00:00Z",
                    "user": {"name": "Bot"},
                },
                {
                    "id": "c2",
                    "body": "Happens on Chrome 130 macOS.",
                    "createdAt": "2026-11-18T09:05:00Z",
                    "user": {"name": "Alice"},
                },
            ],
        )
        issue = lf.normalize_issue(raw)
        self.assertEqual(len(issue["comments"]), 1)
        self.assertEqual(issue["comments"][0]["author"], "Alice")

    def test_render_codex_prompt_contains_delimiters_and_skill_guidance(self) -> None:
        issue = lf.normalize_issue(make_raw_issue("SAAN-42", labels=["auto-pr"]))
        prompt = lf.render_codex_prompt(issue, repo_root=ROOT)
        self.assertIn("<untrusted_linear_feedback>", prompt)
        self.assertIn("</untrusted_linear_feedback>", prompt)
        self.assertIn("backnotprop/pstack", prompt)
        self.assertIn("emilkowalski/skills", prompt)
        self.assertIn("SAAN-42", prompt)

    def test_build_pr_title_and_format_pr_body(self) -> None:
        issue = lf.normalize_issue(make_raw_issue("SAAN-42", title="Search dropdown jitters"))
        codex_result = {
            "status": "ready_for_pr",
            "pr_title": "fix(manager): stabilize catalog filter transition",
            "summary": "Removed layout-shifting transition on filter buttons.",
            "root_cause": "Animating width triggered reflow on every toggle.",
            "area": "manager-ui",
            "skills_applied": ["poteto-mode", "emil-design-eng", "review-animations"],
            "verification": {
                "static_checks": "PASS",
                "firmware_build": "NOT RUN",
                "notes": "Node manager UI tests pass.",
            },
            "unverified": ["Manual Chrome/Edge check on calm.yishan.app"],
            "clarification_questions": [],
        }
        title = lf.build_pr_title(issue, codex_result)
        self.assertEqual(title, "fix(manager): stabilize catalog filter transition [SAAN-42]")

        body = lf.format_pr_body(issue, codex_result, static_status="PASS")
        self.assertIn("Build: NOT RUN", body)
        self.assertIn("Host tests: PASS", body)
        self.assertIn("Device tests: NOT RUN", body)
        self.assertIn("`emil-design-eng`", body)
        self.assertIn("SAAN-42", body)

        # Fallback title when Codex omits a conventional commit prefix.
        fallback = lf.build_pr_title(issue, {"pr_title": "Fix it", "area": "manager-ui"})
        self.assertTrue(fallback.startswith("fix(manager): "))
        self.assertIn("[SAAN-42]", fallback)

    def test_format_linear_comment_modes(self) -> None:
        issue = lf.normalize_issue(make_raw_issue("SAAN-77"))
        pr_comment = lf.format_linear_comment(
            issue,
            {"status": "ready_for_pr", "summary": "Fixed", "root_cause": "Null check", "skills_applied": ["tdd"]},
            pr_url="https://github.com/yishan/cover-arts-launcher/pull/99",
        )
        self.assertIn(lf.COMMENT_MARKER, pr_comment)
        self.assertIn("pull/99", pr_comment)

        clarify = lf.format_linear_comment(
            issue,
            {"status": "needs_clarification", "clarification_questions": ["Which firmware version?"]},
        )
        self.assertIn("Which firmware version?", clarify)

    def test_notify_linear_updates_existing_marker_comment_idempotently(self) -> None:
        issue = lf.normalize_issue(make_raw_issue("SAAN-88"))
        responses = [
            {
                "issue": {
                    "comments": {"nodes": [{"id": "c-existing", "body": f"{lf.COMMENT_MARKER}\nold"}]},
                    "labels": {"nodes": [{"id": "lbl-1", "name": "auto-pr"}]},
                }
            },
            {"commentUpdate": {"success": True}},
            {"team": {"labels": {"nodes": [{"id": "lbl-2", "name": "pr-opened"}]}}},
            {"issueUpdate": {"success": True}},
        ]
        with mock.patch.object(lf, "graphql_request", side_effect=responses) as mocked:
            result = lf.notify_linear(
                "lin_api_dummy",
                issue,
                f"{lf.COMMENT_MARKER}\nnew",
                add_label="pr-opened",
            )
        self.assertEqual(result["comment"], "updated")
        self.assertTrue(result["label_added"])
        self.assertEqual(mocked.call_count, 4)

    def test_output_schema_is_valid_json(self) -> None:
        schema_path = ROOT / "tools" / "feedback_pr_output_schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        self.assertEqual(schema["type"], "object")
        self.assertIn("skills_applied", schema["required"])

    def test_extract_claude_output(self) -> None:
        direct = lf.extract_claude_output(
            {"is_error": False, "structured_output": {"status": "ready_for_pr"}}
        )
        self.assertEqual(direct["status"], "ready_for_pr")

        fenced = lf.extract_claude_output(
            {"is_error": False, "result": 'Done:\n```json\n{"status": "no_changes_needed"}\n```'}
        )
        self.assertEqual(fenced["status"], "no_changes_needed")

        prose_wrapped = lf.extract_claude_output(
            {"is_error": False, "result": 'Summary below:\n{"status": "needs_clarification", "summary": "ok"}\nEnd.'}
        )
        self.assertEqual(prose_wrapped["status"], "needs_clarification")

        with self.assertRaises(ValueError):
            lf.extract_claude_output({"is_error": True, "result": "rate limit"})


if __name__ == "__main__":
    unittest.main()
