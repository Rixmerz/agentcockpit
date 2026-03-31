"""Integration tests for graph features: contract files, agent output forwarding,
and graph parser contract support.
"""

import json
from pathlib import Path

import pytest

from workflow_manager.graph_engine import (
    Edge,
    EdgeCondition,
    Graph,
    GraphState,
    Node,
    PathEntry,
    Task,
    _cleanup_contract_files,
    _write_contract_files,
    compute_ready_tasks,
    is_dag_complete,
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


# ---------------------------------------------------------------------------
# DAG Helpers
# ---------------------------------------------------------------------------


def _make_dag_graph(tasks: list[Task]) -> tuple[Graph, GraphState]:
    """Build a minimal Graph with a single DAG node containing the given tasks."""
    dag_node = Node(
        id="dag1",
        name="DAG Node",
        node_type="dag",
        tasks=tasks,
        is_start=True,
    )
    end_node = Node(id="done", name="Done", is_end=True)
    edge = Edge(
        id="dag1-done",
        from_node="dag1",
        to_node="done",
        condition=EdgeCondition(type="always"),
    )
    graph = Graph(
        metadata={"name": "test"},
        nodes={"dag1": dag_node, "done": end_node},
        edges=[edge],
    )
    state = GraphState(current_nodes=["dag1"])
    return graph, state


# ---------------------------------------------------------------------------
# TestTask
# ---------------------------------------------------------------------------


class TestTask:
    def test_task_defaults(self) -> None:
        """Task with only id and name has sensible defaults."""
        task = Task(id="a", name="Task A")

        assert task.dependencies == []
        assert task.outputs == {}
        assert task.tools_blocked == []
        assert task.mcps_enabled == ["*"]
        assert task.prompt is None

    def test_task_with_deps(self) -> None:
        """Task with explicit dependencies stores them correctly."""
        task = Task(id="b", name="Task B", dependencies=["a", "x"])

        assert task.dependencies == ["a", "x"]

    def test_task_with_enforcement(self) -> None:
        """Task with tools_blocked and mcps_enabled stores them correctly."""
        task = Task(
            id="c",
            name="Task C",
            tools_blocked=["Write", "Edit"],
            mcps_enabled=["context7"],
        )

        assert task.tools_blocked == ["Write", "Edit"]
        assert task.mcps_enabled == ["context7"]


# ---------------------------------------------------------------------------
# TestComputeReadyTasks
# ---------------------------------------------------------------------------


class TestComputeReadyTasks:
    def test_ready_no_deps(self) -> None:
        """Three independent tasks with no dependencies are all ready."""
        tasks = [
            Task(id="a", name="A"),
            Task(id="b", name="B"),
            Task(id="c", name="C"),
        ]
        graph, state = _make_dag_graph(tasks)

        ready = compute_ready_tasks(graph, state, "dag1")

        ready_ids = {t.id for t in ready}
        assert ready_ids == {"a", "b", "c"}

    def test_ready_linear_chain(self) -> None:
        """A→B→C with nothing complete: only A is ready."""
        tasks = [
            Task(id="a", name="A"),
            Task(id="b", name="B", dependencies=["a"]),
            Task(id="c", name="C", dependencies=["b"]),
        ]
        graph, state = _make_dag_graph(tasks)

        ready = compute_ready_tasks(graph, state, "dag1")

        assert [t.id for t in ready] == ["a"]

    def test_ready_after_completion(self) -> None:
        """A→B→C with A complete: only B is ready."""
        tasks = [
            Task(id="a", name="A"),
            Task(id="b", name="B", dependencies=["a"]),
            Task(id="c", name="C", dependencies=["b"]),
        ]
        graph, state = _make_dag_graph(tasks)
        state.mark_task_complete("dag1", "a")

        ready = compute_ready_tasks(graph, state, "dag1")

        assert [t.id for t in ready] == ["b"]

    def test_ready_diamond(self) -> None:
        """Diamond pattern: A and B both point to C.

        - Nothing complete → A and B ready.
        - A done → B still ready, C still blocked (needs both).
        - A and B both done → C ready.
        """
        tasks = [
            Task(id="a", name="A"),
            Task(id="b", name="B"),
            Task(id="c", name="C", dependencies=["a", "b"]),
        ]

        # Nothing complete
        graph, state = _make_dag_graph(tasks)
        ready_ids = {t.id for t in compute_ready_tasks(graph, state, "dag1")}
        assert ready_ids == {"a", "b"}

        # A done — C still blocked
        state.mark_task_complete("dag1", "a")
        ready_ids = {t.id for t in compute_ready_tasks(graph, state, "dag1")}
        assert ready_ids == {"b"}

        # Both done — C ready
        state.mark_task_complete("dag1", "b")
        ready_ids = {t.id for t in compute_ready_tasks(graph, state, "dag1")}
        assert ready_ids == {"c"}

    def test_ready_all_complete(self) -> None:
        """When all tasks are complete, no tasks are ready."""
        tasks = [Task(id="a", name="A"), Task(id="b", name="B")]
        graph, state = _make_dag_graph(tasks)
        state.mark_task_complete("dag1", "a")
        state.mark_task_complete("dag1", "b")

        ready = compute_ready_tasks(graph, state, "dag1")

        assert ready == []

    def test_ready_non_dag(self) -> None:
        """compute_ready_tasks returns empty list for a wave node."""
        wave_node = Node(id="w1", name="Wave 1", node_type="wave", is_start=True)
        end_node = Node(id="done", name="Done", is_end=True)
        edge = Edge(
            id="w1-done",
            from_node="w1",
            to_node="done",
            condition=EdgeCondition(type="always"),
        )
        graph = Graph(
            metadata={"name": "test"},
            nodes={"w1": wave_node, "done": end_node},
            edges=[edge],
        )
        state = GraphState(current_nodes=["w1"])

        ready = compute_ready_tasks(graph, state, "w1")

        assert ready == []

    def test_ready_empty_dag(self) -> None:
        """DAG node with no tasks returns empty ready list."""
        graph, state = _make_dag_graph([])

        ready = compute_ready_tasks(graph, state, "dag1")

        assert ready == []


# ---------------------------------------------------------------------------
# TestIsDagComplete
# ---------------------------------------------------------------------------


class TestIsDagComplete:
    def test_complete_all_done(self) -> None:
        """All tasks marked complete → is_dag_complete returns True."""
        tasks = [Task(id="a", name="A"), Task(id="b", name="B")]
        graph, state = _make_dag_graph(tasks)
        state.mark_task_complete("dag1", "a")
        state.mark_task_complete("dag1", "b")

        assert is_dag_complete(graph, state, "dag1") is True

    def test_complete_partial(self) -> None:
        """Some tasks still incomplete → is_dag_complete returns False."""
        tasks = [Task(id="a", name="A"), Task(id="b", name="B")]
        graph, state = _make_dag_graph(tasks)
        state.mark_task_complete("dag1", "a")

        assert is_dag_complete(graph, state, "dag1") is False

    def test_complete_non_dag(self) -> None:
        """Wave node is trivially complete."""
        wave_node = Node(id="w1", name="Wave 1", node_type="wave", is_start=True)
        end_node = Node(id="done", name="Done", is_end=True)
        edge = Edge(
            id="w1-done",
            from_node="w1",
            to_node="done",
            condition=EdgeCondition(type="always"),
        )
        graph = Graph(
            metadata={"name": "test"},
            nodes={"w1": wave_node, "done": end_node},
            edges=[edge],
        )
        state = GraphState(current_nodes=["w1"])

        assert is_dag_complete(graph, state, "w1") is True

    def test_complete_empty_dag(self) -> None:
        """DAG node with no tasks is trivially complete."""
        graph, state = _make_dag_graph([])

        assert is_dag_complete(graph, state, "dag1") is True


# ---------------------------------------------------------------------------
# TestTaskCompletion
# ---------------------------------------------------------------------------


class TestTaskCompletion:
    def test_mark_and_check(self) -> None:
        """mark_task_complete followed by is_task_complete returns True."""
        state = GraphState(current_nodes=["n1"])
        state.mark_task_complete("n1", "task-a")

        assert state.is_task_complete("n1", "task-a") is True

    def test_not_complete(self) -> None:
        """is_task_complete for an unknown task returns False."""
        state = GraphState(current_nodes=["n1"])

        assert state.is_task_complete("n1", "nonexistent") is False

    def test_get_completed_for_node(self) -> None:
        """Marking three tasks in the same node returns all three from get_completed_tasks_for_node."""
        state = GraphState(current_nodes=["n1"])
        state.mark_task_complete("n1", "t1")
        state.mark_task_complete("n1", "t2")
        state.mark_task_complete("n1", "t3")

        completed = state.get_completed_tasks_for_node("n1")

        assert set(completed) == {"t1", "t2", "t3"}

    def test_get_completed_different_nodes(self) -> None:
        """Tasks from two different nodes are kept separate."""
        state = GraphState(current_nodes=["n1"])
        state.mark_task_complete("n1", "ta")
        state.mark_task_complete("n2", "tb")
        state.mark_task_complete("n2", "tc")

        completed_n1 = state.get_completed_tasks_for_node("n1")
        completed_n2 = state.get_completed_tasks_for_node("n2")

        assert completed_n1 == ["ta"]
        assert set(completed_n2) == {"tb", "tc"}

    def test_outputs_stored(self) -> None:
        """mark_task_complete with outputs persists the outputs dict."""
        state = GraphState(current_nodes=["n1"])
        outputs = {"files": "3", "coverage": "85"}
        state.mark_task_complete("n1", "t1", outputs=outputs)

        entry = state.completed_tasks["n1:t1"]
        assert entry["outputs"] == outputs


# ---------------------------------------------------------------------------
# TestDAGCycleDetection
# ---------------------------------------------------------------------------


class TestDAGCycleDetection:
    def _make_graph_with_dag_tasks(self, tasks: list[Task]) -> Graph:
        """Return a Graph with a DAG node containing the given tasks."""
        dag_node = Node(
            id="dag1",
            name="DAG",
            node_type="dag",
            tasks=tasks,
            is_start=True,
        )
        end_node = Node(id="done", name="Done", is_end=True)
        edge = Edge(
            id="dag1-done",
            from_node="dag1",
            to_node="done",
            condition=EdgeCondition(type="always"),
        )
        return Graph(
            metadata={"name": "test"},
            nodes={"dag1": dag_node, "done": end_node},
            edges=[edge],
        )

    def test_no_cycle(self) -> None:
        """Linear A→B→C is acyclic — validate() returns no errors."""
        tasks = [
            Task(id="a", name="A"),
            Task(id="b", name="B", dependencies=["a"]),
            Task(id="c", name="C", dependencies=["b"]),
        ]
        graph = self._make_graph_with_dag_tasks(tasks)

        errors = graph.validate()

        cycle_errors = [e for e in errors if "cyclic" in e]
        assert cycle_errors == []

    def test_cycle_detected(self) -> None:
        """A→B, B→A creates a cycle — validate() reports a cyclic dependency error."""
        tasks = [
            Task(id="a", name="A", dependencies=["b"]),
            Task(id="b", name="B", dependencies=["a"]),
        ]
        graph = self._make_graph_with_dag_tasks(tasks)

        errors = graph.validate()

        assert any("cyclic" in e for e in errors)

    def test_self_dependency(self) -> None:
        """A task that depends on itself is a cycle — validate() reports an error."""
        tasks = [Task(id="a", name="A", dependencies=["a"])]
        graph = self._make_graph_with_dag_tasks(tasks)

        errors = graph.validate()

        assert any("cyclic" in e for e in errors)

    def test_diamond_no_cycle(self) -> None:
        """Diamond A→C, B→C is acyclic — validate() returns no cycle errors."""
        tasks = [
            Task(id="a", name="A"),
            Task(id="b", name="B"),
            Task(id="c", name="C", dependencies=["a", "b"]),
        ]
        graph = self._make_graph_with_dag_tasks(tasks)

        errors = graph.validate()

        cycle_errors = [e for e in errors if "cyclic" in e]
        assert cycle_errors == []


# ---------------------------------------------------------------------------
# TestBackwardsCompatibility
# ---------------------------------------------------------------------------


class TestBackwardsCompatibility:
    def test_wave_node_no_tasks(self) -> None:
        """Node created without node_type defaults to 'wave' and has empty tasks."""
        node = Node(id="w", name="wave")

        assert node.node_type == "wave"
        assert node.tasks == []

    def test_compute_ready_wave(self) -> None:
        """compute_ready_tasks on a wave node returns empty list."""
        wave_node = Node(id="w1", name="Wave 1", node_type="wave", is_start=True)
        end_node = Node(id="done", name="Done", is_end=True)
        edge = Edge(
            id="w1-done",
            from_node="w1",
            to_node="done",
            condition=EdgeCondition(type="always"),
        )
        graph = Graph(
            metadata={"name": "test"},
            nodes={"w1": wave_node, "done": end_node},
            edges=[edge],
        )
        state = GraphState(current_nodes=["w1"])

        assert compute_ready_tasks(graph, state, "w1") == []

    def test_is_complete_wave(self) -> None:
        """is_dag_complete on a wave node returns True (trivially complete)."""
        wave_node = Node(id="w1", name="Wave 1", node_type="wave", is_start=True)
        end_node = Node(id="done", name="Done", is_end=True)
        edge = Edge(
            id="w1-done",
            from_node="w1",
            to_node="done",
            condition=EdgeCondition(type="always"),
        )
        graph = Graph(
            metadata={"name": "test"},
            nodes={"w1": wave_node, "done": end_node},
            edges=[edge],
        )
        state = GraphState(current_nodes=["w1"])

        assert is_dag_complete(graph, state, "w1") is True
