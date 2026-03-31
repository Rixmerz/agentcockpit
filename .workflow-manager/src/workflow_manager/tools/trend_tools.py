"""Trend tracking tools: record, query, and summarize quality metrics over time."""

from ..session import resolve_project_dir
from ..graph_state import _get_centralized_state_dir
from ..trend_tracker import record_snapshot, get_trend, format_trend_summary


def register_trend_tools(mcp):

    @mcp.tool()
    def trend_record_snapshot(
        metrics: dict | None = None,
        project_dir: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        """Record a quality metrics snapshot for trend tracking.

        Call this at workflow phase transitions to track quality over time.
        Metrics should include: smell_count, tension_count, debt_score,
        risk_grade, findings_count.
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)
        state_dir = str(_get_centralized_state_dir(resolved_dir))
        snapshot = record_snapshot(resolved_dir, state_dir, metrics)
        return {"success": True, "snapshot": snapshot, "session_id": sid, "project_dir": resolved_dir}

    @mcp.tool()
    def trend_get_summary(
        days: int = 30,
        project_dir: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        """Get a compact trend summary comparing current vs earliest metrics.

        Returns formatted string like "Smells: 50→42 (-8), Debt: 45→38 (-7)"
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)
        state_dir = str(_get_centralized_state_dir(resolved_dir))
        summary = format_trend_summary(resolved_dir, state_dir)
        data = get_trend(resolved_dir, state_dir, days=days)
        return {"success": True, "summary": summary, "data_points": len(data), "session_id": sid, "project_dir": resolved_dir}

    @mcp.tool()
    def trend_get_data(
        metric: str | None = None,
        days: int = 30,
        project_dir: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        """Get raw trend data for a specific metric or all metrics."""
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)
        state_dir = str(_get_centralized_state_dir(resolved_dir))
        data = get_trend(resolved_dir, state_dir, metric=metric, days=days)
        return {"success": True, "metric": metric, "data": data, "count": len(data), "session_id": sid, "project_dir": resolved_dir}
