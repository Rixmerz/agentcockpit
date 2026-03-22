"""Tool indexing, learned weights, and semantic search.

Provides tool discovery via keyword-based semantic search with
a dynamic weight learning system that improves results over time.
"""

import json
import sys
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path


# ============================================================================
# Tool Categories for Semantic Search
# ============================================================================

TOOL_CATEGORIES = {
    "containers": {
        "patterns": ["container_", "docker_run", "docker_exec", "docker_start", "docker_stop"],
        "keywords": ["container", "docker", "run", "exec", "start", "stop", "restart"],
        "description": "Container lifecycle management"
    },
    "images": {
        "patterns": ["image_", "docker_pull", "docker_build", "docker_push"],
        "keywords": ["image", "pull", "build", "push", "registry"],
        "description": "Image management"
    },
    "chaos": {
        "patterns": ["fault_", "inject_", "chaos_", "scenario_"],
        "keywords": ["fault", "inject", "chaos", "failure", "stress", "cpu", "memory", "network"],
        "description": "Chaos engineering and fault injection"
    },
    "metrics": {
        "patterns": ["metric_", "baseline_", "capture_", "stats_", "monitor_"],
        "keywords": ["metric", "baseline", "capture", "stats", "monitor", "observe"],
        "description": "Metrics and observability"
    },
    "tunnels": {
        "patterns": ["tunnel_", "expose_", "port_forward", "ngrok"],
        "keywords": ["tunnel", "expose", "port", "forward", "public", "internet", "url"],
        "description": "Tunnels and service exposure"
    },
    "knowledge": {
        "patterns": ["kg_", "memory_", "pattern_", "workflow_", "context_"],
        "keywords": ["knowledge", "memory", "pattern", "workflow", "context", "learn"],
        "description": "Knowledge graph and memory"
    },
    "workflow": {
        "patterns": ["workflow_"],
        "keywords": ["workflow", "step", "advance", "reset", "gate"],
        "description": "Workflow flow control"
    },
    "thinking": {
        "patterns": ["sequential", "think", "reason"],
        "keywords": ["think", "reason", "analyze", "sequential", "step-by-step"],
        "description": "Reasoning and structured thinking"
    },
    "docs": {
        "patterns": ["get-library-docs", "resolve-library", "search_"],
        "keywords": ["docs", "documentation", "library", "api", "reference"],
        "description": "Documentation retrieval"
    }
}

# Stopwords to filter from queries (common words that add noise)
STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "dare",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "each", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own",
    "same", "so", "than", "too", "very", "just", "and", "but", "if", "or",
    "because", "until", "while", "about", "against", "between", "into",
    "through", "during", "before", "after", "above", "below", "up", "down",
    "out", "off", "over", "under", "again", "further", "then", "once",
    "que", "de", "la", "el", "en", "un", "una", "los", "las", "por", "para",
    "con", "del", "al", "es", "son", "como", "más", "pero", "sus", "le",
    "ya", "o", "este", "sí", "porque", "esta", "entre", "cuando", "muy",
    "sin", "sobre", "también", "me", "hasta", "hay", "donde", "quien",
    "desde", "todo", "nos", "durante", "todos", "uno", "les", "ni", "contra",
    "otros", "ese", "eso", "ante", "ellos", "e", "esto", "mí", "antes",
    "algunos", "qué", "unos", "yo", "otro", "otras", "otra", "él", "tanto",
    "esa", "estos", "mucho", "quienes", "nada", "muchos", "cual", "poco",
    "ella", "estar", "estas", "algunas", "algo", "nosotros"
}


# ============================================================================
# Dynamic Weight Learning System (Global)
# ============================================================================

# Global path for learned weights (shared across all projects)
LEARNED_WEIGHTS_FILE = Path.home() / ".workflow-manager" / "learned_weights.json"

# In-memory cache of learned weights
# Structure: {"mcp:tool_name": {"keyword": weight, ...}, ...}
_learned_weights: dict[str, dict[str, float]] = {}

# Tracking for last search (to correlate with tool selection)
_last_search_query: str | None = None
_last_search_results: list[dict] = []

# Weight learning parameters
WEIGHT_INCREMENT = 0.15  # How much to increase weight per selection
WEIGHT_MAX = 2.0  # Maximum weight cap
WEIGHT_DECAY = 0.01  # Decay per day for unused weights (future use)

# Tool index cache for semantic search
_tool_index: dict[str, list[dict]] = {}


def load_learned_weights() -> dict[str, dict[str, float]]:
    """Load learned weights from global file."""
    global _learned_weights

    if LEARNED_WEIGHTS_FILE.exists():
        try:
            data = json.loads(LEARNED_WEIGHTS_FILE.read_text())
            _learned_weights = data.get("weights", {})
            return _learned_weights
        except Exception as e:
            print(f"[workflow-manager] Warning: failed to load learned weights: {e}", file=sys.stderr)
            pass

    _learned_weights = {}
    return _learned_weights


def save_learned_weights():
    """Save learned weights to global file."""
    global _learned_weights

    # Ensure directory exists
    LEARNED_WEIGHTS_FILE.parent.mkdir(parents=True, exist_ok=True)

    data = {
        "weights": _learned_weights,
        "last_updated": datetime.now().isoformat(),
        "version": "1.0"
    }

    LEARNED_WEIGHTS_FILE.write_text(json.dumps(data, indent=2))


def extract_keywords(text: str) -> set[str]:
    """Extract meaningful keywords from text, filtering stopwords."""
    words = set(text.lower().replace("_", " ").replace("-", " ").split())
    return {w for w in words if len(w) > 2 and w not in STOPWORDS}


def record_tool_selection(query: str, mcp_name: str, tool_name: str):
    """Record that a tool was selected for a query, incrementing weights."""
    global _learned_weights

    # Load weights if not loaded
    if not _learned_weights:
        load_learned_weights()

    tool_key = f"{mcp_name}:{tool_name}"
    keywords = extract_keywords(query)

    if not keywords:
        return

    if tool_key not in _learned_weights:
        _learned_weights[tool_key] = {}

    for keyword in keywords:
        current = _learned_weights[tool_key].get(keyword, 0.0)
        # Increment with cap
        _learned_weights[tool_key][keyword] = min(current + WEIGHT_INCREMENT, WEIGHT_MAX)

    # Persist to disk
    save_learned_weights()


def get_learned_boost(query: str, mcp_name: str, tool_name: str) -> float:
    """Calculate learned boost for a tool given a query."""
    global _learned_weights

    # Load weights if not loaded
    if not _learned_weights:
        load_learned_weights()

    tool_key = f"{mcp_name}:{tool_name}"

    if tool_key not in _learned_weights:
        return 0.0

    keywords = extract_keywords(query)
    if not keywords:
        return 0.0

    tool_weights = _learned_weights[tool_key]

    # Sum weights for matching keywords
    total_boost = sum(tool_weights.get(kw, 0.0) for kw in keywords)

    # Normalize by number of query keywords
    return total_boost / len(keywords)


def set_last_search(query: str, results: list[dict]):
    """Track the last search for correlation with tool selection."""
    global _last_search_query, _last_search_results
    _last_search_query = query
    _last_search_results = results


def check_and_record_selection(mcp_name: str, tool_name: str):
    """Check if this tool was in the last search results and record selection."""
    global _last_search_query, _last_search_results

    if not _last_search_query or not _last_search_results:
        return

    # Check if this tool was in the search results
    for result in _last_search_results:
        if result.get("mcp") == mcp_name and result.get("tool") == tool_name:
            # Tool was in results! Record the selection
            record_tool_selection(_last_search_query, mcp_name, tool_name)
            break


def detect_tool_category(name: str, description: str) -> str:
    """Detect category for a tool based on name and description patterns."""
    name_lower = name.lower()
    desc_lower = description.lower() if description else ""

    for cat_name, cat_info in TOOL_CATEGORIES.items():
        # Check patterns in name
        for pattern in cat_info.get("patterns", []):
            if pattern in name_lower:
                return cat_name

        # Check keywords in name or description
        for keyword in cat_info.get("keywords", []):
            if keyword in name_lower or keyword in desc_lower:
                return cat_name

    return "other"


def build_tool_index(mcp_name: str, tools: list[dict]) -> list[dict]:
    """Build searchable index of tools with extracted keywords."""
    indexed = []
    for tool in tools:
        name = tool.get("name", "")
        desc = tool.get("description", "")

        # Extract keywords from name (split on underscore, dash, camelCase)
        name_words = set(name.lower().replace("_", " ").replace("-", " ").split())

        # Extract meaningful words from description (>3 chars)
        desc_words = set(
            word.lower().strip(".,;:()[]{}")
            for word in desc.split()
            if len(word) > 3
        )

        # Detect category
        category = detect_tool_category(name, desc)

        indexed.append({
            "name": name,
            "description": desc[:150] if desc else "",  # Truncate for token efficiency
            "keywords": name_words | desc_words,
            "category": category
        })

    return indexed


def get_tool_index() -> dict[str, list[dict]]:
    """Get the current tool index (read access for other modules)."""
    return _tool_index


def set_tool_index_entry(mcp_name: str, indexed: list[dict]):
    """Set a tool index entry for an MCP."""
    _tool_index[mcp_name] = indexed


def semantic_search(query: str, mcp_filter: str | None = None, max_results: int = 10) -> list[dict]:
    """Search tools by objective/description using semantic similarity + learned weights."""
    # Extract keywords filtering stopwords
    query_words = extract_keywords(query)

    if not query_words:
        # Fallback to raw words if all were stopwords
        query_words = set(query.lower().split())

    results = []

    for mcp_name, tools in _tool_index.items():
        if mcp_filter and mcp_name != mcp_filter:
            continue

        for tool in tools:
            # Base score: keyword intersection + string similarity
            keyword_score = len(query_words & tool["keywords"]) / max(len(query_words), 1)
            name_score = SequenceMatcher(None, query.lower(), tool["name"].lower()).ratio()
            desc_score = SequenceMatcher(None, query.lower(), tool["description"].lower()).ratio()

            # Base weighted combination
            base_score = (keyword_score * 0.5) + (name_score * 0.3) + (desc_score * 0.2)

            # Apply learned boost from user selections
            learned_boost = get_learned_boost(query, mcp_name, tool["name"])

            # Final score = base + learned (learned can significantly boost)
            final_score = base_score + learned_boost

            if final_score > 0.15:  # Minimum threshold
                results.append({
                    "mcp": mcp_name,
                    "tool": tool["name"],
                    "description": tool["description"],
                    "category": tool.get("category", "other"),
                    "score": round(final_score, 2),
                    "learned_boost": round(learned_boost, 2) if learned_boost > 0 else None
                })

    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)

    # Track this search for selection correlation
    final_results = results[:max_results]
    set_last_search(query, final_results)

    return final_results


def get_tools_by_category(mcp_name: str | None, category: str, limit: int = 20) -> list[dict]:
    """Get tools filtered by category."""
    results = []

    for mcp, tools in _tool_index.items():
        if mcp_name and mcp != mcp_name:
            continue

        for tool in tools:
            if tool.get("category") == category:
                results.append({
                    "mcp": mcp,
                    "name": tool["name"],
                    "description": tool["description"]
                })

                if len(results) >= limit:
                    return results

    return results


def get_learned_weights_data() -> dict[str, dict[str, float]]:
    """Get learned weights data (read access for tools)."""
    global _learned_weights
    if not _learned_weights:
        load_learned_weights()
    return _learned_weights


def reset_all_learned_weights():
    """Reset all learned weights to empty."""
    global _learned_weights
    _learned_weights = {}
    save_learned_weights()
