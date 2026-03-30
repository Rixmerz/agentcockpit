"""Project metadata auto-discovery and caching.

Discovers common project metadata (migrations, ID patterns, bounded contexts,
tech stack, directory structure) so agents don't waste context reading files
for discoverable information.

Cache is stored in state_dir/metadata.json and is valid for 1 hour.
"""

import json
import re
from datetime import datetime, timedelta
from pathlib import Path


_CACHE_MAX_AGE = timedelta(hours=1)


class ProjectMetadata:
    """Auto-discovers and caches project metadata for agent context injection."""

    def __init__(self, project_dir: str):
        self.project_dir = project_dir
        self._cache: dict = {}

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    def discover_all(self) -> dict:
        """Run all discovery methods and return combined metadata."""
        self._cache = {
            "migration_number": self.discover_migration_number(),
            "id_patterns": self.discover_id_patterns(),
            "bounded_contexts": self.discover_bounded_contexts(),
            "tech_stack": self.discover_tech_stack(),
            "project_structure": self.discover_project_structure(),
            "_discovered_at": datetime.now().isoformat(),
        }
        return self._cache

    def discover_migration_number(self) -> dict:
        """Find highest migration number in common migration directories.

        Searches: migrations/, db/migrations/, internal/*/migrations/,
        src/migrations/, database/migrations/

        Returns:
            {"last_number": "000026", "next_number": "000027",
             "directory": "migrations/", "count": 26}
        """
        candidate_globs = [
            "migrations",
            "db/migrations",
            "src/migrations",
            "database/migrations",
        ]
        # internal/*/migrations  — expanded manually
        internal_dir = Path(self.project_dir) / "internal"
        if internal_dir.is_dir():
            try:
                for child in internal_dir.iterdir():
                    if child.is_dir():
                        candidate_globs.append(f"internal/{child.name}/migrations")
            except OSError:
                pass

        root = Path(self.project_dir)
        best_number: int | None = None
        best_dir: str | None = None
        total_count = 0

        for rel in candidate_globs:
            mdir = root / rel
            if not mdir.is_dir():
                continue

            try:
                files = list(mdir.iterdir())
            except OSError:
                continue

            numbers: list[int] = []
            pattern = re.compile(r"^(\d+)")
            for f in files:
                m = pattern.match(f.name)
                if m:
                    numbers.append(int(m.group(1)))

            if numbers:
                local_max = max(numbers)
                if best_number is None or local_max > best_number:
                    best_number = local_max
                    best_dir = rel + "/"
                    total_count = len(numbers)

        if best_number is None:
            return {"last_number": None, "next_number": None, "directory": None, "count": 0}

        width = max(6, len(str(best_number)))
        last_str = str(best_number).zfill(width)
        next_str = str(best_number + 1).zfill(width)
        return {
            "last_number": last_str,
            "next_number": next_str,
            "directory": best_dir,
            "count": total_count,
        }

    def discover_id_patterns(self) -> dict:
        """Scan domain/model files for ID type patterns.

        Searches: internal/*/domain/, src/domain/, src/models/, app/models/
        Detects: string IDs, uuid.UUID, int IDs, custom ID types.

        Returns:
            {"pattern": "string", "examples": [...], "note": "..."}
        """
        search_dirs = [
            "src/domain",
            "src/models",
            "app/models",
            "app/domain",
        ]
        root = Path(self.project_dir)

        # Add internal/*/domain
        internal_dir = root / "internal"
        if internal_dir.is_dir():
            try:
                for child in internal_dir.iterdir():
                    if child.is_dir():
                        search_dirs.append(f"internal/{child.name}/domain")
            except OSError:
                pass

        # Collect domain files
        domain_files: list[Path] = []
        for rel in search_dirs:
            d = root / rel
            if not d.is_dir():
                continue
            try:
                for f in d.rglob("*"):
                    if f.is_file() and f.suffix in {".go", ".py", ".ts", ".kt", ".java", ".rs"}:
                        domain_files.append(f)
            except OSError:
                pass

        if not domain_files:
            return {"pattern": None, "examples": [], "note": None}

        examples: list[str] = []
        pattern_votes: dict[str, int] = {"string": 0, "uuid": 0, "int": 0, "custom": 0}

        # Go: type VendorID string / type OrderID uuid.UUID / type X int
        go_id_pattern = re.compile(r"^\s*type\s+(\w+ID)\s+(\w[\w.]*)", re.MULTILINE)
        # Python: VendorID = NewType(...) or class VendorID...
        py_id_pattern = re.compile(r"^(\w+ID)\s*=\s*NewType\s*\(", re.MULTILINE)
        # uuid pattern
        uuid_pattern = re.compile(r"\buuid[\w.]*\b", re.IGNORECASE)

        for fpath in domain_files[:40]:  # cap to avoid slow scans
            try:
                text = fpath.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue

            for match in go_id_pattern.finditer(text):
                _, id_type = match.group(1), match.group(2).lower()
                line = match.group(0).strip()
                if line not in examples:
                    examples.append(line)
                if "uuid" in id_type:
                    pattern_votes["uuid"] += 1
                elif "int" in id_type:
                    pattern_votes["int"] += 1
                elif "string" in id_type:
                    pattern_votes["string"] += 1
                else:
                    pattern_votes["custom"] += 1

            for match in py_id_pattern.finditer(text):
                line = match.group(0).strip()
                if line not in examples:
                    examples.append(line)
                if uuid_pattern.search(text[match.start():match.start() + 80]):
                    pattern_votes["uuid"] += 1
                else:
                    pattern_votes["string"] += 1

        dominant = max(pattern_votes, key=lambda k: pattern_votes[k])
        if pattern_votes[dominant] == 0:
            dominant = None

        note = None
        if dominant == "string":
            note = "Use domain.XxxID(stringValue) for casting"
        elif dominant == "uuid":
            note = "IDs are uuid.UUID — parse with uuid.Parse(str)"
        elif dominant == "int":
            note = "IDs are integer — use strconv.Atoi for string conversion"

        return {
            "pattern": dominant,
            "examples": examples[:10],
            "note": note,
        }

    def discover_bounded_contexts(self) -> dict:
        """List existing bounded contexts/modules.

        Searches: internal/*, src/features/*, src/modules/*, app/domains/*

        Returns:
            {"contexts": [...], "count": 9, "directory": "internal/"}
        """
        candidate_dirs = [
            "internal",
            "src/features",
            "src/modules",
            "app/domains",
            "app/contexts",
        ]
        root = Path(self.project_dir)

        for rel in candidate_dirs:
            d = root / rel
            if not d.is_dir():
                continue
            try:
                contexts = sorted(
                    child.name
                    for child in d.iterdir()
                    if child.is_dir() and not child.name.startswith(".")
                )
                if contexts:
                    return {
                        "contexts": contexts,
                        "count": len(contexts),
                        "directory": rel + "/",
                    }
            except OSError:
                continue

        return {"contexts": [], "count": 0, "directory": None}

    def discover_tech_stack(self) -> dict:
        """Detect languages, frameworks, and test patterns.

        Returns:
            {"languages": [...], "frameworks": [...], "test_runner": ...,
             "frontend_test": ..., "test_patterns": {...}}
        """
        root = Path(self.project_dir)
        languages: list[str] = []
        frameworks: list[str] = []
        test_runner: str | None = None
        frontend_test: str | None = None
        test_patterns: dict[str, str] = {}

        # --- Go ---
        go_mod = root / "go.mod"
        if go_mod.exists():
            languages.append("go")
            test_runner = "go test"
            test_patterns["go"] = "func TestXxx(t *testing.T)"
            try:
                content = go_mod.read_text(encoding="utf-8", errors="replace")
                for framework, pkg in [
                    ("echo", "github.com/labstack/echo"),
                    ("gin", "github.com/gin-gonic/gin"),
                    ("chi", "github.com/go-chi/chi"),
                    ("fiber", "github.com/gofiber/fiber"),
                    ("grpc", "google.golang.org/grpc"),
                ]:
                    if pkg in content:
                        frameworks.append(framework)
            except OSError:
                pass

        # --- Rust ---
        cargo_toml = root / "Cargo.toml"
        if cargo_toml.exists():
            languages.append("rust")
            test_runner = "cargo test"
            test_patterns["rust"] = "#[test] fn test_xxx()"
            try:
                content = cargo_toml.read_text(encoding="utf-8", errors="replace")
                for framework, keyword in [
                    ("actix-web", "actix-web"),
                    ("axum", "axum"),
                    ("tauri", "tauri"),
                    ("rocket", "rocket"),
                ]:
                    if keyword in content:
                        frameworks.append(framework)
            except OSError:
                pass

        # --- Python ---
        for py_manifest in ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"]:
            if (root / py_manifest).exists():
                if "python" not in languages:
                    languages.append("python")
                break
        if "python" in languages:
            test_runner = test_runner or "pytest"
            test_patterns["python"] = "def test_xxx():"
            for py_file in ["pyproject.toml", "requirements.txt"]:
                try:
                    content = (root / py_file).read_text(encoding="utf-8", errors="replace")
                    for framework, keyword in [
                        ("fastapi", "fastapi"),
                        ("django", "django"),
                        ("flask", "flask"),
                        ("starlette", "starlette"),
                    ]:
                        if keyword.lower() in content.lower() and framework not in frameworks:
                            frameworks.append(framework)
                except OSError:
                    pass

        # --- Node / TypeScript ---
        pkg_json = root / "package.json"
        if pkg_json.exists():
            try:
                pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
                deps = {
                    **pkg.get("dependencies", {}),
                    **pkg.get("devDependencies", {}),
                }
                # Detect language
                if "typescript" in deps or (root / "tsconfig.json").exists():
                    if "typescript" not in languages:
                        languages.append("typescript")
                else:
                    if "javascript" not in languages:
                        languages.append("javascript")

                # Detect frontend test runner
                if "vitest" in deps:
                    frontend_test = "vitest"
                    test_patterns["ts"] = "describe/it with vitest"
                elif "jest" in deps:
                    frontend_test = "jest"
                    test_patterns["ts"] = "describe/it with jest"

                # Detect frameworks
                for framework, pkg_name in [
                    ("react", "react"),
                    ("vue", "vue"),
                    ("svelte", "svelte"),
                    ("next.js", "next"),
                    ("express", "express"),
                    ("fastify", "fastify"),
                    ("vite", "vite"),
                    ("tauri", "@tauri-apps/api"),
                ]:
                    if pkg_name in deps and framework not in frameworks:
                        frameworks.append(framework)
            except (OSError, json.JSONDecodeError):
                pass

        return {
            "languages": languages,
            "frameworks": frameworks,
            "test_runner": test_runner,
            "frontend_test": frontend_test,
            "test_patterns": test_patterns,
        }

    def discover_project_structure(self) -> dict:
        """Map top-level directory structure.

        Returns:
            {"directories": {...}, "entry_points": [...]}
        """
        root = Path(self.project_dir)
        directories: dict = {}
        entry_points: list[str] = []

        # Common entry point candidates
        entry_candidates = [
            "cmd/server/main.go",
            "cmd/main.go",
            "main.go",
            "main.py",
            "src/main.tsx",
            "src/main.ts",
            "frontend/src/main.tsx",
            "app/main.py",
            "manage.py",
        ]
        for candidate in entry_candidates:
            if (root / candidate).exists():
                entry_points.append(candidate)

        # Top-level directories with sub-counts
        try:
            for item in sorted(root.iterdir()):
                if not item.is_dir():
                    continue
                if item.name.startswith("."):
                    continue
                if item.name in {"node_modules", "target", "__pycache__", ".git", "vendor"}:
                    continue

                # Count direct children
                try:
                    child_count = sum(1 for _ in item.iterdir())
                except OSError:
                    child_count = 0

                directories[item.name] = child_count
        except OSError:
            pass

        return {
            "directories": directories,
            "entry_points": entry_points,
        }

    # -------------------------------------------------------------------------
    # Serialization
    # -------------------------------------------------------------------------

    def to_json(self) -> str:
        """Serialize metadata to JSON for storage."""
        return json.dumps(self._cache, indent=2, ensure_ascii=False)

    @classmethod
    def from_json(cls, project_dir: str, data: str) -> "ProjectMetadata":
        """Load from cached JSON."""
        instance = cls(project_dir)
        instance._cache = json.loads(data)
        return instance

    # -------------------------------------------------------------------------
    # Persistence helpers
    # -------------------------------------------------------------------------

    def save(self, state_dir: str):
        """Save to state_dir/metadata.json."""
        path = Path(state_dir) / "metadata.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_json(), encoding="utf-8")

    @classmethod
    def load(cls, project_dir: str, state_dir: str) -> "ProjectMetadata | None":
        """Load from state_dir/metadata.json if fresh enough (< 1 hour).

        Returns None if missing or stale.
        """
        path = Path(state_dir) / "metadata.json"
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
    # Convenience accessor
    # -------------------------------------------------------------------------

    def get(self, section: str | None = None) -> dict:
        """Return full cache or a specific section.

        Args:
            section: One of migration_number, id_patterns, bounded_contexts,
                     tech_stack, project_structure. If None, returns all.
        """
        if not self._cache:
            return {}
        if section is None:
            return self._cache
        return self._cache.get(section, {})
