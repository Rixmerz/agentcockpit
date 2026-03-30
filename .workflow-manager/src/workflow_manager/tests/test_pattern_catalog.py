"""Tests for pattern_catalog.py — PatternCatalog discovery and persistence."""
import json
import os
import time
from pathlib import Path

import pytest

from workflow_manager.pattern_catalog import PatternCatalog, _detect_language


class TestFindRepresentativeFile:
    def test_find_representative_file_matching(self, tmp_path):
        """File matching a glob pattern is returned."""
        repo_dir = tmp_path / "src" / "repositories"
        repo_dir.mkdir(parents=True)
        repo_file = repo_dir / "userRepository.ts"
        repo_file.write_text("export class UserRepository {}")

        catalog = PatternCatalog(str(tmp_path))
        result = catalog._find_representative_file(["src/**/*Repository.ts"])

        assert result is not None
        assert result.name == "userRepository.ts"

    def test_find_representative_file_excluded(self, tmp_path):
        """Files matching exclude_keywords are skipped."""
        test_dir = tmp_path / "src"
        test_dir.mkdir()
        (test_dir / "userRepository.test.ts").write_text("describe('repo', () => {})")

        catalog = PatternCatalog(str(tmp_path))
        result = catalog._find_representative_file(
            ["src/**/*.ts"],
            exclude_keywords=[".test."],
        )

        assert result is None

    def test_find_representative_file_none_when_empty(self, tmp_path):
        """Empty project dir returns None."""
        catalog = PatternCatalog(str(tmp_path))
        result = catalog._find_representative_file(["**/*.go"])

        assert result is None

    def test_find_representative_file_require_test(self, tmp_path):
        """require_test=True only returns test files."""
        src = tmp_path / "src"
        src.mkdir()
        (src / "userService.py").write_text("class UserService: pass")
        test_file = src / "test_user.py"
        test_file.write_text("def test_create(): pass")

        catalog = PatternCatalog(str(tmp_path))
        result = catalog._find_representative_file(
            ["src/**/*.py"],
            require_test=True,
        )

        assert result is not None
        assert result.name == "test_user.py"

    def test_find_representative_file_skips_empty_files(self, tmp_path):
        """Zero-byte files are skipped."""
        src = tmp_path / "src"
        src.mkdir()
        empty = src / "empty_repository.py"
        empty.write_text("")
        real = src / "order_repository.py"
        real.write_text("class OrderRepository: pass")

        catalog = PatternCatalog(str(tmp_path))
        result = catalog._find_representative_file(["src/**/*_repository.py"])

        assert result is not None
        assert result.name == "order_repository.py"


class TestExtractSnippet:
    def test_extract_snippet_small_file(self, tmp_path):
        """File under 2000 chars is returned as-is."""
        content = "def hello():\n    return 'world'\n"
        f = tmp_path / "small.py"
        f.write_text(content)

        catalog = PatternCatalog(str(tmp_path))
        snippet = catalog._extract_snippet(f)

        assert snippet == content

    def test_extract_snippet_large_file(self, tmp_path):
        """File over 2000 chars gets truncated and includes key sections."""
        # Build a file > 2000 chars: each function body is padded with comments
        imports = "import os\nimport sys\n"
        func1 = "def first_function():\n" + "    # comment line padding\n" * 60
        func2 = "def second_function():\n" + "    # comment line padding\n" * 60
        func3 = "def third_function():\n" + "    # comment line padding\n" * 60
        big_content = imports + func1 + func2 + func3

        assert len(big_content) > 2000, f"content too short: {len(big_content)}"

        f = tmp_path / "big.py"
        f.write_text(big_content)

        catalog = PatternCatalog(str(tmp_path))
        snippet = catalog._extract_snippet(f)

        assert len(snippet) <= 2000
        assert "import os" in snippet or "def first_function" in snippet

    def test_extract_snippet_missing_file(self, tmp_path):
        """OSError on missing file returns empty string."""
        catalog = PatternCatalog(str(tmp_path))
        snippet = catalog._extract_snippet(tmp_path / "nonexistent.py")

        assert snippet == ""


class TestDiscoverAll:
    def test_discover_all_empty_project(self, tmp_path):
        """Empty directory returns empty patterns dict."""
        catalog = PatternCatalog(str(tmp_path))
        patterns = catalog.discover_all()

        assert patterns == {}

    def test_discover_all_finds_test_pattern(self, tmp_path):
        """A test file in the project is detected as test_unit pattern."""
        test_dir = tmp_path / "src" / "services"
        test_dir.mkdir(parents=True)
        test_file = test_dir / "test_user_service.py"
        test_file.write_text("def test_create_user():\n    assert True\n")

        catalog = PatternCatalog(str(tmp_path))
        patterns = catalog.discover_all()

        assert "test_unit" in patterns

    def test_discover_all_finds_repository_pattern(self, tmp_path):
        """A repository file is detected as repository pattern."""
        repo_dir = tmp_path / "src" / "repositories"
        repo_dir.mkdir(parents=True)
        (repo_dir / "user_repository.py").write_text(
            "class UserRepository:\n    def find_by_id(self, id):\n        pass\n"
        )

        catalog = PatternCatalog(str(tmp_path))
        patterns = catalog.discover_all()

        assert "repository" in patterns


class TestToPromptInjectionFormat:
    def test_to_prompt_injection_format(self, tmp_path):
        """Output is valid markdown with code blocks."""
        catalog = PatternCatalog(str(tmp_path))
        catalog.patterns = {
            "repository": {
                "source_file": "src/userRepository.ts",
                "language": "typescript",
                "snippet": "export class UserRepository {}",
            }
        }

        output = catalog.to_prompt_injection()

        assert "## Project Patterns" in output
        assert "### repository" in output
        assert "```typescript" in output
        assert "```" in output
        assert "UserRepository" in output

    def test_to_prompt_injection_empty_patterns(self, tmp_path):
        """Empty patterns → only header line."""
        catalog = PatternCatalog(str(tmp_path))
        catalog.patterns = {}

        output = catalog.to_prompt_injection()

        assert "## Project Patterns" in output


class TestSaveLoadRoundTrip:
    def test_save_load_round_trip(self, tmp_path):
        """Save patterns then load back, verify equality."""
        state_dir = str(tmp_path / "state")

        catalog = PatternCatalog(str(tmp_path))
        catalog.patterns = {
            "repository": {
                "source_file": "src/repo.py",
                "language": "python",
                "snippet": "class Repo: pass",
            }
        }
        catalog.save(state_dir)

        loaded = PatternCatalog.load(str(tmp_path), state_dir)

        assert loaded is not None
        assert loaded.patterns == catalog.patterns

    def test_load_stale_cache(self, tmp_path):
        """Cache file older than 2 hours returns None."""
        state_dir = str(tmp_path / "state")

        catalog = PatternCatalog(str(tmp_path))
        catalog.patterns = {"handler": {"source_file": "x.py", "language": "python", "snippet": ""}}
        catalog.save(state_dir)

        cache_path = Path(state_dir) / "patterns.json"
        old_time = time.time() - 7201
        os.utime(str(cache_path), (old_time, old_time))

        loaded = PatternCatalog.load(str(tmp_path), state_dir)
        assert loaded is None

    def test_load_missing_cache(self, tmp_path):
        """Missing cache file returns None."""
        loaded = PatternCatalog.load(str(tmp_path), str(tmp_path / "no_state"))
        assert loaded is None


class TestDetectLanguage:
    def test_detect_language_known_extensions(self):
        assert _detect_language(Path("foo.ts")) == "typescript"
        assert _detect_language(Path("bar.py")) == "python"
        assert _detect_language(Path("main.go")) == "go"
        assert _detect_language(Path("lib.rs")) == "rust"
        assert _detect_language(Path("page.tsx")) == "tsx"
        assert _detect_language(Path("query.sql")) == "sql"

    def test_detect_language_unknown_extension(self):
        result = _detect_language(Path("file.xyz"))
        assert result == "xyz"
