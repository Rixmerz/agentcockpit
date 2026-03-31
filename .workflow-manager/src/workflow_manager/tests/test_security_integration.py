"""Tests for security-related functions:
- _summarize_security in dcc_integration.py
- _filter_actionable_smells in dcc_feedback.py (standalone version)
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from workflow_manager.dcc_integration import _summarize_security

# dcc_feedback.py lives in .claude/hooks — not on sys.path by default.
# Resolve via the known project root (3 levels up from this file: tests → workflow_manager → src → .workflow-manager → agentcockpit).
_HOOKS_DIR = Path(__file__).parents[4] / ".claude" / "hooks"

import importlib.util as _ilu

_spec = _ilu.spec_from_file_location("dcc_feedback", _HOOKS_DIR / "dcc_feedback.py")
_dcc_feedback = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_dcc_feedback)
_filter_actionable_smells_standalone = _dcc_feedback._filter_actionable_smells


# ---------------------------------------------------------------------------
# TestSummarizeSecurity
# ---------------------------------------------------------------------------

class TestSummarizeSecurity:
    def test_summarize_no_data(self):
        """None input returns None."""
        result = _summarize_security(None)

        assert result is None

    def test_summarize_no_findings(self):
        """A result with total=0 and no severity data → 'No security findings'."""
        result = _summarize_security({"total": 0})

        assert result == "No security findings"

    def test_summarize_all_resolved(self):
        """All findings suppressed, open=0 → message includes 'all resolved'."""
        data = {
            "total": 5,
            "by_status": {"suppressed": 5},
            "by_severity": {},
        }

        result = _summarize_security(data)

        assert result is not None
        assert "all resolved" in result.lower() or "resolved" in result.lower()

    def test_summarize_open_findings(self):
        """open=3 with severity breakdown → output includes '3 open findings (2 high, 1 medium)'."""
        data = {
            "total": 3,
            "by_status": {"open": 3},
            "by_severity": {"high": 2, "medium": 1},
        }

        result = _summarize_security(data)

        assert result is not None
        assert "3 open" in result
        assert "2 high" in result
        assert "1 medium" in result

    def test_summarize_critical(self):
        """Findings include critical severity → 'critical' appears in the output."""
        data = {
            "total": 3,
            "by_status": {"open": 3},
            "by_severity": {"critical": 1, "high": 2},
        }

        result = _summarize_security(data)

        assert result is not None
        assert "critical" in result


# ---------------------------------------------------------------------------
# TestFilterActionableSmellsStandalone
# ---------------------------------------------------------------------------

class TestFilterActionableSmellsStandalone:
    """Tests for the standalone _filter_actionable_smells in dcc_feedback.py."""

    def _make_mock_run(self, status_stdout="", diff_stdout="", returncode=0):
        """Return a side_effect list of two mock CompletedProcess objects."""
        r1 = MagicMock()
        r1.returncode = returncode
        r1.stdout = status_stdout

        r2 = MagicMock()
        r2.returncode = returncode
        r2.stdout = diff_stdout

        return [r1, r2]

    def test_standalone_filter_removes_orphans(self, tmp_path):
        """orphan_file smell whose file appears in git status as new is filtered out."""
        new_file = "src/brand_new.py"
        smell = {"type": "orphan_file", "file_path": new_file}

        side_effects = self._make_mock_run(status_stdout=f"?? {new_file}\n")

        with patch("subprocess.run", side_effect=side_effects):
            result = _filter_actionable_smells_standalone([smell], str(tmp_path))

        assert result == []

    def test_standalone_filter_keeps_non_orphans(self, tmp_path):
        """feature_envy smell is kept even if the file is new."""
        new_file = "src/new_module.py"
        smell = {"type": "feature_envy", "file_path": new_file}

        side_effects = self._make_mock_run(status_stdout=f"?? {new_file}\n")

        with patch("subprocess.run", side_effect=side_effects):
            result = _filter_actionable_smells_standalone([smell], str(tmp_path))

        assert len(result) == 1
        assert result[0]["type"] == "feature_envy"

    def test_standalone_filter_git_fails(self, tmp_path):
        """When subprocess raises an exception, the original list is returned unfiltered."""
        smell = {"type": "orphan_file", "file_path": "src/some_file.py"}

        with patch("subprocess.run", side_effect=Exception("git not found")):
            result = _filter_actionable_smells_standalone([smell], str(tmp_path))

        # When git fails, new_files is empty → no orphan filtering → original list returned
        assert result == [smell]

    def test_standalone_filter_empty(self, tmp_path):
        """Empty input list returns empty list regardless of git state."""
        side_effects = self._make_mock_run()

        with patch("subprocess.run", side_effect=side_effects):
            result = _filter_actionable_smells_standalone([], str(tmp_path))

        assert result == []
