"""Tests for project_metadata.py — ProjectMetadata discovery and persistence."""
import json
import time
from pathlib import Path

import pytest

from workflow_manager.project_metadata import ProjectMetadata


class TestDiscoverMigrationNumber:
    def test_discover_migration_number_found(self, tmp_path):
        """Numbered migration files → last/next numbers reported correctly."""
        mdir = tmp_path / "migrations"
        mdir.mkdir()
        (mdir / "000001_create_users.sql").write_text("-- migration")
        (mdir / "000025_add_index.sql").write_text("-- migration")
        (mdir / "000026_add_fk.sql").write_text("-- migration")

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_migration_number()

        assert result["last_number"] == "000026"
        assert result["next_number"] == "000027"
        assert result["directory"] == "migrations/"
        assert result["count"] == 3

    def test_discover_migration_number_empty(self, tmp_path):
        """No migrations directory → returns empty result."""
        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_migration_number()

        assert result["last_number"] is None
        assert result["next_number"] is None
        assert result["directory"] is None
        assert result["count"] == 0

    def test_discover_migration_number_db_subdir(self, tmp_path):
        """Migrations under db/migrations/ are detected."""
        mdir = tmp_path / "db" / "migrations"
        mdir.mkdir(parents=True)
        (mdir / "00001_init.sql").write_text("-- init")
        (mdir / "00003_add_col.sql").write_text("-- col")

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_migration_number()

        assert result["last_number"] is not None
        assert int(result["last_number"]) == 3

    def test_discover_migration_number_internal_subdir(self, tmp_path):
        """internal/*/migrations/ pattern is detected."""
        mdir = tmp_path / "internal" / "orders" / "migrations"
        mdir.mkdir(parents=True)
        (mdir / "0001_create_orders.sql").write_text("-- orders")
        (mdir / "0010_add_status.sql").write_text("-- status")

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_migration_number()

        assert result["last_number"] is not None
        assert int(result["last_number"]) == 10


class TestDiscoverIdPatterns:
    def test_discover_id_patterns_go_string(self, tmp_path):
        """Go files with 'type XxxID string' → pattern='string'."""
        domain_dir = tmp_path / "internal" / "orders" / "domain"
        domain_dir.mkdir(parents=True)
        (domain_dir / "order.go").write_text(
            "package domain\n\ntype OrderID string\ntype CustomerID string\n"
        )

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_id_patterns()

        assert result["pattern"] == "string"
        assert len(result["examples"]) >= 1

    def test_discover_id_patterns_go_uuid(self, tmp_path):
        """Go files with 'type XxxID uuid.UUID' → pattern='uuid'."""
        domain_dir = tmp_path / "internal" / "shop" / "domain"
        domain_dir.mkdir(parents=True)
        (domain_dir / "entity.go").write_text(
            "package domain\n\ntype ProductID uuid.UUID\ntype VendorID uuid.UUID\n"
        )

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_id_patterns()

        assert result["pattern"] == "uuid"

    def test_discover_id_patterns_no_domain_files(self, tmp_path):
        """No domain files → empty result."""
        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_id_patterns()

        assert result["pattern"] is None
        assert result["examples"] == []
        assert result["note"] is None


class TestDiscoverBoundedContexts:
    def test_discover_bounded_contexts(self, tmp_path):
        """Subdirectories of internal/ are returned as contexts."""
        internal = tmp_path / "internal"
        for ctx in ["orders", "payments", "users"]:
            (internal / ctx).mkdir(parents=True)

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_bounded_contexts()

        assert set(result["contexts"]) == {"orders", "payments", "users"}
        assert result["count"] == 3
        assert result["directory"] == "internal/"

    def test_discover_bounded_contexts_empty(self, tmp_path):
        """No internal/ directory → empty result."""
        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_bounded_contexts()

        assert result["contexts"] == []
        assert result["count"] == 0
        assert result["directory"] is None

    def test_discover_bounded_contexts_hidden_dirs_excluded(self, tmp_path):
        """Directories starting with '.' are excluded."""
        internal = tmp_path / "internal"
        internal.mkdir()
        (internal / "orders").mkdir()
        (internal / ".hidden").mkdir()

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_bounded_contexts()

        assert ".hidden" not in result["contexts"]
        assert "orders" in result["contexts"]


class TestDiscoverTechStack:
    def test_discover_tech_stack_go_typescript(self, tmp_path):
        """go.mod + package.json with typescript → both languages detected."""
        (tmp_path / "go.mod").write_text("module example.com/myapp\n\ngo 1.21\n")
        (tmp_path / "package.json").write_text(json.dumps({
            "dependencies": {"typescript": "^5.0.0"}
        }))

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_tech_stack()

        assert "go" in result["languages"]
        assert "typescript" in result["languages"]

    def test_discover_tech_stack_python_only(self, tmp_path):
        """pyproject.toml → python detected."""
        (tmp_path / "pyproject.toml").write_text("[build-system]\n")

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_tech_stack()

        assert "python" in result["languages"]
        assert result["test_runner"] == "pytest"

    def test_discover_tech_stack_go_frameworks(self, tmp_path):
        """go.mod with gin import → gin detected as framework."""
        go_mod = (
            "module example.com/myapp\n\n"
            "go 1.21\n\n"
            "require github.com/gin-gonic/gin v1.9.0\n"
        )
        (tmp_path / "go.mod").write_text(go_mod)

        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_tech_stack()

        assert "gin" in result["frameworks"]

    def test_discover_tech_stack_empty_dir(self, tmp_path):
        """Empty directory → no languages."""
        pm = ProjectMetadata(str(tmp_path))
        result = pm.discover_tech_stack()

        assert result["languages"] == []
        assert result["frameworks"] == []
        assert result["test_runner"] is None


class TestSaveLoadRoundTrip:
    def test_save_load_round_trip(self, tmp_path):
        """Save metadata then load it back, verify equality."""
        project_dir = str(tmp_path / "project")
        state_dir = str(tmp_path / "state")
        Path(project_dir).mkdir()

        pm = ProjectMetadata(project_dir)
        pm._cache = {
            "migration_number": {"last_number": "000005", "next_number": "000006",
                                  "directory": "migrations/", "count": 5},
            "id_patterns": {"pattern": "string", "examples": [], "note": None},
            "bounded_contexts": {"contexts": ["orders"], "count": 1, "directory": "internal/"},
            "tech_stack": {"languages": ["go"], "frameworks": [], "test_runner": "go test",
                           "frontend_test": None, "test_patterns": {}},
            "project_structure": {"directories": {}, "entry_points": []},
            "_discovered_at": "2026-01-01T00:00:00",
        }
        pm.save(state_dir)

        loaded = ProjectMetadata.load(project_dir, state_dir)

        assert loaded is not None
        assert loaded._cache == pm._cache

    def test_load_stale_cache(self, tmp_path):
        """Cache file older than 1 hour returns None."""
        project_dir = str(tmp_path / "project")
        state_dir = str(tmp_path / "state")
        Path(project_dir).mkdir()

        pm = ProjectMetadata(project_dir)
        pm._cache = {"_discovered_at": "2026-01-01T00:00:00"}
        pm.save(state_dir)

        # Backdate the file by 2 hours
        cache_path = Path(state_dir) / "metadata.json"
        old_time = time.time() - 7200
        import os
        os.utime(str(cache_path), (old_time, old_time))

        loaded = ProjectMetadata.load(project_dir, state_dir)
        assert loaded is None

    def test_load_missing_file(self, tmp_path):
        """Missing cache file returns None."""
        loaded = ProjectMetadata.load(str(tmp_path), str(tmp_path / "nonexistent"))
        assert loaded is None
