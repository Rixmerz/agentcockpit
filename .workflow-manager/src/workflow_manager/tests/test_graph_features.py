"""Integration tests for graph features: contract files, agent output forwarding,
and graph parser contract support.
"""

import json
from pathlib import Path

import pytest

from workflow_manager.graph_engine import (
    GraphState,
    Node,
    PathEntry,
    _cleanup_contract_files,
    _write_contract_files,
)
from workflow_manager.graph_parser import parse_graph_yaml
from workflow_manager.graph_state import get_graph_state_file, load_graph_state, save_graph_state


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_node(
    node_id: str = "n1",
    contracts: list[dict] | None = None,
) -> Node:
    """Return a minimal Node, optionally with contracts."""
    return Node(id=node_id, name=node_id, contracts=contracts)


def _make_state_with_path(entries: list[PathEntry]) -> GraphState:
    """Return a GraphState whose execution_path is the given entries."""
    return GraphState(
        current_nodes=["n1"],
        execution_path=entries,
        active_graph="test-graph",
    )


# ---------------------------------------------------------------------------
# Contract Files Tests
# ---------------------------------------------------------------------------


class TestWriteContractFiles:
    def test_write_contract_files_creates_files(self, tmp_path: Path) -> None:
        """Node with contracts writes each file to disk."""
        content = "export interface Foo { bar: string; }"
        node = _make_node(contracts=[{"file": "types.ts", "content": content}])

        written = _write_contract_files(node, str(tmp_path))

        assert len(written) == 1
        file_path = Path(written[0])
        assert file_path.exists()
        assert file_path.read_text(encoding="utf-8") == content

    def test_write_contract_files_no_contracts(self, tmp_path: Path) -> None:
        """Node with contracts=None returns empty list and creates no files."""
        node = _make_node(contracts=None)

        written = _write_contract_files(node, str(tmp_path))

        assert written == []
        # tmp_path itself exists but nothing inside it was created by the call
        created_files = list(tmp_path.rglob("*"))
        assert created_files == []

    def test_write_contract_files_nested_dirs(self, tmp_path: Path) -> None:
        """Contract file in a nested path causes parent directories to be created."""
        content = "export type ApiResponse = { ok: boolean };"
        node = _make_node(
            contracts=[{"file": "src/types/api.ts", "content": content}]
        )

        written = _write_contract_files(node, str(tmp_path))

        assert len(written) == 1
        file_path = Path(written[0])
        assert file_path.exists()
        assert file_path.parent == tmp_path / "src" / "types"
        assert file_path.read_text(encoding="utf-8") == content

    def test_write_multiple_contracts(self, tmp_path: Path) -> None:
        """Multiple contracts in one node are all written."""
        contracts = [
            {"file": "a.ts", "content": "type A = string;"},
            {"file": "b.ts", "content": "type B = number;"},
        ]
        node = _make_node(contracts=contracts)

        written = _write_contract_files(node, str(tmp_path))

        assert len(written) == 2
        for contract in contracts:
            file_path = tmp_path / contract["file"]
            assert file_path.exists()
            assert file_path.read_text(encoding="utf-8") == contract["content"]


class TestCleanupContractFiles:
    def test_cleanup_contract_files_removes_stubs(self, tmp_path: Path) -> None:
        """Contract files still containing the original stub content are deleted."""
        content = "export interface Stub {}"
        node = _make_node(contracts=[{"file": "stub.ts", "content": content}])
        _write_contract_files(node, str(tmp_path))

        deleted = _cleanup_contract_files(node, str(tmp_path))

        assert len(deleted) == 1
        assert not Path(deleted[0]).exists()

    def test_cleanup_contract_files_preserves_modified(self, tmp_path: Path) -> None:
        """Contract files whose content has changed are left untouched."""
        stub_content = "export interface Stub {}"
        real_content = "export interface Stub { id: number; name: string; }"
        node = _make_node(contracts=[{"file": "stub.ts", "content": stub_content}])

        # Write the stub, then simulate an agent replacing it
        _write_contract_files(node, str(tmp_path))
        (tmp_path / "stub.ts").write_text(real_content, encoding="utf-8")

        deleted = _cleanup_contract_files(node, str(tmp_path))

        assert deleted == []
        # The real implementation must still exist
        assert (tmp_path / "stub.ts").exists()
        assert (tmp_path / "stub.ts").read_text(encoding="utf-8") == real_content

    def test_cleanup_contract_files_no_contracts(self, tmp_path: Path) -> None:
        """Node with contracts=None returns empty list from cleanup."""
        node = _make_node(contracts=None)

        deleted = _cleanup_contract_files(node, str(tmp_path))

        assert deleted == []

    def test_cleanup_skips_missing_files(self, tmp_path: Path) -> None:
        """Cleanup is silent when a contract file was never written."""
        node = _make_node(
            contracts=[{"file": "never_written.ts", "content": "type X = never;"}]
        )

        # No prior write — the file does not exist
        deleted = _cleanup_contract_files(node, str(tmp_path))

        assert deleted == []


# ---------------------------------------------------------------------------
# Agent Output Forwarding Tests
# ---------------------------------------------------------------------------


class TestPathEntryOutputs:
    def test_path_entry_outputs_default_none(self) -> None:
        """A newly created PathEntry has outputs=None by default."""
        entry = PathEntry(
            from_node=None,
            to_node="n1",
            edge_id=None,
            timestamp="2026-01-01T00:00:00",
            reason="init",
        )

        assert entry.outputs is None

    def test_path_entry_outputs_serialization(self, tmp_path: Path) -> None:
        """PathEntry with outputs is preserved through a save/load round-trip."""
        outputs = {"result": "ok", "count": "42"}
        entry = PathEntry(
            from_node=None,
            to_node="n1",
            edge_id=None,
            timestamp="2026-01-01T00:00:00",
            reason="init",
            outputs=outputs,
        )
        state = _make_state_with_path([entry])

        save_graph_state(str(tmp_path), state)
        loaded = load_graph_state(str(tmp_path))

        assert len(loaded.execution_path) == 1
        assert loaded.execution_path[0].outputs == outputs

    def test_path_entry_outputs_none_not_serialized(self, tmp_path: Path) -> None:
        """PathEntry with outputs=None must NOT write an 'outputs' key to JSON."""
        entry = PathEntry(
            from_node=None,
            to_node="n1",
            edge_id=None,
            timestamp="2026-01-01T00:00:00",
            reason="init",
            outputs=None,
        )
        state = _make_state_with_path([entry])

        save_graph_state(str(tmp_path), state)

        # Use the same path resolution used by save_graph_state so the test is
        # correct regardless of whether a hub is configured or not.
        state_file = get_graph_state_file(str(tmp_path))
        raw = json.loads(state_file.read_text(encoding="utf-8"))
        serialized_entry = raw["execution_path"][0]

        assert "outputs" not in serialized_entry

    def test_state_round_trip_with_outputs(self, tmp_path: Path) -> None:
        """Full GraphState with multiple path entries (some with outputs) survives round-trip."""
        entries = [
            PathEntry(
                from_node=None,
                to_node="start",
                edge_id=None,
                timestamp="2026-01-01T00:00:00",
                reason="init",
                outputs=None,
            ),
            PathEntry(
                from_node="start",
                to_node="impl",
                edge_id="e1",
                timestamp="2026-01-01T00:01:00",
                reason="manual",
                outputs={"files": "3", "coverage": "82"},
            ),
            PathEntry(
                from_node="impl",
                to_node="review",
                edge_id="e2",
                timestamp="2026-01-01T00:02:00",
                reason="phrase match",
                outputs={"approved": "true"},
            ),
        ]
        state = GraphState(
            current_nodes=["review"],
            node_visits={"start": 1, "impl": 1, "review": 1},
            execution_path=entries,
            active_graph="test",
            total_transitions=2,
        )

        save_graph_state(str(tmp_path), state)
        loaded = load_graph_state(str(tmp_path))

        assert len(loaded.execution_path) == 3
        assert loaded.execution_path[0].outputs is None
        assert loaded.execution_path[1].outputs == {"files": "3", "coverage": "82"}
        assert loaded.execution_path[2].outputs == {"approved": "true"}
        assert loaded.current_nodes == ["review"]
        assert loaded.total_transitions == 2


# ---------------------------------------------------------------------------
# Graph Parser Tests (contracts in YAML)
# ---------------------------------------------------------------------------


def _minimal_graph_yaml(nodes_block: str) -> str:
    """Return a minimal valid graph YAML wrapping the provided nodes block."""
    return f"""\
metadata:
  name: test
nodes:
{nodes_block}
edges:
  - id: e1
    from: start
    to: end
    condition:
      type: always
"""


class TestParseNodeWithContracts:
    def test_parse_node_with_contracts(self) -> None:
        """A YAML node definition with a contracts list produces Node.contracts."""
        yaml_content = _minimal_graph_yaml(
            """\
  - id: start
    name: Start
    is_start: true
    contracts:
      - file: types.ts
        content: export interface Foo {}
  - id: end
    name: End
    is_end: true
"""
        )

        graph = parse_graph_yaml(yaml_content)

        start = graph.nodes["start"]
        assert start.contracts is not None
        assert len(start.contracts) == 1
        assert start.contracts[0]["file"] == "types.ts"
        assert start.contracts[0]["content"] == "export interface Foo {}"

    def test_parse_node_without_contracts(self) -> None:
        """A YAML node without a contracts field yields Node.contracts == None."""
        yaml_content = _minimal_graph_yaml(
            """\
  - id: start
    name: Start
    is_start: true
  - id: end
    name: End
    is_end: true
"""
        )

        graph = parse_graph_yaml(yaml_content)

        start = graph.nodes["start"]
        assert start.contracts is None

    def test_parse_node_with_multiple_contracts(self) -> None:
        """Multiple contract entries under a single node are all parsed."""
        yaml_content = _minimal_graph_yaml(
            """\
  - id: start
    name: Start
    is_start: true
    contracts:
      - file: types/a.ts
        content: export type A = string
      - file: types/b.ts
        content: export type B = number
  - id: end
    name: End
    is_end: true
"""
        )

        graph = parse_graph_yaml(yaml_content)

        contracts = graph.nodes["start"].contracts
        assert contracts is not None
        assert len(contracts) == 2
        files = {c["file"] for c in contracts}
        assert files == {"types/a.ts", "types/b.ts"}

    def test_parse_end_node_without_contracts(self) -> None:
        """End node without contracts also yields Node.contracts == None."""
        yaml_content = _minimal_graph_yaml(
            """\
  - id: start
    name: Start
    is_start: true
  - id: end
    name: End
    is_end: true
"""
        )

        graph = parse_graph_yaml(yaml_content)

        end = graph.nodes["end"]
        assert end.contracts is None
