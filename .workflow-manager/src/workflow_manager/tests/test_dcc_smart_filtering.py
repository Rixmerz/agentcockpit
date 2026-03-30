"""Tests for _get_new_files and _filter_actionable_smells in dcc_integration.py."""
import time
from unittest.mock import patch, MagicMock

import pytest

from workflow_manager.dcc_integration import _get_new_files, _filter_actionable_smells


# ---------------------------------------------------------------------------
# _get_new_files tests
# ---------------------------------------------------------------------------

class TestGetNewFiles:
    def test_get_new_files_empty_repo(self, tmp_path):
        """When git is not available or fails, returns empty set."""
        failed = MagicMock()
        failed.returncode = 128
        failed.stdout = ""

        with patch("workflow_manager.dcc_integration.subprocess.run", return_value=failed):
            result = _get_new_files(str(tmp_path))

        assert result == set()

    def test_get_new_files_untracked_file(self, tmp_path):
        """Untracked files (XY code '??') are returned as absolute paths."""
        status_result = MagicMock()
        status_result.returncode = 0
        status_result.stdout = "?? new_file.py\n"

        diff_result = MagicMock()
        diff_result.returncode = 0
        diff_result.stdout = ""

        with patch("workflow_manager.dcc_integration.subprocess.run",
                   side_effect=[status_result, diff_result]):
            result = _get_new_files(str(tmp_path))

        assert str(tmp_path / "new_file.py") in result

    def test_get_new_files_staged_new(self, tmp_path):
        """Files staged as added (XY code 'A ') are included."""
        status_result = MagicMock()
        status_result.returncode = 0
        status_result.stdout = "A  staged_new.py\n"

        diff_result = MagicMock()
        diff_result.returncode = 0
        diff_result.stdout = ""

        with patch("workflow_manager.dcc_integration.subprocess.run",
                   side_effect=[status_result, diff_result]):
            result = _get_new_files(str(tmp_path))

        assert str(tmp_path / "staged_new.py") in result

    def test_get_new_files_diff_head(self, tmp_path):
        """Files added since HEAD~1 via diff are included."""
        status_result = MagicMock()
        status_result.returncode = 0
        status_result.stdout = ""

        diff_result = MagicMock()
        diff_result.returncode = 0
        diff_result.stdout = "src/added_in_last_commit.py\n"

        with patch("workflow_manager.dcc_integration.subprocess.run",
                   side_effect=[status_result, diff_result]):
            result = _get_new_files(str(tmp_path))

        assert str(tmp_path / "src/added_in_last_commit.py") in result

    def test_get_new_files_renamed_arrow_format(self, tmp_path):
        """Added-then-renamed files (A  old.py -> new.py) return the destination."""
        # XY='A ' means added in index, rename format triggers arrow split
        status_result = MagicMock()
        status_result.returncode = 0
        status_result.stdout = "A  old.py -> new.py\n"

        diff_result = MagicMock()
        diff_result.returncode = 0
        diff_result.stdout = ""

        with patch("workflow_manager.dcc_integration.subprocess.run",
                   side_effect=[status_result, diff_result]):
            result = _get_new_files(str(tmp_path))

        assert str(tmp_path / "new.py") in result


# ---------------------------------------------------------------------------
# _filter_actionable_smells tests
# ---------------------------------------------------------------------------

class TestFilterActionableSmells:
    def _make_smell(self, smell_type="orphan_file", file_path="src/orphan.py"):
        return {"type": smell_type, "file": file_path}

    def test_filter_no_smells(self, tmp_path):
        """Empty list returns empty list with 0 suppressed."""
        with patch("workflow_manager.dcc_integration._get_new_files", return_value=set()):
            result, suppressed = _filter_actionable_smells([], str(tmp_path))

        assert result == []
        assert suppressed == 0

    def test_filter_orphans_new_files(self, tmp_path):
        """Orphan smell for a file in new_files set is suppressed."""
        orphan_file = str(tmp_path / "src" / "brand_new.py")
        smell = {"type": "orphan_file", "file": orphan_file}

        with patch("workflow_manager.dcc_integration._get_new_files",
                   return_value={orphan_file}):
            result, suppressed = _filter_actionable_smells([smell], str(tmp_path))

        assert result == []
        assert suppressed == 1

    def test_filter_orphans_recent_files(self, tmp_path):
        """Orphan smell for a file with recent mtime is suppressed."""
        recent_file = tmp_path / "src" / "recent.py"
        recent_file.parent.mkdir(parents=True, exist_ok=True)
        recent_file.write_text("# new file")

        smell = {"type": "orphan_file", "file": str(recent_file)}

        with patch("workflow_manager.dcc_integration._get_new_files", return_value=set()):
            # mtime is effectively now — well within 30 minutes
            result, suppressed = _filter_actionable_smells([smell], str(tmp_path))

        assert result == []
        assert suppressed == 1

    def test_filter_orphans_old_files_kept(self, tmp_path):
        """Orphan smell for an old file is NOT suppressed."""
        old_file = tmp_path / "src" / "old.py"
        old_file.parent.mkdir(parents=True, exist_ok=True)
        old_file.write_text("# old file")

        smell = {"type": "orphan_file", "file": str(old_file)}

        # Simulate old mtime (2 hours ago)
        old_mtime = time.time() - 7200
        with patch("workflow_manager.dcc_integration._get_new_files", return_value=set()):
            with patch("workflow_manager.dcc_integration.time.time", return_value=time.time()):
                with patch("pathlib.Path.stat") as mock_stat:
                    mock_stat.return_value.st_mtime = old_mtime
                    result, suppressed = _filter_actionable_smells([smell], str(tmp_path))

        assert len(result) == 1
        assert suppressed == 0

    def test_filter_baseline_existing(self, tmp_path):
        """Smells matching baseline are suppressed regardless of type."""
        smell = {"type": "god_file", "file": "src/big.py"}
        baseline = [{"type": "god_file", "file": "src/big.py"}]

        with patch("workflow_manager.dcc_integration._get_new_files", return_value=set()):
            result, suppressed = _filter_actionable_smells(
                [smell], str(tmp_path), baseline_smells=baseline
            )

        assert result == []
        assert suppressed == 1

    def test_filter_non_orphan_kept(self, tmp_path):
        """Non-orphan smells (feature_envy, god_file) pass through even for new files."""
        new_file = str(tmp_path / "new_module.py")
        smell_fe = {"type": "feature_envy", "file": new_file}
        smell_gf = {"type": "god_file", "file": new_file}

        with patch("workflow_manager.dcc_integration._get_new_files",
                   return_value={new_file}):
            result, suppressed = _filter_actionable_smells(
                [smell_fe, smell_gf], str(tmp_path)
            )

        assert len(result) == 2
        assert suppressed == 0

    def test_filter_for_validate_skips_all(self, tmp_path):
        """When filter_for_validate=True all smells are returned unfiltered."""
        orphan_file = str(tmp_path / "brand_new.py")
        smells = [
            {"type": "orphan_file", "file": orphan_file},
            {"type": "god_file", "file": orphan_file},
        ]
        baseline = [{"type": "orphan_file", "file": orphan_file}]

        result, suppressed = _filter_actionable_smells(
            smells, str(tmp_path),
            baseline_smells=baseline,
            filter_for_validate=True,
        )

        assert result is smells
        assert suppressed == 0

    def test_noise_filtered_count(self, tmp_path):
        """suppressed count correctly reflects how many were removed."""
        new_file1 = str(tmp_path / "a.py")
        new_file2 = str(tmp_path / "b.py")
        smells = [
            {"type": "orphan_file", "file": new_file1},
            {"type": "orphan_file", "file": new_file2},
            {"type": "god_file", "file": new_file1},
        ]

        with patch("workflow_manager.dcc_integration._get_new_files",
                   return_value={new_file1, new_file2}):
            result, suppressed = _filter_actionable_smells(smells, str(tmp_path))

        # 2 orphans suppressed, god_file passes
        assert suppressed == 2
        assert len(result) == 1
        assert result[0]["type"] == "god_file"

    def test_filter_graceful_on_missing_fields(self, tmp_path):
        """Smells with missing type or file fields don't crash the filter."""
        smells = [
            {},
            {"type": "orphan_file"},
            {"file": "some/file.py"},
            {"type": "god_file", "file": None},
        ]

        with patch("workflow_manager.dcc_integration._get_new_files", return_value=set()):
            result, suppressed = _filter_actionable_smells(smells, str(tmp_path))

        # Should not raise; all pass through (no file to match on for orphan checks)
        assert isinstance(result, list)
        assert isinstance(suppressed, int)

    def test_filter_uses_source_field_fallback(self, tmp_path):
        """Smells using 'source' instead of 'file' are handled correctly."""
        new_file = str(tmp_path / "src" / "new.py")
        smell = {"type": "orphan_file", "source": new_file}

        with patch("workflow_manager.dcc_integration._get_new_files",
                   return_value={new_file}):
            result, suppressed = _filter_actionable_smells([smell], str(tmp_path))

        assert result == []
        assert suppressed == 1
