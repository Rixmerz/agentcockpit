"""Pattern Catalog — auto-extracts condensed code patterns from a project.

Scans representative files to extract minimal pattern examples (interface + 1 method)
so agents don't waste context reading full reference files.

Cache is stored in state_dir/patterns.json and is valid for 2 hours.
"""

import json
import re
from datetime import datetime, timedelta
from pathlib import Path


_CACHE_MAX_AGE = timedelta(hours=2)
_MAX_PATTERN_CHARS = 2000  # Max chars per pattern to fit in prompt injection

# Directories to always skip when scanning
_SKIP_DIRS = frozenset({"node_modules", "vendor", "target", "dist", ".git", "__pycache__", ".venv", "venv"})


_PATTERN_DESCRIPTIONS: dict[str, str] = {
    "repository": "database repository data access layer CRUD operations",
    "handler": "HTTP API handler endpoint request response routing",
    "domain_entity": "domain model entity aggregate value object",
    "migration": "database migration schema DDL create alter table",
    "test_unit": "unit test assertion mock setup teardown",
    "frontend_page": "React page component view render layout",
    "frontend_hook": "React custom hook useState useEffect state management",
    "frontend_service": "frontend service API client data fetching",
}


class PatternCatalog:
    """Auto-extracts condensed code patterns from a project."""

    def __init__(self, project_dir: str):
        self.project_dir = project_dir
        self.patterns: dict[str, dict] = {}
        self.discovered_at: str = ""

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    def discover_all(self) -> dict[str, dict]:
        """Run all pattern extractors and return patterns dict."""
        extractors = [
            ("repository", self._extract_repository_pattern),
            ("handler", self._extract_handler_pattern),
            ("domain_entity", self._extract_domain_entity_pattern),
            ("migration", self._extract_migration_pattern),
            ("test_unit", self._extract_test_pattern),
            ("frontend_page", self._extract_frontend_page_pattern),
            ("frontend_hook", self._extract_frontend_hook_pattern),
            ("frontend_service", self._extract_frontend_service_pattern),
        ]
        self.discovered_at = datetime.now().isoformat()
        self.patterns = {}
        for name, extractor in extractors:
            try:
                result = extractor()
                if result:
                    self.patterns[name] = result
            except Exception:
                continue
        return self.patterns

    def to_prompt_injection(self, pattern_names: list[str] | None = None) -> str:
        """Format patterns as a prompt injection string."""
        names = pattern_names or [k for k in self.patterns if not k.startswith("_")]
        parts = ["## Project Patterns (auto-generated)\n"]
        for name in names:
            if name in self.patterns:
                p = self.patterns[name]
                parts.append(f"### {name} ({p.get('source_file', 'unknown')})")
                parts.append(f"```{p.get('language', '')}")
                parts.append(p.get("snippet", ""))
                parts.append("```\n")
        return "\n".join(parts)

    def get(self, pattern_type: str | None = None) -> dict:
        """Return all patterns or a specific one.

        Args:
            pattern_type: One of the pattern type names. If None, returns all.
        """
        if not self.patterns:
            return {}
        if pattern_type is None:
            return self.patterns
        return self.patterns.get(pattern_type, {})

    # -------------------------------------------------------------------------
    # Pattern extractors
    # -------------------------------------------------------------------------

    def _extract_repository_pattern(self) -> dict | None:
        """Find a representative repository/data-access file."""
        glob_patterns = [
            # Go
            "internal/**/repository/*.go",
            "internal/**/*_repository.go",
            "internal/**/*_repo.go",
            "**/repository/*.go",
            "**/*_repository.go",
            "**/*_repo.go",
            # TypeScript / JavaScript
            "src/**/*Repository.ts",
            "src/**/*Repo.ts",
            "src/**/*repository.ts",
            # Python
            "**/*_repository.py",
            "**/*_repo.py",
            "app/**/repository.py",
            "app/**/repositories.py",
            # Rust
            "src/**/repository.rs",
            "src/**/*_repository.rs",
        ]
        # Exclude test files
        exclude_keywords = ["_test", ".test.", "spec.", "_spec", "mock", "fake"]
        path = self._find_representative_file(
            glob_patterns,
            exclude_keywords=exclude_keywords,
            semantic_desc=_PATTERN_DESCRIPTIONS["repository"],
        )
        if path is None:
            return None
        snippet = self._extract_snippet(path)
        language = _detect_language(path)
        return {
            "source_file": str(path.relative_to(Path(self.project_dir))),
            "language": language,
            "snippet": snippet,
        }

    def _extract_handler_pattern(self) -> dict | None:
        """Find a representative HTTP handler/controller."""
        glob_patterns = [
            # Go
            "internal/**/handler/*.go",
            "internal/**/*_handler.go",
            "internal/**/*_handlers.go",
            "**/handler/*.go",
            "**/*_handler.go",
            # TypeScript / Next.js
            "src/app/api/**/*.ts",
            "src/app/api/**/*.tsx",
            "src/**/*Handler.ts",
            "src/**/*Controller.ts",
            "src/**/*controller.ts",
            "pages/api/**/*.ts",
            # Python
            "app/**/routes.py",
            "app/**/views.py",
            "**/*_routes.py",
            "**/*_views.py",
            "**/*_handlers.py",
            # Rust
            "src/**/handlers*.rs",
            "src/**/routes*.rs",
        ]
        exclude_keywords = ["_test", ".test.", "spec.", "_spec", "mock", "fake"]
        path = self._find_representative_file(
            glob_patterns,
            exclude_keywords=exclude_keywords,
            semantic_desc=_PATTERN_DESCRIPTIONS["handler"],
        )
        if path is None:
            return None
        snippet = self._extract_snippet(path)
        language = _detect_language(path)
        return {
            "source_file": str(path.relative_to(Path(self.project_dir))),
            "language": language,
            "snippet": snippet,
        }

    def _extract_domain_entity_pattern(self) -> dict | None:
        """Find a representative domain entity/aggregate."""
        glob_patterns = [
            # Go
            "internal/*/domain/*.go",
            "internal/**/domain/*.go",
            # TypeScript
            "src/domain/**/*.ts",
            "src/**/domain/*.ts",
            "src/**/entities/*.ts",
            "src/**/models/*.ts",
            # Python
            "app/**/domain/*.py",
            "src/domain/**/*.py",
            "**/models.py",
            # Rust
            "src/**/domain/*.rs",
            "src/**/models*.rs",
        ]
        exclude_keywords = ["_test", ".test.", "spec.", "_spec", "mock", "fake", "repository", "handler", "service"]
        path = self._find_representative_file(
            glob_patterns,
            exclude_keywords=exclude_keywords,
            semantic_desc=_PATTERN_DESCRIPTIONS["domain_entity"],
        )
        if path is None:
            return None
        snippet = self._extract_snippet(path)
        language = _detect_language(path)
        return {
            "source_file": str(path.relative_to(Path(self.project_dir))),
            "language": language,
            "snippet": snippet,
        }

    def _extract_migration_pattern(self) -> dict | None:
        """Find the latest migration file as a template."""
        root = Path(self.project_dir)
        migration_dirs = [
            "migrations",
            "db/migrations",
            "src/migrations",
            "database/migrations",
        ]
        # Also check internal/*/migrations
        internal_dir = root / "internal"
        if internal_dir.is_dir():
            try:
                for child in internal_dir.iterdir():
                    if child.is_dir():
                        migration_dirs.append(f"internal/{child.name}/migrations")
            except OSError:
                pass

        best_num = -1
        best_path: Path | None = None
        num_pattern = re.compile(r"^(\d+)")

        for rel in migration_dirs:
            mdir = root / rel
            if not mdir.is_dir():
                continue
            try:
                for f in mdir.iterdir():
                    if not f.is_file():
                        continue
                    m = num_pattern.match(f.name)
                    if m:
                        n = int(m.group(1))
                        if n > best_num:
                            best_num = n
                            best_path = f
            except OSError:
                continue

        if best_path is None:
            return None

        snippet = self._extract_snippet(best_path)
        language = _detect_language(best_path)
        return {
            "source_file": str(best_path.relative_to(root)),
            "language": language,
            "snippet": snippet,
        }

    def _extract_test_pattern(self) -> dict | None:
        """Find a representative test file pattern."""
        glob_patterns = [
            # Go unit tests (prefer non-integration)
            "internal/**/*_test.go",
            "**/*_test.go",
            # TypeScript
            "src/**/*.test.ts",
            "src/**/*.spec.ts",
            "src/**/*.test.tsx",
            "src/**/*.spec.tsx",
            # Python
            "**/test_*.py",
            "**/*_test.py",
            # Rust
            "src/**/*.rs",
        ]
        # For tests, we WANT test files
        path = self._find_representative_file(
            glob_patterns,
            require_test=True,
            semantic_desc=_PATTERN_DESCRIPTIONS["test_unit"],
        )
        if path is None:
            return None
        snippet = self._extract_snippet(path)
        language = _detect_language(path)
        return {
            "source_file": str(path.relative_to(Path(self.project_dir))),
            "language": language,
            "snippet": snippet,
        }

    def _extract_frontend_page_pattern(self) -> dict | None:
        """Find a representative frontend page/view component."""
        glob_patterns = [
            # Next.js app router
            "src/app/**/page.tsx",
            "src/app/**/page.ts",
            # Next.js pages router
            "src/pages/**/*.tsx",
            "pages/**/*.tsx",
            # React features/routes
            "src/features/**/pages/*.tsx",
            "src/features/**/*Page.tsx",
            "src/**/pages/*.tsx",
            "src/routes/**/*.tsx",
            # Generic React
            "src/**/*Page.tsx",
            "src/**/*View.tsx",
            "frontend/src/**/*Page.tsx",
        ]
        exclude_keywords = ["_test", ".test.", "spec.", "_spec", "mock", "fake", "layout", "loading", "error", "not-found"]
        path = self._find_representative_file(
            glob_patterns,
            exclude_keywords=exclude_keywords,
            semantic_desc=_PATTERN_DESCRIPTIONS["frontend_page"],
        )
        if path is None:
            return None
        snippet = self._extract_snippet(path)
        return {
            "source_file": str(path.relative_to(Path(self.project_dir))),
            "language": "tsx",
            "snippet": snippet,
        }

    def _extract_frontend_hook_pattern(self) -> dict | None:
        """Find a representative custom React hook."""
        glob_patterns = [
            "src/**/hooks/use*.ts",
            "src/**/hooks/use*.tsx",
            "src/hooks/use*.ts",
            "src/hooks/use*.tsx",
            "frontend/src/**/hooks/use*.ts",
            "frontend/src/**/hooks/use*.tsx",
            # Fallback: any use* file
            "src/**/use*.ts",
            "src/**/use*.tsx",
        ]
        exclude_keywords = ["_test", ".test.", "spec.", "_spec", "mock"]
        path = self._find_representative_file(
            glob_patterns,
            exclude_keywords=exclude_keywords,
            semantic_desc=_PATTERN_DESCRIPTIONS["frontend_hook"],
        )
        if path is None:
            return None
        snippet = self._extract_snippet(path)
        language = "typescript" if path.suffix == ".ts" else "tsx"
        return {
            "source_file": str(path.relative_to(Path(self.project_dir))),
            "language": language,
            "snippet": snippet,
        }

    def _extract_frontend_service_pattern(self) -> dict | None:
        """Find a representative frontend service layer file."""
        glob_patterns = [
            "src/services/**/*.ts",
            "src/services/*.ts",
            "frontend/src/services/**/*.ts",
            "src/**/services/*.ts",
            "src/**/*Service.ts",
            "src/**/*service.ts",
            "src/**/*Client.ts",
            "src/**/*Api.ts",
        ]
        exclude_keywords = ["_test", ".test.", "spec.", "_spec", "mock", "index.ts"]
        path = self._find_representative_file(
            glob_patterns,
            exclude_keywords=exclude_keywords,
            semantic_desc=_PATTERN_DESCRIPTIONS["frontend_service"],
        )
        if path is None:
            return None
        snippet = self._extract_snippet(path)
        return {
            "source_file": str(path.relative_to(Path(self.project_dir))),
            "language": "typescript",
            "snippet": snippet,
        }

    # -------------------------------------------------------------------------
    # File discovery helpers
    # -------------------------------------------------------------------------

    def _rank_by_embedding(self, candidates: list[Path], description: str) -> list[Path]:
        """Re-rank file candidates by semantic similarity to a description.

        Falls back to original order if Ollama is unavailable.
        """
        try:
            import urllib.request
            import json as _json

            # Embed the description
            payload = _json.dumps({"model": "nomic-embed-text", "input": description}).encode()
            req = urllib.request.Request(
                "http://localhost:11434/api/embed",
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = _json.loads(resp.read())
                query_emb = data.get("embeddings", [None])[0]

            if not query_emb:
                return candidates

            # Embed each candidate's first 500 chars
            scored: list[tuple[Path, float]] = []
            for path in candidates[:10]:  # Cap at 10 to avoid timeout
                try:
                    content = path.read_text(encoding="utf-8", errors="replace")[:500]
                    payload = _json.dumps({"model": "nomic-embed-text", "input": content}).encode()
                    req = urllib.request.Request(
                        "http://localhost:11434/api/embed",
                        data=payload,
                        headers={"Content-Type": "application/json"},
                    )
                    with urllib.request.urlopen(req, timeout=2) as resp:
                        data = _json.loads(resp.read())
                        cand_emb = data.get("embeddings", [None])[0]

                    if cand_emb and query_emb:
                        # Cosine similarity
                        dot = sum(a * b for a, b in zip(query_emb, cand_emb))
                        norm_q = sum(a * a for a in query_emb) ** 0.5
                        norm_c = sum(a * a for a in cand_emb) ** 0.5
                        sim = dot / (norm_q * norm_c) if norm_q and norm_c else 0.0
                        scored.append((path, sim))
                    else:
                        scored.append((path, 0.0))
                except Exception:
                    scored.append((path, 0.0))

            # Sort by similarity descending
            scored.sort(key=lambda x: x[1], reverse=True)
            return [p for p, _ in scored]
        except Exception:
            return candidates  # Fallback to original order

    def _find_representative_file(
        self,
        patterns: list[str],
        exclude_keywords: list[str] | None = None,
        require_test: bool = False,
        max_size: int = 50_000,
        semantic_desc: str | None = None,
    ) -> Path | None:
        """Find the first matching file that's a reasonable size.

        Args:
            patterns: List of glob patterns relative to project_dir
            exclude_keywords: Substrings in the relative path that disqualify a file
            require_test: If True, only return files that look like test files
            max_size: Maximum file size in bytes
            semantic_desc: Optional description for semantic re-ranking via embeddings
        """
        root = Path(self.project_dir)
        exclude = exclude_keywords or []

        # Collect all valid candidates across all patterns
        all_candidates: list[Path] = []

        for pattern in patterns:
            # Sort for determinism; prefer shorter paths (less nested = more representative)
            try:
                matches = sorted(root.glob(pattern), key=lambda p: (len(p.parts), p.name))
            except Exception:
                continue

            for m in matches:
                if not m.is_file():
                    continue

                try:
                    size = m.stat().st_size
                except OSError:
                    continue

                if size == 0 or size > max_size:
                    continue

                rel = str(m.relative_to(root))

                # Skip vendor/generated/build directories
                if any(skip in rel for skip in _SKIP_DIRS):
                    continue

                # Check exclude keywords
                rel_lower = rel.lower()
                if any(kw.lower() in rel_lower for kw in exclude):
                    continue

                # If require_test, the file must look like a test file
                if require_test:
                    is_test = (
                        "_test.go" in m.name
                        or ".test." in m.name
                        or ".spec." in m.name
                        or m.name.startswith("test_")
                        or m.name.endswith("_test.py")
                    )
                    # For Rust, test functions are inside regular source files — skip
                    if not is_test:
                        continue

                if m not in all_candidates:
                    all_candidates.append(m)

        if not all_candidates:
            return None

        # Semantic re-ranking if multiple candidates and description provided
        if len(all_candidates) > 1 and semantic_desc:
            all_candidates = self._rank_by_embedding(all_candidates, semantic_desc)

        return all_candidates[0]

    # -------------------------------------------------------------------------
    # Snippet extraction
    # -------------------------------------------------------------------------

    def _extract_snippet(self, file_path: Path, max_chars: int = _MAX_PATTERN_CHARS) -> str:
        """Extract a condensed snippet from a file.

        Strategy: Take imports + type/struct/class definitions + first 2 functions/methods.
        Truncates to max_chars.
        """
        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""

        # For small files, return as-is
        if len(content) <= max_chars:
            return content

        lines = content.split("\n")
        snippet_lines: list[str] = []
        func_count = 0
        in_block = False  # inside a func/method body
        brace_depth = 0   # for brace-counted languages (Go, Rust, TS)

        # Patterns that signal a new top-level declaration
        func_start_re = re.compile(
            r"^(func |def |export (default |async )?function |export const \w+ = |"
            r"async function |public |private |protected |static |fn |\s*(async\s+)?function )"
        )
        # Patterns that signal type/class/struct definitions (we always include these)
        type_def_re = re.compile(
            r"^(type |class |struct |interface |enum |impl |pub (struct|enum|fn|impl))"
        )
        # Import lines
        import_re = re.compile(
            r"^(import |from |use |#include|package |require\(|const .* = require)"
        )

        for line in lines:
            stripped = line.strip()

            # Always include imports and package declarations
            if import_re.match(stripped):
                snippet_lines.append(line)
                brace_depth += stripped.count("{") - stripped.count("}")
                in_block = brace_depth > 0
                continue

            # Always include type/struct/class definitions
            if type_def_re.match(stripped):
                snippet_lines.append(line)
                brace_depth += stripped.count("{") - stripped.count("}")
                in_block = brace_depth > 0
                continue

            # Track function boundaries
            if func_start_re.match(stripped) and not in_block:
                func_count += 1
                in_block = True
                brace_depth = stripped.count("{") - stripped.count("}")
                snippet_lines.append(line)
                # Stop after capturing 2 complete functions
                if func_count > 2:
                    break
                continue

            if in_block:
                snippet_lines.append(line)
                brace_depth += stripped.count("{") - stripped.count("}")
                if brace_depth <= 0:
                    in_block = False
                    brace_depth = 0
                    snippet_lines.append("")  # blank line separator
            else:
                # Include top-level non-function lines (annotations, comments, blank lines)
                # but only until we've started collecting (avoid huge comment blocks)
                if func_count == 0 and len("\n".join(snippet_lines)) < max_chars // 2:
                    snippet_lines.append(line)

            # Safety: bail if we've already exceeded the limit
            if len("\n".join(snippet_lines)) > max_chars:
                break

        result = "\n".join(snippet_lines)
        return result[:max_chars]

    # -------------------------------------------------------------------------
    # Serialization
    # -------------------------------------------------------------------------

    def to_json(self) -> str:
        """Serialize patterns to JSON for storage."""
        return json.dumps(self.patterns, indent=2, ensure_ascii=False)

    @classmethod
    def from_json(cls, project_dir: str, data: str) -> "PatternCatalog":
        """Load from cached JSON."""
        instance = cls(project_dir)
        instance.patterns = json.loads(data)
        return instance

    # -------------------------------------------------------------------------
    # Persistence
    # -------------------------------------------------------------------------

    def save(self, state_dir: str):
        """Save patterns to state_dir/patterns.json."""
        path = Path(state_dir) / "patterns.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_json(), encoding="utf-8")

    @classmethod
    def load(cls, project_dir: str, state_dir: str) -> "PatternCatalog | None":
        """Load from cache if fresh enough (< 2 hours).

        Returns None if missing or stale.
        """
        path = Path(state_dir) / "patterns.json"
        if not path.exists():
            return None

        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime)
            if datetime.now() - mtime > _CACHE_MAX_AGE:
                return None

            return cls.from_json(project_dir, path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, ValueError):
            return None


# -------------------------------------------------------------------------
# Language detection helper
# -------------------------------------------------------------------------

def _detect_language(path: Path) -> str:
    """Detect language identifier from file extension."""
    ext_map = {
        ".go": "go",
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "tsx",
        ".js": "javascript",
        ".jsx": "jsx",
        ".rs": "rust",
        ".kt": "kotlin",
        ".java": "java",
        ".rb": "ruby",
        ".cs": "csharp",
        ".sql": "sql",
    }
    return ext_map.get(path.suffix.lower(), path.suffix.lstrip("."))
