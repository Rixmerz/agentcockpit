"""Tests for .claude/hooks/experience_recorder.py (helper functions only, no main())."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from experience_recorder import (
    _generalize_path,
    _parse_commit_type,
    _load_store,
    _find_duplicate,
    _upsert_entry,
)


# ---------------------------------------------------------------------------
# _generalize_path
# ---------------------------------------------------------------------------

def test_generalize_path_camel_case_service():
    result = _generalize_path("src/services/authService.ts")
    assert result == "src/services/*Service.ts"


def test_generalize_path_pascal_case_form():
    result = _generalize_path("src/components/LoginForm.tsx")
    assert result == "src/components/*Form.tsx"


def test_generalize_path_generic_name_helpers():
    # "helpers" has no recognizable camelCase/PascalCase suffix — should produce *.ts
    result = _generalize_path("src/utils/helpers.ts")
    assert result == "src/utils/*.ts"


def test_generalize_path_camel_case_repository():
    result = _generalize_path("src/data/userRepository.ts")
    assert result == "src/data/*Repository.ts"


def test_generalize_path_pascal_two_words_modal():
    result = _generalize_path("src/components/UserModal.tsx")
    assert result == "src/components/*Modal.tsx"


def test_generalize_path_preserves_extension():
    result = _generalize_path("src/services/authService.py")
    assert result.endswith(".py")


def test_generalize_path_preserves_parent_directory():
    result = _generalize_path("src/services/authService.ts")
    assert result.startswith("src/services/")


def test_generalize_path_single_word_no_camel():
    # A single PascalCase word with no suffix match → generic *.ext
    result = _generalize_path("src/utils/index.ts")
    assert result == "src/utils/*.ts"


# ---------------------------------------------------------------------------
# _parse_commit_type
# ---------------------------------------------------------------------------

def test_parse_commit_type_fix():
    assert _parse_commit_type("fix: login redirect loop") == "bug_fix"


def test_parse_commit_type_feat():
    assert _parse_commit_type("feat: add auth service") == "feature_pattern"


def test_parse_commit_type_refactor():
    assert _parse_commit_type("refactor: extract hook") == "refactor_pattern"


def test_parse_commit_type_chore():
    assert _parse_commit_type("chore: update deps") == "general"


def test_parse_commit_type_perf():
    assert _parse_commit_type("perf: reduce re-renders") == "performance_fix"


def test_parse_commit_type_unknown():
    assert _parse_commit_type("docs: update README") == "general"


def test_parse_commit_type_case_insensitive_fix():
    assert _parse_commit_type("Fix: uppercase start") == "bug_fix"


def test_parse_commit_type_case_insensitive_feat():
    assert _parse_commit_type("Feat: uppercase start") == "feature_pattern"


def test_parse_commit_type_empty_string():
    assert _parse_commit_type("") == "general"


# ---------------------------------------------------------------------------
# _load_store
# ---------------------------------------------------------------------------

def test_load_store_missing_file(tmp_path):
    path = tmp_path / "nonexistent.json"
    store = _load_store(path)
    assert store == {"entries": [], "version": 1}


def test_load_store_invalid_json(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text("not json at all", encoding="utf-8")
    store = _load_store(path)
    assert store == {"entries": [], "version": 1}


def test_load_store_valid_file(tmp_path):
    import json
    path = tmp_path / "store.json"
    data = {"entries": [{"type": "bug_fix"}], "version": 1}
    path.write_text(json.dumps(data), encoding="utf-8")
    store = _load_store(path)
    assert len(store["entries"]) == 1
    assert store["entries"][0]["type"] == "bug_fix"


def test_load_store_adds_entries_key_if_missing(tmp_path):
    import json
    path = tmp_path / "store.json"
    path.write_text(json.dumps({"version": 1}), encoding="utf-8")
    store = _load_store(path)
    assert "entries" in store
    assert store["entries"] == []


def test_load_store_non_dict_returns_default(tmp_path):
    import json
    path = tmp_path / "store.json"
    path.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
    store = _load_store(path)
    assert store == {"entries": [], "version": 1}


# ---------------------------------------------------------------------------
# _find_duplicate
# ---------------------------------------------------------------------------

def test_find_duplicate_found():
    entries = [
        {"type": "bug_fix", "file_pattern": "src/*.ts", "description": "fix auth"},
        {"type": "feature_pattern", "file_pattern": "src/*.tsx", "description": "add modal"},
    ]
    idx = _find_duplicate(entries, "bug_fix", "src/*.ts", "fix auth")
    assert idx == 0


def test_find_duplicate_not_found():
    entries = [
        {"type": "bug_fix", "file_pattern": "src/*.ts", "description": "fix auth"},
    ]
    idx = _find_duplicate(entries, "feature_pattern", "src/*.ts", "fix auth")
    assert idx == -1


def test_find_duplicate_empty_entries():
    assert _find_duplicate([], "bug_fix", "src/*.ts", "fix auth") == -1


def test_find_duplicate_requires_all_three_fields():
    entries = [{"type": "bug_fix", "file_pattern": "src/*.ts", "description": "fix auth"}]
    # Different description — should not match
    assert _find_duplicate(entries, "bug_fix", "src/*.ts", "other") == -1
    # Different pattern — should not match
    assert _find_duplicate(entries, "bug_fix", "src/*.js", "fix auth") == -1


# ---------------------------------------------------------------------------
# _upsert_entry
# ---------------------------------------------------------------------------

def _make_entry(commit_type="bug_fix", pattern="src/*.ts", desc="fix X", resolution=""):
    return {
        "type": commit_type,
        "file_pattern": pattern,
        "description": desc,
        "resolution": resolution,
        "confidence": 0.5,
        "occurrences": 1,
        "last_seen": "2026-01-01T00:00:00+00:00",
        "domain": "auth",
        "keywords": ["auth"],
        "severity": "medium",
        "project_origin": "proj",
        "commit_hash": "abc123",
    }


def test_upsert_entry_adds_new():
    entries = []
    entry = _make_entry()
    result = _upsert_entry(entries, entry)
    assert len(result) == 1
    assert result[0]["type"] == "bug_fix"


def test_upsert_entry_increments_occurrences_on_duplicate():
    entry = _make_entry()
    entries = [_make_entry()]  # already one entry
    result = _upsert_entry(entries, entry)
    assert len(result) == 1
    assert result[0]["occurrences"] == 2


def test_upsert_entry_increases_confidence_on_duplicate():
    entry = _make_entry()
    entries = [_make_entry()]
    result = _upsert_entry(entries, entry)
    assert result[0]["confidence"] == pytest_approx_ish(0.6)


def pytest_approx_ish(value, rel=1e-3):
    """Simple approximate comparison helper."""
    class Approx:
        def __eq__(self, other):
            return abs(other - value) <= rel
    return Approx()


def test_upsert_entry_caps_confidence_at_095():
    entry = _make_entry()
    # Start with high confidence
    existing = _make_entry()
    existing["confidence"] = 0.90
    existing["occurrences"] = 5
    entries = [existing]
    result = _upsert_entry(entries, entry)
    assert result[0]["confidence"] <= 0.95


def test_upsert_entry_updates_last_seen():
    old_entry = _make_entry()
    old_entry["last_seen"] = "2025-01-01T00:00:00+00:00"
    entries = [old_entry]

    new_entry = _make_entry()
    new_entry["last_seen"] = "2026-03-23T00:00:00+00:00"
    result = _upsert_entry(entries, new_entry)
    assert result[0]["last_seen"] == "2026-03-23T00:00:00+00:00"


def test_upsert_entry_updates_resolution_if_longer():
    existing = _make_entry(resolution="short fix")
    entries = [existing]
    new_entry = _make_entry(resolution="much longer resolution with more detail about root cause")
    result = _upsert_entry(entries, new_entry)
    assert "longer" in result[0]["resolution"]


def test_upsert_entry_does_not_replace_resolution_if_shorter():
    existing = _make_entry(resolution="long detailed resolution that explains everything clearly")
    entries = [existing]
    new_entry = _make_entry(resolution="short")
    result = _upsert_entry(entries, new_entry)
    assert "long detailed" in result[0]["resolution"]
