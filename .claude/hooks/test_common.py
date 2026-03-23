"""Tests for .claude/hooks/_common.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import _DOMAIN_MAP, extract_keywords, guess_domain


# ---------------------------------------------------------------------------
# extract_keywords
# ---------------------------------------------------------------------------

def test_extract_keywords_auth_service():
    # stem is lowercased before splitting, so camelCase is NOT split.
    # "authService" -> stem "authservice" -> one token; parent "services" added.
    keywords = extract_keywords("src/services/authService.ts")
    assert "authservice" in keywords
    assert "services" in keywords


def test_extract_keywords_login_form():
    # "LoginForm" -> stem "loginform" (lowercased); parent "components" added.
    keywords = extract_keywords("src/components/LoginForm.tsx")
    assert "loginform" in keywords
    assert "components" in keywords


def test_extract_keywords_returns_list():
    result = extract_keywords("src/utils/helpers.ts")
    assert isinstance(result, list)


def test_extract_keywords_no_short_words():
    # Words with length <= 1 should not appear
    keywords = extract_keywords("src/a/b.ts")
    for kw in keywords:
        assert len(kw) > 1


def test_extract_keywords_deduplicates():
    # Duplicate words from path splitting should be deduplicated
    keywords = extract_keywords("src/auth/auth.ts")
    assert keywords.count("auth") == 1


def test_extract_keywords_camel_case_stem_lowercased():
    # stem is lowercased before splitting — camelCase is NOT split into parts.
    # "userRepository" -> "userrepository"; parent "services" is appended.
    keywords = extract_keywords("src/services/userRepository.ts")
    assert "userrepository" in keywords
    assert "services" in keywords


def test_extract_keywords_pascal_case_stem_lowercased():
    # "UserProfile" -> stem "userprofile"; parent "components" appended.
    keywords = extract_keywords("src/components/UserProfile.tsx")
    assert "userprofile" in keywords
    assert "components" in keywords


def test_extract_keywords_excludes_src_parent():
    # "src" as parent should not be added
    keywords = extract_keywords("src/helpers.ts")
    assert "src" not in keywords


# ---------------------------------------------------------------------------
# guess_domain
# ---------------------------------------------------------------------------

def test_guess_domain_auth():
    assert guess_domain("src/services/authService.ts") == "auth"


def test_guess_domain_ui_modal():
    assert guess_domain("src/components/Modal.tsx") == "ui"


def test_guess_domain_ui_form():
    assert guess_domain("src/components/LoginForm.tsx") == "ui"


def test_guess_domain_util_helpers():
    assert guess_domain("src/utils/helpers.ts") == "util"


def test_guess_domain_data_schema():
    assert guess_domain("src/db/schema.py") == "data"


def test_guess_domain_unknown_returns_general():
    assert guess_domain("src/unknown/xyz.ts") == "general"


def test_guess_domain_api():
    assert guess_domain("src/api/userController.ts") == "api"


def test_guess_domain_config():
    assert guess_domain("src/config/settings.ts") == "config"


def test_guess_domain_style():
    assert guess_domain("src/styles/theme.css") == "style"


# ---------------------------------------------------------------------------
# _DOMAIN_MAP structure
# ---------------------------------------------------------------------------

def test_domain_map_has_expected_keys():
    expected_keys = {"auth", "api", "ui", "config", "data", "style", "util"}
    assert expected_keys == set(_DOMAIN_MAP.keys())


def test_domain_map_values_are_lists():
    for domain, keywords in _DOMAIN_MAP.items():
        assert isinstance(keywords, list), f"Domain '{domain}' value should be a list"
        assert len(keywords) > 0, f"Domain '{domain}' should have at least one keyword"


def test_domain_map_auth_keywords():
    assert "auth" in _DOMAIN_MAP["auth"]
    assert "login" in _DOMAIN_MAP["auth"]


def test_domain_map_ui_keywords():
    assert "component" in _DOMAIN_MAP["ui"]
    assert "form" in _DOMAIN_MAP["ui"]
    assert "modal" in _DOMAIN_MAP["ui"]


def test_domain_map_util_keywords():
    assert "util" in _DOMAIN_MAP["util"]
    assert "helper" in _DOMAIN_MAP["util"]
