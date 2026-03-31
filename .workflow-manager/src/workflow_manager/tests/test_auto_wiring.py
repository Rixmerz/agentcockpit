"""Tests for auto-wiring integration: metadata/pattern refresh on activate,
trend tracking, and security cache reading by the dcc_feedback hook.
"""
import json
from pathlib import Path

import pytest

from workflow_manager.project_metadata import ProjectMetadata
from workflow_manager.pattern_catalog import PatternCatalog
from workflow_manager.trend_tracker import record_snapshot, get_trend, format_trend_summary


# =============================================================================
# TestProjectMetadataDiscovery
# =============================================================================

class TestProjectMetadataDiscovery:
    def test_discover_migration_go(self, tmp_path):
        """migrations/000026_foo.up.sql → last_number='000026', next_number='000027'."""
        mdir = tmp_path / "migrations"
        mdir.mkdir()
        (mdir / "000026_foo.up.sql").write_text("-- up migration")

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_migration_number()

        assert result["last_number"] == "000026"
        assert result["next_number"] == "000027"

    def test_discover_migration_none(self, tmp_path):
        """Empty dir with no migrations → all fields None/0."""
        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_migration_number()

        assert result["last_number"] is None
        assert result["next_number"] is None
        assert result["directory"] is None
        assert result["count"] == 0

    def test_discover_tech_stack_detects_go(self, tmp_path):
        """go.mod with 'module example.com' → 'go' in languages."""
        (tmp_path / "go.mod").write_text("module example.com\n\ngo 1.22\n")

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_tech_stack()

        assert "go" in result["languages"]

    def test_discover_tech_stack_detects_ts(self, tmp_path):
        """package.json with react dependency → 'typescript' or 'javascript' in languages."""
        pkg = {"dependencies": {"react": "19"}}
        (tmp_path / "package.json").write_text(json.dumps(pkg))

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_tech_stack()

        detected_langs = result["languages"]
        assert "typescript" in detected_langs or "javascript" in detected_langs

    def test_discover_bounded_contexts(self, tmp_path):
        """internal/sales/ and internal/inventory/ both appear in contexts list."""
        internal = tmp_path / "internal"
        (internal / "sales").mkdir(parents=True)
        (internal / "inventory").mkdir(parents=True)

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_bounded_contexts()

        assert "sales" in result["contexts"]
        assert "inventory" in result["contexts"]

    def test_save_load_round_trip(self, tmp_path):
        """discover_all() → save() → load() reproduces identical data."""
        project_dir = tmp_path / "project"
        state_dir = tmp_path / "state"
        project_dir.mkdir()

        # Create a minimal Go project so discover_all has something to find
        (project_dir / "go.mod").write_text("module example.com\n\ngo 1.22\n")
        mig = project_dir / "migrations"
        mig.mkdir()
        (mig / "000003_init.sql").write_text("-- init")

        pm = ProjectMetadata(str(project_dir))
        original_data = pm.discover_all()
        pm.save(str(state_dir))

        loaded = ProjectMetadata.load(str(project_dir), str(state_dir))

        assert loaded is not None
        # Timestamps may differ slightly, compare meaningful sections
        assert loaded.get("migration_number") == original_data["migration_number"]
        assert loaded.get("tech_stack")["languages"] == original_data["tech_stack"]["languages"]


# =============================================================================
# TestPatternCatalogDiscovery
# =============================================================================

class TestPatternCatalogDiscovery:
    def test_discover_finds_go_repo(self, tmp_path):
        """infrastructure/order_repo.go → 'repository' pattern found."""
        repo_dir = tmp_path / "internal" / "sales" / "infrastructure"
        repo_dir.mkdir(parents=True)
        (repo_dir / "order_repo.go").write_text(
            "package infrastructure\n\ntype OrderRepo struct{}\n\n"
            "func (r *OrderRepo) FindByID(id string) (*Order, error) {\n\treturn nil, nil\n}\n"
        )

        catalog = PatternCatalog(str(tmp_path))
        catalog.discover_all()

        assert "repository" in catalog.patterns

    def test_discover_finds_test(self, tmp_path):
        """domain/order_test.go → 'test_unit' pattern found."""
        domain_dir = tmp_path / "internal" / "sales" / "domain"
        domain_dir.mkdir(parents=True)
        (domain_dir / "order_test.go").write_text(
            "package domain\n\nimport \"testing\"\n\n"
            "func TestOrder_NewOrder(t *testing.T) {\n\tt.Log(\"ok\")\n}\n"
        )

        catalog = PatternCatalog(str(tmp_path))
        catalog.discover_all()

        assert "test_unit" in catalog.patterns

    def test_discover_empty_project(self, tmp_path):
        """Empty directory → empty patterns dict."""
        catalog = PatternCatalog(str(tmp_path))
        catalog.discover_all()

        assert catalog.patterns == {}

    def test_to_prompt_injection_format(self, tmp_path):
        """Manually added pattern → output contains triple-backtick code blocks."""
        catalog = PatternCatalog(str(tmp_path))
        catalog.patterns = {
            "repository": {
                "source_file": "internal/sales/infrastructure/order_repo.go",
                "language": "go",
                "snippet": "type OrderRepo struct{}",
            }
        }

        output = catalog.to_prompt_injection()

        assert "```" in output
        assert "```go" in output
        assert "OrderRepo" in output

    def test_prompt_injection_budget(self, tmp_path):
        """Each pattern's snippet is capped at 2000 chars (no single pattern overflows)."""
        # Generate a snippet well over 2000 chars
        long_snippet = "// line\n" * 400  # ~3200 chars
        catalog = PatternCatalog(str(tmp_path))
        catalog.patterns = {
            "handler": {
                "source_file": "internal/handler.go",
                "language": "go",
                "snippet": long_snippet,
            }
        }

        output = catalog.to_prompt_injection()

        # The snippet itself may be long in the output (the catalog stores whatever
        # was extracted), but verify the prompt injection doesn't crash and returns
        # a non-empty string with a code block.
        assert "```" in output
        assert len(output) > 0

        # Verify that _extract_snippet itself respects the budget when used live
        go_file = tmp_path / "big.go"
        go_file.write_text(long_snippet)
        snippet = catalog._extract_snippet(go_file)
        assert len(snippet) <= 2000


# =============================================================================
# TestTrendTrackerIntegration
# =============================================================================

class TestTrendTrackerIntegration:
    def test_record_and_retrieve(self, tmp_path):
        """Record 3 snapshots with different smell_counts, get_trend returns all 3."""
        project_dir = str(tmp_path / "project")
        state_dir = str(tmp_path / "state")
        Path(project_dir).mkdir()

        record_snapshot(project_dir, state_dir, {"smell_count": 50})
        record_snapshot(project_dir, state_dir, {"smell_count": 45})
        record_snapshot(project_dir, state_dir, {"smell_count": 42})

        trend = get_trend(project_dir, state_dir)

        assert len(trend) == 3
        counts = [e["smell_count"] for e in trend]
        assert counts == [50, 45, 42]

    def test_format_shows_delta(self, tmp_path):
        """format_trend_summary with smell_count 50→42 contains '50→42'."""
        project_dir = str(tmp_path / "project")
        state_dir = str(tmp_path / "state")
        Path(project_dir).mkdir()

        record_snapshot(project_dir, state_dir, {"smell_count": 50})
        record_snapshot(project_dir, state_dir, {"smell_count": 42})

        summary = format_trend_summary(project_dir, state_dir)

        assert "50→42" in summary

    def test_trends_persist_across_loads(self, tmp_path):
        """Record a snapshot, create a fresh load, data is still present."""
        project_dir = str(tmp_path / "project")
        state_dir = str(tmp_path / "state")
        Path(project_dir).mkdir()

        record_snapshot(project_dir, state_dir, {"smell_count": 10, "risk_grade": "B"})

        # Fresh retrieval (simulates a new process reading from disk)
        trend = get_trend(project_dir, state_dir)

        assert len(trend) == 1
        assert trend[0]["smell_count"] == 10
        assert trend[0]["risk_grade"] == "B"


# =============================================================================
# TestSecurityCacheReading
# Tests that dcc_feedback.py's security block logic works correctly.
# We replicate the logic inline (the hook is not an importable module).
# =============================================================================

def _read_security_cache(project_path: str) -> str | None:
    """Replicate the security-cache reading block from dcc_feedback.py.

    Returns the formatted message string when findings exist, or None otherwise.
    Never raises.
    """
    try:
        import os
        sec_cache = os.path.join(project_path, ".agentcockpit", "security-scan.json")
        if not os.path.exists(sec_cache):
            return None
        with open(sec_cache, "r") as f:
            scan = json.load(f)
        critical = scan.get("criticalCount", 0)
        high = scan.get("highCount", 0)
        if critical > 0 or high > 0:
            parts = []
            if critical > 0:
                parts.append(f"{critical} CRITICAL")
            if high > 0:
                parts.append(f"{high} high")
            return (
                f"\U0001f512 Security: {', '.join(parts)} findings "
                f"(grade {scan.get('riskGrade', '?')})"
                " \u2014 use cube_get_findings() for details"
            )
        return None
    except Exception:
        return None


class TestSecurityCacheReading:
    def test_reads_cache_with_findings(self, tmp_path):
        """Cache with criticalCount=1 and highCount=2 → security warning message."""
        agentcockpit_dir = tmp_path / ".agentcockpit"
        agentcockpit_dir.mkdir()
        (agentcockpit_dir / "security-scan.json").write_text(json.dumps({
            "criticalCount": 1,
            "highCount": 2,
            "riskGrade": "C",
        }))

        result = _read_security_cache(str(tmp_path))

        assert result is not None
        assert "CRITICAL" in result
        assert "high" in result
        assert "grade C" in result

    def test_reads_cache_no_findings(self, tmp_path):
        """Cache with criticalCount=0 and highCount=0 → no output."""
        agentcockpit_dir = tmp_path / ".agentcockpit"
        agentcockpit_dir.mkdir()
        (agentcockpit_dir / "security-scan.json").write_text(json.dumps({
            "criticalCount": 0,
            "highCount": 0,
        }))

        result = _read_security_cache(str(tmp_path))

        assert result is None

    def test_missing_cache_no_error(self, tmp_path):
        """No security-scan.json file → returns None without raising."""
        result = _read_security_cache(str(tmp_path))

        assert result is None
