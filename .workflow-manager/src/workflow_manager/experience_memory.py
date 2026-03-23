"""Experience Memory System — automatic learning from DCC analysis results.

Collects experiences (tensions, smells, gate blocks, resolutions) and provides
relevance-ranked retrieval for file-level context injection.

Storage:
  - Global: ~/.workflow-manager/experience_memory.json
  - Per-project: ~/.workflow-manager/project_memories/{project}/experience_memory.json
"""

import json
import re
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional


# ============================================================================
# Data model
# ============================================================================

VALID_TYPES = frozenset({
    "tension_caused", "tension_resolved",
    "smell_introduced", "smell_fixed",
    "gate_blocked", "gate_resolved",
    "impact_high",
    "skill_referenced",
})

VALID_SEVERITIES = frozenset({"low", "medium", "high", "critical"})
VALID_SCOPES = frozenset({"global", "project"})


@dataclass
class ExperienceEntry:
    id: str = ""
    type: str = ""                    # tension_caused|tension_resolved|smell_*|gate_*|impact_high
    file_pattern: str = ""            # Generalized: "src/services/*Service.ts"
    keywords: list[str] = field(default_factory=list)
    domain: str = ""                  # api, auth, ui, config, etc.
    description: str = ""
    severity: str = "medium"          # low|medium|high|critical
    confidence: float = 0.30
    occurrences: int = 1
    first_seen: str = ""
    last_seen: str = ""
    project_origin: str = ""
    resolution: str = ""
    related_files: list[str] = field(default_factory=list)
    scope: str = "global"             # global|project

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "ExperienceEntry":
        # Filter to only known fields
        known = {f.name for f in cls.__dataclass_fields__.values()}
        return cls(**{k: v for k, v in d.items() if k in known})


# ============================================================================
# Utility functions
# ============================================================================

def generalize_path(path: str) -> str:
    """Generalize a file path to a pattern for matching similar files.

    "src/services/authService.ts" → "src/services/*Service.ts"
    "src/components/LoginForm.tsx" → "src/components/*Form.tsx"
    "lib/utils/dateHelper.js" → "lib/utils/*Helper.js"
    """
    p = Path(path)
    stem = p.stem
    suffix = p.suffix

    # Try to split camelCase/PascalCase into prefix + category
    # e.g. "authService" → ("auth", "Service")
    parts = re.split(r'(?<=[a-z])(?=[A-Z])', stem)
    if len(parts) >= 2:
        # Keep the last CamelCase part as the category
        category = parts[-1]
        parent = str(p.parent)
        return f"{parent}/*{category}{suffix}"

    # Try kebab-case / snake_case
    for sep in ["-", "_"]:
        if sep in stem:
            segments = stem.split(sep)
            if len(segments) >= 2:
                category = segments[-1]
                parent = str(p.parent)
                return f"{parent}/*{sep}{category}{suffix}"

    # Fallback: wildcard the filename
    return f"{p.parent}/*{suffix}"


def extract_file_keywords(path: str) -> list[str]:
    """Extract meaningful keywords from a file path.

    "src/services/authService.ts" → ["auth", "service"]
    """
    p = Path(path)
    stem = p.stem.lower()

    # Split on camelCase, kebab-case, snake_case
    words = re.split(r'(?<=[a-z])(?=[A-Z])|[-_./\\]', stem)
    words = [w.lower() for w in words if len(w) > 1]

    # Add parent directory name
    parent = p.parent.name.lower()
    if parent and len(parent) > 1 and parent not in (".", "src"):
        words.append(parent)

    # Deduplicate preserving order
    seen = set()
    result = []
    for w in words:
        if w not in seen:
            seen.add(w)
            result.append(w)
    return result


_DOMAIN_MAP = {
    "auth": ["auth", "login", "session", "token", "jwt", "oauth", "password", "credential"],
    "api": ["api", "endpoint", "route", "controller", "handler", "middleware", "request", "response"],
    "ui": ["component", "page", "view", "layout", "modal", "form", "button", "panel", "widget"],
    "config": ["config", "setting", "env", "constant", "option"],
    "data": ["model", "schema", "entity", "migration", "repository", "store", "state"],
    "test": ["test", "spec", "fixture", "mock"],
    "style": ["style", "css", "theme", "color", "font"],
    "util": ["util", "helper", "lib", "common", "shared"],
    "build": ["build", "webpack", "vite", "rollup", "bundle", "deploy"],
}


def guess_domain(path: str) -> str:
    """Guess the domain of a file from its path.

    "src/services/authService.ts" → "auth"
    "src/components/LoginForm.tsx" → "ui"
    """
    lower = path.lower()
    best_domain = ""
    best_score = 0

    for domain, keywords in _DOMAIN_MAP.items():
        score = sum(1 for kw in keywords if kw in lower)
        if score > best_score:
            best_score = score
            best_domain = domain

    return best_domain or "general"


def update_confidence(current: float, occurrences: int) -> float:
    """Asymptotic confidence growth: 0.30 → 0.50 → 0.65 → 0.75 → 0.82 → ...

    Formula: 0.95 * (1 - 0.7^occurrences)
    Cap at 0.95 to leave room for doubt.
    """
    return min(0.95, 0.95 * (1 - 0.7 ** occurrences))


# ============================================================================
# Relevance scoring
# ============================================================================

def _score_path_match(entry_pattern: str, target_path: str) -> float:
    """Score how well an entry's file_pattern matches a target file path."""
    if not entry_pattern or not target_path:
        return 0.0

    # Exact pattern match
    pattern_regex = entry_pattern.replace("*", ".*")
    try:
        if re.fullmatch(pattern_regex, target_path):
            return 1.0
    except re.error:
        pass

    # Same directory
    entry_dir = str(Path(entry_pattern).parent)
    target_dir = str(Path(target_path).parent)
    if entry_dir == target_dir:
        return 0.7

    # Same parent directory
    entry_parent = str(Path(entry_dir).parent)
    target_parent = str(Path(target_dir).parent)
    if entry_parent == target_parent and entry_parent != ".":
        return 0.4

    return 0.0


def _score_keyword_overlap(entry_keywords: list[str], target_keywords: list[str]) -> float:
    """Jaccard-like overlap between keyword sets."""
    if not entry_keywords or not target_keywords:
        return 0.0
    s1 = set(entry_keywords)
    s2 = set(target_keywords)
    intersection = len(s1 & s2)
    union = len(s1 | s2)
    return intersection / union if union else 0.0


def _score_recency(last_seen: str) -> float:
    """Score based on how recently the experience was observed. 1.0 = today, decays over 30 days."""
    if not last_seen:
        return 0.0
    try:
        dt = datetime.fromisoformat(last_seen)
        days = (datetime.now() - dt).days
        return max(0.0, 1.0 - days / 30.0)
    except (ValueError, TypeError):
        return 0.0


def _temporal_decay_factor(last_seen: str) -> float:
    """6-month half-life, floored at 0.3.

    Entries older than ~180 days contribute less to relevance.
    Recent entries (within a few days) have factor ~1.0.
    """
    try:
        from datetime import timezone
        last = datetime.fromisoformat(last_seen)
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        days = (datetime.now(timezone.utc) - last).days
        return max(0.3, 1.0 - days / 180.0)
    except (ValueError, TypeError):
        return 1.0


def compute_relevance(entry: ExperienceEntry, target_path: str,
                      query_embedding=None) -> float:
    """Compute relevance score for an entry against a target file.

    score = path_match * 0.25 + semantic * 0.30 + domain_match * 0.20
            + confidence * decay * 0.15 + recency * 0.10

    The semantic score is embedding cosine similarity when available,
    otherwise keyword Jaccard overlap. The confidence component is
    multiplied by a temporal decay factor (6-month half-life, floored
    at 0.3) so older entries contribute less.
    """
    target_keywords = extract_file_keywords(target_path)
    target_domain = guess_domain(target_path)

    path_score = _score_path_match(entry.file_pattern, target_path)
    keyword_score = _score_keyword_overlap(entry.keywords, target_keywords)
    domain_score = 1.0 if entry.domain == target_domain else 0.0
    decay = _temporal_decay_factor(entry.last_seen)
    confidence_score = entry.confidence * decay
    recency_score = _score_recency(entry.last_seen)

    # Try embedding-based similarity (replaces keyword_score if available)
    embedding_score = None
    try:
        from deltacodecube.embeddings.cache import EmbeddingCache
        cache = EmbeddingCache()
        entry_emb = cache.get(entry.id, "experience")
        if entry_emb is not None and query_embedding is not None:
            import numpy as np
            na = np.linalg.norm(entry_emb)
            nb = np.linalg.norm(query_embedding)
            if na > 0 and nb > 0:
                embedding_score = float(np.dot(entry_emb, query_embedding) / (na * nb))
        cache.close()
    except Exception:
        pass

    # Use embedding score if available, otherwise keyword score
    semantic_score = embedding_score if embedding_score is not None else keyword_score

    return (
        path_score * 0.25
        + semantic_score * 0.30
        + domain_score * 0.20
        + confidence_score * 0.15
        + recency_score * 0.10
    )


# ============================================================================
# ExperienceMemoryStore
# ============================================================================

GLOBAL_MEMORY_FILE = Path.home() / ".workflow-manager" / "experience_memory.json"
PROJECT_MEMORIES_DIR = Path.home() / ".workflow-manager" / "project_memories"
MAX_ENTRIES = 500


class ExperienceMemoryStore:
    """Manages experience entries with load/save/record/query operations."""

    def __init__(self):
        self.entries: list[ExperienceEntry] = []
        self._scope: str = "global"
        self._project_name: str | None = None
        self._file_path: Path | None = None
        self._query_embedding = None

    def _resolve_path(self, scope: str, project_name: str | None) -> Path:
        if scope == "project" and project_name:
            return PROJECT_MEMORIES_DIR / project_name / "experience_memory.json"
        return GLOBAL_MEMORY_FILE

    def load(self, scope: str = "global", project_name: str | None = None) -> None:
        """Load entries from JSON file."""
        self._scope = scope
        self._project_name = project_name
        self._file_path = self._resolve_path(scope, project_name)

        if not self._file_path.exists():
            self.entries = []
            return

        try:
            data = json.loads(self._file_path.read_text())
            self.entries = [ExperienceEntry.from_dict(e) for e in data.get("entries", [])]
        except Exception:
            self.entries = []

    def save(self) -> None:
        """Write entries to JSON, applying eviction if over MAX_ENTRIES."""
        if self._file_path is None:
            return

        # Eviction: remove lowest confidence + oldest entries
        if len(self.entries) > MAX_ENTRIES:
            self.entries.sort(key=lambda e: (e.confidence, e.last_seen or ""), reverse=True)
            self.entries = self.entries[:MAX_ENTRIES]

        self._file_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "entries": [e.to_dict() for e in self.entries],
            "last_updated": datetime.now().isoformat(),
            "version": "1.0",
            "scope": self._scope,
            "project": self._project_name,
            "count": len(self.entries),
        }
        self._file_path.write_text(json.dumps(data, indent=2))

    def _dedup_key(self, entry: ExperienceEntry) -> tuple:
        """Deduplication key: same type + file_pattern + domain = same experience."""
        return (entry.type, entry.file_pattern, entry.domain)

    def record(self, entry: ExperienceEntry) -> ExperienceEntry:
        """Add or merge an experience entry. Deduplicates by type+file_pattern+domain."""
        if not entry.id:
            entry.id = str(uuid.uuid4())[:8]

        now = datetime.now().isoformat()
        if not entry.first_seen:
            entry.first_seen = now
        entry.last_seen = now

        key = self._dedup_key(entry)

        # Check for existing entry with same key
        for i, existing in enumerate(self.entries):
            if self._dedup_key(existing) == key:
                # Merge: update existing
                existing.occurrences += 1
                existing.last_seen = now
                existing.confidence = update_confidence(existing.confidence, existing.occurrences)
                # Update description if new one is longer/better
                if len(entry.description) > len(existing.description):
                    existing.description = entry.description
                if entry.resolution and not existing.resolution:
                    existing.resolution = entry.resolution
                # Merge related files
                for f in entry.related_files:
                    if f not in existing.related_files:
                        existing.related_files.append(f)
                return existing

        # New entry
        entry.confidence = update_confidence(0.0, 1)
        self.entries.append(entry)
        self.save()

        # Cache embedding for semantic search
        try:
            from deltacodecube.embeddings.client import OllamaEmbedder
            from deltacodecube.embeddings.cache import EmbeddingCache

            embed_text = f"{entry.description} {entry.resolution} {' '.join(entry.keywords)}"
            embedder = OllamaEmbedder()
            embedding = embedder.embed(embed_text)
            if embedding:
                cache = EmbeddingCache()
                content_hash = EmbeddingCache.content_hash(embed_text)
                cache.put(entry.id, "experience", content_hash, embedding)
                cache.close()
        except Exception:
            pass  # Ollama unavailable — skip embedding

        return entry

    def set_query_embedding(self, embedding) -> None:
        """Set the query embedding for semantic scoring in compute_relevance()."""
        self._query_embedding = embedding

    def query(self, file_path: str, top_n: int = 5) -> list[tuple[ExperienceEntry, float]]:
        """Return entries ranked by relevance to the given file path."""
        scored = []
        for entry in self.entries:
            score = compute_relevance(entry, file_path, self._query_embedding)
            if score > 0.05:  # Minimum threshold
                scored.append((entry, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_n]

    def stats(self) -> dict:
        """Return summary statistics about stored experiences."""
        by_type: dict[str, int] = {}
        by_scope: dict[str, int] = {}
        by_severity: dict[str, int] = {}
        confidences: list[float] = []

        for e in self.entries:
            by_type[e.type] = by_type.get(e.type, 0) + 1
            by_scope[e.scope] = by_scope.get(e.scope, 0) + 1
            by_severity[e.severity] = by_severity.get(e.severity, 0) + 1
            confidences.append(e.confidence)

        return {
            "total": len(self.entries),
            "by_type": by_type,
            "by_scope": by_scope,
            "by_severity": by_severity,
            "avg_confidence": round(sum(confidences) / len(confidences), 3) if confidences else 0.0,
            "oldest": min((e.first_seen for e in self.entries), default=None),
            "newest": max((e.last_seen for e in self.entries), default=None),
        }


def merge_stores(global_store: ExperienceMemoryStore,
                 project_store: ExperienceMemoryStore) -> list[ExperienceEntry]:
    """Combine entries from global and project stores (project entries take priority on dedup)."""
    merged: dict[tuple, ExperienceEntry] = {}

    for entry in global_store.entries:
        key = (entry.type, entry.file_pattern, entry.domain)
        merged[key] = entry

    # Project entries override global on same key
    for entry in project_store.entries:
        key = (entry.type, entry.file_pattern, entry.domain)
        if key in merged:
            # Keep the one with higher confidence
            if entry.confidence >= merged[key].confidence:
                merged[key] = entry
        else:
            merged[key] = entry

    return list(merged.values())
