"""Tests for .claude/hooks/dcc_feedback.py (helper functions only, no main())."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from dcc_feedback import _smell_key, _compute_delta, _format_delta, _truncate_path


# ---------------------------------------------------------------------------
# _smell_key
# ---------------------------------------------------------------------------

def test_smell_key_basic():
    smell = {"type": "god_file", "file_path": "a.ts"}
    assert _smell_key(smell) == ("god_file", "a.ts")


def test_smell_key_missing_fields():
    assert _smell_key({}) == ("", "")


def test_smell_key_only_type():
    assert _smell_key({"type": "hub_overload"}) == ("hub_overload", "")


def test_smell_key_only_file_path():
    assert _smell_key({"file_path": "src/x.ts"}) == ("", "src/x.ts")


def test_smell_key_extra_fields_ignored():
    smell = {"type": "god_file", "file_path": "b.ts", "description": "too long", "severity": "high"}
    assert _smell_key(smell) == ("god_file", "b.ts")


# ---------------------------------------------------------------------------
# _compute_delta
# ---------------------------------------------------------------------------

def _make_smell(smell_type, file_path, severity="medium"):
    return {"type": smell_type, "file_path": file_path, "severity": severity}


def test_compute_delta_new_smell_appears():
    current = [_make_smell("god_file", "a.ts")]
    baseline = []
    edited = {"a.ts"}
    result = _compute_delta(current, baseline, edited)
    assert len(result) == 1
    assert result[0]["type"] == "god_file"


def test_compute_delta_smell_in_baseline_is_filtered():
    smell = _make_smell("god_file", "a.ts")
    current = [smell]
    baseline = [smell]
    edited = {"a.ts"}
    result = _compute_delta(current, baseline, edited)
    assert result == []


def test_compute_delta_only_edited_files_surface():
    current = [
        _make_smell("god_file", "a.ts"),
        _make_smell("hub_overload", "b.ts"),
    ]
    baseline = []
    edited = {"a.ts"}  # only a.ts was edited
    result = _compute_delta(current, baseline, edited)
    assert len(result) == 1
    assert result[0]["file_path"] == "a.ts"


def test_compute_delta_empty_current_returns_empty():
    result = _compute_delta([], [_make_smell("god_file", "a.ts")], {"a.ts"})
    assert result == []


def test_compute_delta_empty_baseline_returns_all_current_for_edited_files():
    current = [
        _make_smell("god_file", "a.ts"),
        _make_smell("hub_overload", "b.ts"),
    ]
    edited = {"a.ts", "b.ts"}
    result = _compute_delta(current, [], edited)
    assert len(result) == 2


def test_compute_delta_sorted_by_severity():
    current = [
        _make_smell("smell_a", "a.ts", severity="low"),
        _make_smell("smell_b", "b.ts", severity="critical"),
        _make_smell("smell_c", "c.ts", severity="high"),
        _make_smell("smell_d", "d.ts", severity="medium"),
    ]
    edited = {"a.ts", "b.ts", "c.ts", "d.ts"}
    result = _compute_delta(current, [], edited)
    severities = [s["severity"] for s in result]
    assert severities == ["critical", "high", "medium", "low"]


def test_compute_delta_smell_not_in_edited_files_excluded():
    current = [_make_smell("god_file", "untouched.ts")]
    edited = {"other.ts"}
    result = _compute_delta(current, [], edited)
    assert result == []


def test_compute_delta_partial_overlap_with_baseline():
    baseline = [_make_smell("god_file", "a.ts")]
    current = [
        _make_smell("god_file", "a.ts"),  # in baseline — excluded
        _make_smell("hub_overload", "b.ts"),  # new — included
    ]
    edited = {"a.ts", "b.ts"}
    result = _compute_delta(current, baseline, edited)
    assert len(result) == 1
    assert result[0]["type"] == "hub_overload"


# ---------------------------------------------------------------------------
# _format_delta
# ---------------------------------------------------------------------------

def test_format_delta_single_smell():
    smells = [_make_smell("god_file", "src/services/bigService.ts", "high")]
    output = _format_delta(smells, num_files=1)
    assert "+1 new smell" in output
    assert "god_file" in output
    assert "high" in output
    assert "1 file" in output


def test_format_delta_multiple_smells():
    smells = [
        _make_smell("god_file", "a.ts", "high"),
        _make_smell("hub_overload", "b.ts", "medium"),
    ]
    output = _format_delta(smells, num_files=2)
    assert "+2 new smells" in output
    assert "2 files" in output


def test_format_delta_max_5_shown():
    smells = [_make_smell(f"smell_{i}", f"file_{i}.ts") for i in range(8)]
    output = _format_delta(smells, num_files=8)
    # Should mention "3 more" (8 - 5 = 3)
    assert "3 more" in output


def test_format_delta_exactly_5_no_remainder():
    smells = [_make_smell(f"smell_{i}", f"file_{i}.ts") for i in range(5)]
    output = _format_delta(smells, num_files=5)
    assert "more" not in output


def test_format_delta_header_shows_count():
    smells = [_make_smell("god_file", "a.ts")]
    output = _format_delta(smells, num_files=3)
    assert "+1 new smell" in output
    assert "3 files" in output


def test_format_delta_includes_file_path():
    smells = [_make_smell("god_file", "src/services/authService.ts")]
    output = _format_delta(smells, num_files=1)
    assert "authService.ts" in output or "src/services" in output


def test_format_delta_includes_description_when_present():
    smell = _make_smell("god_file", "a.ts")
    smell["description"] = "File is too large"
    output = _format_delta([smell], num_files=1)
    assert "File is too large" in output


def test_format_delta_lines_under_100_chars():
    smells = [_make_smell("god_file", "a" * 80 + ".ts")]
    output = _format_delta(smells, num_files=1)
    for line in output.split("\n"):
        assert len(line) <= 100, f"Line too long ({len(line)}): {line!r}"


# ---------------------------------------------------------------------------
# _truncate_path
# ---------------------------------------------------------------------------

def test_truncate_path_short_path_unchanged():
    short = "short.ts"
    assert _truncate_path(short, 60) == short


def test_truncate_path_long_path_truncated():
    long_path = "very/long/path/to/some/deeply/nested/file/in/project/structure/file.ts"
    result = _truncate_path(long_path, 40)
    assert result.startswith("...")
    assert len(result) <= 40


def test_truncate_path_preserves_end_of_path():
    long_path = "a/b/c/d/e/f/g/h/i/j/k/important_file.ts"
    result = _truncate_path(long_path, 30)
    assert "important_file.ts" in result


def test_truncate_path_exact_max_len_unchanged():
    path = "x" * 60
    assert _truncate_path(path, 60) == path


def test_truncate_path_one_over_max_truncates():
    path = "x" * 61
    result = _truncate_path(path, 60)
    assert result.startswith("...")
    assert len(result) == 60


def test_truncate_path_default_max_is_60():
    # Default max_len is 60 based on the source
    short = "a" * 60
    assert _truncate_path(short) == short
    long = "a" * 61
    assert _truncate_path(long).startswith("...")
