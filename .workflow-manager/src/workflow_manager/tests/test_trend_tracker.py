"""Tests for trend_tracker.py — record_snapshot, get_trend, format_trend_summary."""
import json
from datetime import datetime, timedelta

import pytest

from workflow_manager.trend_tracker import format_trend_summary, get_trend, record_snapshot


# ---------------------------------------------------------------------------
# TestRecordSnapshot
# ---------------------------------------------------------------------------

class TestRecordSnapshot:
    def test_record_first_snapshot(self, tmp_path):
        """Empty trends file: recording one snapshot creates the file with one entry."""
        state_dir = str(tmp_path)
        project_dir = "/some/project"

        result = record_snapshot(project_dir, state_dir, metrics={"smell_count": 5})

        trends_path = tmp_path / "trends.json"
        assert trends_path.exists()
        data = json.loads(trends_path.read_text(encoding="utf-8"))
        assert len(data) == 1
        assert data[0]["smell_count"] == 5
        assert "timestamp" in data[0]
        assert result["smell_count"] == 5

    def test_record_appends(self, tmp_path):
        """Recording 3 snapshots results in all 3 stored in the file."""
        state_dir = str(tmp_path)
        project_dir = "/some/project"

        record_snapshot(project_dir, state_dir, metrics={"smell_count": 10})
        record_snapshot(project_dir, state_dir, metrics={"smell_count": 8})
        record_snapshot(project_dir, state_dir, metrics={"smell_count": 6})

        data = json.loads((tmp_path / "trends.json").read_text(encoding="utf-8"))
        assert len(data) == 3
        assert [e["smell_count"] for e in data] == [10, 8, 6]

    def test_record_max_500(self, tmp_path):
        """After 501 entries the file retains only the last 500."""
        state_dir = str(tmp_path)
        project_dir = "/some/project"

        # Pre-populate with 501 entries directly to avoid slow loop
        entries = [
            {"timestamp": datetime.now().isoformat(), "project": "project", "smell_count": i}
            for i in range(501)
        ]
        (tmp_path / "trends.json").write_text(json.dumps(entries), encoding="utf-8")

        # Recording one more should trigger the 500-cap trim
        record_snapshot(project_dir, state_dir, metrics={"smell_count": 999})

        data = json.loads((tmp_path / "trends.json").read_text(encoding="utf-8"))
        assert len(data) == 500
        # The last entry should be the one we just added
        assert data[-1]["smell_count"] == 999

    def test_record_with_metrics(self, tmp_path):
        """Metrics dict is stored verbatim in the snapshot."""
        state_dir = str(tmp_path)

        result = record_snapshot("/proj", state_dir, metrics={"smell_count": 42, "debt_score": 7})

        assert result["smell_count"] == 42
        assert result["debt_score"] == 7

    def test_record_no_metrics(self, tmp_path):
        """Passing None for metrics still creates a snapshot with a timestamp."""
        state_dir = str(tmp_path)

        result = record_snapshot("/proj", state_dir, metrics=None)

        assert "timestamp" in result
        assert result["project"] == "proj"


# ---------------------------------------------------------------------------
# TestGetTrend
# ---------------------------------------------------------------------------

class TestGetTrend:
    def test_get_all_metrics(self, tmp_path):
        """Recording 3 snapshots then calling get_trend returns all 3 entries."""
        state_dir = str(tmp_path)
        project_dir = "/some/project"

        for i in range(3):
            record_snapshot(project_dir, state_dir, metrics={"smell_count": i})

        result = get_trend(project_dir, state_dir)

        assert len(result) == 3

    def test_get_single_metric(self, tmp_path):
        """Filtering by metric name returns only timestamp + value pairs."""
        state_dir = str(tmp_path)
        project_dir = "/some/project"

        record_snapshot(project_dir, state_dir, metrics={"smell_count": 5, "debt_score": 3})
        record_snapshot(project_dir, state_dir, metrics={"smell_count": 4, "debt_score": 2})

        result = get_trend(project_dir, state_dir, metric="smell_count")

        assert len(result) == 2
        assert all("value" in entry for entry in result)
        assert all("timestamp" in entry for entry in result)
        assert result[0]["value"] == 5
        assert result[1]["value"] == 4
        # Should NOT include debt_score key
        assert all("debt_score" not in entry for entry in result)

    def test_get_empty(self, tmp_path):
        """When no trends file exists, get_trend returns an empty list."""
        result = get_trend("/some/project", str(tmp_path))

        assert result == []

    def test_get_filters_by_days(self, tmp_path):
        """Entries older than `days` are excluded from results."""
        state_dir = str(tmp_path)

        # Write entries manually: one 40 days old, one recent
        old_ts = (datetime.now() - timedelta(days=40)).isoformat()
        new_ts = datetime.now().isoformat()
        entries = [
            {"timestamp": old_ts, "project": "project", "smell_count": 99},
            {"timestamp": new_ts, "project": "project", "smell_count": 1},
        ]
        (tmp_path / "trends.json").write_text(json.dumps(entries), encoding="utf-8")

        result = get_trend("/some/project", state_dir, days=1)

        assert len(result) == 1
        assert result[0]["smell_count"] == 1


# ---------------------------------------------------------------------------
# TestFormatTrendSummary
# ---------------------------------------------------------------------------

class TestFormatTrendSummary:
    def test_format_with_changes(self, tmp_path):
        """First snapshot smell_count=50, last=42 → output contains 'Smells: 50→42 (-8)'."""
        state_dir = str(tmp_path)

        # Use recent timestamps (within default 30-day window) so get_trend returns them
        t1 = (datetime.now() - timedelta(days=2)).isoformat()
        t2 = (datetime.now() - timedelta(days=1)).isoformat()
        entries = [
            {"timestamp": t1, "project": "project", "smell_count": 50},
            {"timestamp": t2, "project": "project", "smell_count": 42},
        ]
        (tmp_path / "trends.json").write_text(json.dumps(entries), encoding="utf-8")

        result = format_trend_summary("/some/project", state_dir)

        assert "Smells: 50→42 (-8)" in result

    def test_format_insufficient_data(self, tmp_path):
        """Only 1 snapshot → returns the 'Insufficient data' message."""
        state_dir = str(tmp_path)

        record_snapshot("/proj", state_dir, metrics={"smell_count": 10})

        result = format_trend_summary("/proj", state_dir)

        assert "Insufficient data" in result

    def test_format_no_changes(self, tmp_path):
        """Snapshots with no tracked metric keys → returns 'No changes detected'."""
        state_dir = str(tmp_path)

        t1 = (datetime.now() - timedelta(days=2)).isoformat()
        t2 = (datetime.now() - timedelta(days=1)).isoformat()
        # None of the tracked keys (smell_count, tension_count, debt_score,
        # findings_count, risk_grade) are present in either entry.
        entries = [
            {"timestamp": t1, "project": "project", "custom_metric": 5},
            {"timestamp": t2, "project": "project", "custom_metric": 5},
        ]
        (tmp_path / "trends.json").write_text(json.dumps(entries), encoding="utf-8")

        result = format_trend_summary("/some/project", state_dir)

        assert result == "No changes detected"

    def test_format_multiple_metrics(self, tmp_path):
        """smell_count, debt_score, and findings_count all changing → all appear in output."""
        state_dir = str(tmp_path)

        t1 = (datetime.now() - timedelta(days=2)).isoformat()
        t2 = (datetime.now() - timedelta(days=1)).isoformat()
        entries = [
            {
                "timestamp": t1,
                "project": "project",
                "smell_count": 20,
                "debt_score": 15,
                "findings_count": 5,
            },
            {
                "timestamp": t2,
                "project": "project",
                "smell_count": 18,
                "debt_score": 12,
                "findings_count": 3,
            },
        ]
        (tmp_path / "trends.json").write_text(json.dumps(entries), encoding="utf-8")

        result = format_trend_summary("/some/project", state_dir)

        assert "Smells:" in result
        assert "Debt:" in result
        assert "Findings:" in result
