"""Tests for derive_implementation_checklist and format_checklist_for_prompt
in experience_memory.py.
"""
import json
import time
from pathlib import Path

import pytest

from workflow_manager.experience_memory import (
    ExperienceEntry,
    ExperienceMemoryStore,
    derive_implementation_checklist,
    format_checklist_for_prompt,
    _generalize_context_name,
    GLOBAL_MEMORY_FILE,
    PROJECT_MEMORIES_DIR,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_memory_json(path: Path, entries: list[dict]) -> None:
    """Write a mock experience_memory.json file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "entries": entries,
        "last_updated": "2026-01-01T00:00:00",
        "version": "1.0",
        "scope": "global",
        "project": None,
        "count": len(entries),
    }
    path.write_text(json.dumps(data))


def _make_entry(
    file_pattern: str,
    entry_type: str = "smell_introduced",
    occurrences: int = 3,
    confidence: float = 0.75,
    resolution: str = "",
) -> dict:
    return {
        "id": "test1234",
        "type": entry_type,
        "file_pattern": file_pattern,
        "keywords": ["test"],
        "domain": "api",
        "description": "test description",
        "severity": "medium",
        "confidence": confidence,
        "occurrences": occurrences,
        "first_seen": "2026-01-01T00:00:00",
        "last_seen": "2026-01-02T00:00:00",
        "project_origin": "my_project",
        "resolution": resolution,
        "related_files": [],
        "scope": "global",
    }


# ---------------------------------------------------------------------------
# derive_implementation_checklist tests
# ---------------------------------------------------------------------------

class TestDeriveImplementationChecklist:
    def test_derive_empty_stores(self, tmp_path, monkeypatch):
        """No experience files → returns empty checklist."""
        monkeypatch.setattr(
            "workflow_manager.experience_memory.GLOBAL_MEMORY_FILE",
            tmp_path / "nonexistent.json",
        )
        monkeypatch.setattr(
            "workflow_manager.experience_memory.PROJECT_MEMORIES_DIR",
            tmp_path / "projects",
        )

        result = derive_implementation_checklist(str(tmp_path))

        assert result["checklist"] == []
        assert result["derived_from"] == 0
        assert result["notes"] == []

    def test_derive_bounded_context(self, tmp_path, monkeypatch):
        """Entries with internal/*/domain patterns are grouped into checklist."""
        global_mem = tmp_path / "experience_memory.json"
        entries = [
            _make_entry("internal/orders/domain/order.go", occurrences=5),
            _make_entry("internal/sales/domain/sale.go", occurrences=3),
            _make_entry("internal/payments/application/service.go", occurrences=4),
        ]
        _write_memory_json(global_mem, entries)

        monkeypatch.setattr(
            "workflow_manager.experience_memory.GLOBAL_MEMORY_FILE",
            global_mem,
        )
        monkeypatch.setattr(
            "workflow_manager.experience_memory.PROJECT_MEMORIES_DIR",
            tmp_path / "projects",
        )

        result = derive_implementation_checklist(str(tmp_path), task_type="bounded_context")

        assert result["task_type"] == "bounded_context"
        assert len(result["checklist"]) > 0

        patterns = [item["pattern"] for item in result["checklist"]]
        # Generalized patterns should use {name} placeholder
        assert any("{name}" in p for p in patterns)

    def test_derive_min_occurrences_filter(self, tmp_path, monkeypatch):
        """Entries below min_occurrences threshold are excluded."""
        global_mem = tmp_path / "experience_memory.json"
        entries = [
            _make_entry("internal/orders/domain/entity.go", occurrences=1),
            _make_entry("internal/payments/domain/payment.go", occurrences=5),
        ]
        _write_memory_json(global_mem, entries)

        monkeypatch.setattr(
            "workflow_manager.experience_memory.GLOBAL_MEMORY_FILE",
            global_mem,
        )
        monkeypatch.setattr(
            "workflow_manager.experience_memory.PROJECT_MEMORIES_DIR",
            tmp_path / "projects",
        )

        result = derive_implementation_checklist(
            str(tmp_path), task_type="bounded_context", min_occurrences=3
        )

        # Only the entry with 5 occurrences should pass min_occurrences=3
        for item in result["checklist"]:
            assert item["occurrences"] >= 3

    def test_notes_extracted(self, tmp_path, monkeypatch):
        """High-confidence entries' resolutions appear in notes."""
        global_mem = tmp_path / "experience_memory.json"
        entries = [
            _make_entry(
                "internal/orders/domain/order.go",
                occurrences=10,
                confidence=0.90,
                resolution="Always use value objects for IDs.",
            ),
        ]
        _write_memory_json(global_mem, entries)

        monkeypatch.setattr(
            "workflow_manager.experience_memory.GLOBAL_MEMORY_FILE",
            global_mem,
        )
        monkeypatch.setattr(
            "workflow_manager.experience_memory.PROJECT_MEMORIES_DIR",
            tmp_path / "projects",
        )

        result = derive_implementation_checklist(str(tmp_path), task_type="bounded_context")

        assert any("value objects" in note for note in result["notes"])

    def test_derive_feature_task_type(self, tmp_path, monkeypatch):
        """Feature task type groups src/features/* entries correctly."""
        global_mem = tmp_path / "experience_memory.json"
        entries = [
            _make_entry("src/features/auth/components/LoginForm.tsx", occurrences=4),
            _make_entry("src/features/auth/hooks/useAuth.ts", occurrences=3),
        ]
        _write_memory_json(global_mem, entries)

        monkeypatch.setattr(
            "workflow_manager.experience_memory.GLOBAL_MEMORY_FILE",
            global_mem,
        )
        monkeypatch.setattr(
            "workflow_manager.experience_memory.PROJECT_MEMORIES_DIR",
            tmp_path / "projects",
        )

        result = derive_implementation_checklist(
            str(tmp_path), task_type="feature", min_occurrences=2
        )

        assert result["task_type"] == "feature"
        patterns = [item["pattern"] for item in result["checklist"]]
        assert any("{name}" in p for p in patterns)


# ---------------------------------------------------------------------------
# _generalize_context_name tests
# ---------------------------------------------------------------------------

class TestGeneralizeContextName:
    def test_bounded_context_generalization(self):
        result = _generalize_context_name("internal/sales/domain/order.go", "bounded_context")
        assert result == "internal/{name}/domain/order.go"

    def test_feature_generalization(self):
        result = _generalize_context_name("src/features/auth/components/Login.tsx", "feature")
        assert result == "src/features/{name}/components/Login.tsx"

    def test_other_task_type_unchanged(self):
        original = "migrations/0001_init.sql"
        result = _generalize_context_name(original, "migration")
        assert result == original


# ---------------------------------------------------------------------------
# format_checklist_for_prompt tests
# ---------------------------------------------------------------------------

class TestFormatChecklistForPrompt:
    def _sample_checklist(self, items=None, notes=None):
        return {
            "task_type": "bounded_context",
            "derived_from": 5,
            "checklist": items or [
                {
                    "pattern": "internal/{name}/domain/*.go",
                    "description": "Domain entities and value objects",
                    "occurrences": 5,
                    "examples": ["internal/orders/domain/order.go"],
                }
            ],
            "notes": notes or [],
        }

    def test_format_checklist_markdown(self):
        """Output is valid markdown with expected sections."""
        checklist = self._sample_checklist()
        output = format_checklist_for_prompt(checklist)

        assert "## Implementation Checklist" in output
        assert "bounded_context" in output
        assert "- [ ]" in output
        assert "`internal/{name}/domain/*.go`" in output

    def test_format_checklist_under_3000_chars(self):
        """Output is under 3000 chars for a normal checklist."""
        checklist = self._sample_checklist()
        output = format_checklist_for_prompt(checklist)

        assert len(output) <= 3000

    def test_format_checklist_truncation(self):
        """Very large checklist is truncated at 3000 chars."""
        many_items = [
            {
                "pattern": f"internal/{{name}}/domain/entity_{i}.go",
                "description": "Domain entities and value objects " + "x" * 200,
                "occurrences": 10,
                "examples": [f"internal/ctx{i}/domain/entity_{i}.go"],
            }
            for i in range(50)
        ]
        checklist = self._sample_checklist(items=many_items)
        output = format_checklist_for_prompt(checklist)

        assert len(output) <= 3100  # allow small margin for the truncation note
        assert "truncated" in output

    def test_format_checklist_notes_section(self):
        """Notes appear under 'Conventions observed' heading."""
        checklist = self._sample_checklist(notes=["Use value objects for IDs"])
        output = format_checklist_for_prompt(checklist)

        assert "Conventions observed" in output
        assert "Use value objects for IDs" in output

    def test_format_empty_checklist(self):
        """Empty checklist includes 'No recurring patterns' message."""
        checklist = {
            "task_type": "feature",
            "derived_from": 0,
            "checklist": [],
            "notes": [],
        }
        output = format_checklist_for_prompt(checklist)

        assert "No recurring patterns" in output

    def test_format_derived_from_shown(self):
        """derived_from count appears in output."""
        checklist = self._sample_checklist()
        output = format_checklist_for_prompt(checklist)

        assert "5" in output  # derived_from == 5
