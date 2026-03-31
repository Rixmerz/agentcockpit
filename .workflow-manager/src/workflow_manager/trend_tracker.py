"""Trend Tracker — records quality metrics snapshots over time.

Captures DCC metrics (smells, tensions, debt, security findings) at workflow
phase transitions to track whether code quality is improving or degrading.
"""

import json
from datetime import datetime
from pathlib import Path


def record_snapshot(project_dir: str, state_dir: str, metrics: dict | None = None) -> dict:
    """Record a metrics snapshot for the project.

    If metrics is None, returns empty snapshot (caller should provide metrics).
    Appends to state_dir/trends.json.

    Args:
        project_dir: Project path
        state_dir: Centralized state directory
        metrics: Dict with keys like smell_count, tension_count, debt_score,
                 risk_grade, findings_count, etc.

    Returns: The recorded snapshot dict
    """
    trends_path = Path(state_dir) / "trends.json"
    trends = _load_trends(trends_path)

    snapshot = {
        "timestamp": datetime.now().isoformat(),
        "project": Path(project_dir).name,
        **(metrics or {}),
    }

    trends.append(snapshot)

    # Keep last 500 entries max
    if len(trends) > 500:
        trends = trends[-500:]

    _save_trends(trends_path, trends)
    return snapshot


def get_trend(project_dir: str, state_dir: str, metric: str | None = None,
              days: int = 30) -> list[dict]:
    """Get trend data for a metric over the last N days."""
    trends_path = Path(state_dir) / "trends.json"
    trends = _load_trends(trends_path)

    # Filter by time window
    cutoff = datetime.now().timestamp() - (days * 86400)
    filtered = []
    for entry in trends:
        try:
            ts = datetime.fromisoformat(entry["timestamp"]).timestamp()
            if ts >= cutoff:
                if metric:
                    filtered.append({"timestamp": entry["timestamp"], "value": entry.get(metric)})
                else:
                    filtered.append(entry)
        except (ValueError, KeyError):
            continue
    return filtered


def format_trend_summary(project_dir: str, state_dir: str) -> str:
    """Format a compact trend summary comparing latest vs earliest in window.

    Output like: "Smells: 50→42 (-8), Debt: 45→38 (-7), Risk: B→A"
    """
    trends = get_trend(project_dir, state_dir, days=30)
    if len(trends) < 2:
        return "Insufficient data for trend analysis (need 2+ snapshots)"

    first = trends[0]
    last = trends[-1]

    parts = []
    for key, label in [
        ("smell_count", "Smells"),
        ("tension_count", "Tensions"),
        ("debt_score", "Debt"),
        ("findings_count", "Findings"),
        ("risk_grade", "Risk"),
    ]:
        old_val = first.get(key) if isinstance(first, dict) else first.get("value")
        new_val = last.get(key) if isinstance(last, dict) else last.get("value")
        if old_val is None or new_val is None:
            continue

        if isinstance(old_val, (int, float)) and isinstance(new_val, (int, float)):
            diff = new_val - old_val
            sign = "+" if diff > 0 else ""
            parts.append(f"{label}: {old_val}→{new_val} ({sign}{diff})")
        else:
            if old_val != new_val:
                parts.append(f"{label}: {old_val}→{new_val}")

    return ", ".join(parts) if parts else "No changes detected"


def _load_trends(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_trends(path: Path, data: list[dict]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        pass
