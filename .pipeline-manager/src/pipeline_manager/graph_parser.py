"""Graph Parser - YAML parser for graph.yaml files.

Parses the graph YAML format into Graph, Node, and Edge objects.
Uses a simple hand-rolled parser to avoid PyYAML dependency issues.
"""

from pathlib import Path
from typing import Optional, Any

from .graph_engine import Graph, Node, Edge, EdgeCondition


class GraphParseError(Exception):
    """Raised when graph YAML parsing fails."""
    pass


def parse_yaml_simple(content: str) -> dict:
    """Simple YAML parser for graph files.

    Handles the specific structure of graph.yaml without external dependencies.
    Supports: nested dicts, lists, strings, ints, bools, multiline strings.
    """
    lines = content.split('\n')

    def get_indent(line: str) -> int:
        """Get indentation level of a line."""
        return len(line) - len(line.lstrip())

    def parse_value(val: str) -> Any:
        """Parse a YAML value string."""
        val = val.strip()
        if not val:
            return None

        # Remove quotes
        if (val.startswith('"') and val.endswith('"')) or \
           (val.startswith("'") and val.endswith("'")):
            return val[1:-1]

        # Handle booleans
        if val.lower() == 'true':
            return True
        elif val.lower() == 'false':
            return False

        # Handle integers
        if val.lstrip('-').isdigit():
            return int(val)

        return val

    def parse_block(start_idx: int, base_indent: int) -> tuple[Any, int]:
        """Parse a block of YAML starting at start_idx.

        Returns (parsed_value, next_line_index)
        """
        if start_idx >= len(lines):
            return None, start_idx

        line = lines[start_idx]
        stripped = line.strip()

        # Skip empty and comment lines
        while start_idx < len(lines) and (not stripped or stripped.startswith('#')):
            start_idx += 1
            if start_idx < len(lines):
                line = lines[start_idx]
                stripped = line.strip()

        if start_idx >= len(lines):
            return None, start_idx

        indent = get_indent(line)

        # Check if this is a list item
        if stripped.startswith('- '):
            # Parse list
            result = []
            while start_idx < len(lines):
                line = lines[start_idx]
                stripped = line.strip()

                if not stripped or stripped.startswith('#'):
                    start_idx += 1
                    continue

                curr_indent = get_indent(line)
                if curr_indent < indent:
                    break
                if curr_indent > indent and result:
                    # Nested content for last item
                    start_idx += 1
                    continue

                if not stripped.startswith('- '):
                    break

                # Parse list item
                item_content = stripped[2:].strip()

                if ':' in item_content:
                    # Dict item like "- id: foo"
                    key, _, val = item_content.partition(':')
                    key = key.strip()
                    val = val.strip()

                    item_dict = {}

                    if val == '|':
                        # Multiline string
                        start_idx += 1
                        ml_lines = []
                        ml_base_indent = indent + 4  # 2 for "- " + 2 for content
                        while start_idx < len(lines):
                            ml_line = lines[start_idx]
                            ml_stripped = ml_line.strip()
                            ml_indent = get_indent(ml_line) if ml_stripped else ml_base_indent

                            if ml_stripped == '' or ml_indent >= ml_base_indent:
                                if len(ml_line) > ml_base_indent:
                                    ml_lines.append(ml_line[ml_base_indent:])
                                else:
                                    ml_lines.append('')
                                start_idx += 1
                            else:
                                break
                        item_dict[key] = '\n'.join(ml_lines).rstrip()
                    elif val:
                        item_dict[key] = parse_value(val)

                    # Parse remaining keys in this dict
                    start_idx += 1
                    while start_idx < len(lines):
                        inner_line = lines[start_idx]
                        inner_stripped = inner_line.strip()

                        if not inner_stripped or inner_stripped.startswith('#'):
                            start_idx += 1
                            continue

                        inner_indent = get_indent(inner_line)

                        # If we hit another list item at same level or lower indent, stop
                        if inner_indent <= indent:
                            break

                        if inner_stripped.startswith('- '):
                            # Nested list - find the key
                            break

                        # Parse key: value
                        if ':' in inner_stripped:
                            ikey, _, ival = inner_stripped.partition(':')
                            ikey = ikey.strip()
                            ival = ival.strip()

                            if ival == '|':
                                # Multiline
                                start_idx += 1
                                ml_lines = []
                                ml_base_indent = inner_indent + 2
                                while start_idx < len(lines):
                                    ml_line = lines[start_idx]
                                    ml_indent = get_indent(ml_line) if ml_line.strip() else ml_base_indent

                                    if ml_line.strip() == '' or ml_indent >= ml_base_indent:
                                        if len(ml_line) > ml_base_indent:
                                            ml_lines.append(ml_line[ml_base_indent:])
                                        else:
                                            ml_lines.append('')
                                        start_idx += 1
                                    else:
                                        break
                                item_dict[ikey] = '\n'.join(ml_lines).rstrip()
                            elif not ival:
                                # Could be nested structure
                                start_idx += 1
                                # Look ahead
                                if start_idx < len(lines):
                                    next_line = lines[start_idx]
                                    next_stripped = next_line.strip()
                                    if next_stripped.startswith('- '):
                                        # It's a list
                                        nested_list, start_idx = parse_block(start_idx, inner_indent + 2)
                                        item_dict[ikey] = nested_list
                                    elif next_stripped and ':' in next_stripped:
                                        # It's a dict
                                        nested_dict, start_idx = parse_block(start_idx, inner_indent + 2)
                                        item_dict[ikey] = nested_dict
                            else:
                                item_dict[ikey] = parse_value(ival)
                                start_idx += 1
                        else:
                            start_idx += 1

                    result.append(item_dict)
                else:
                    # Simple list item
                    result.append(parse_value(item_content))
                    start_idx += 1

            return result, start_idx

        elif ':' in stripped:
            # Parse dict
            result = {}
            while start_idx < len(lines):
                line = lines[start_idx]
                stripped = line.strip()

                if not stripped or stripped.startswith('#'):
                    start_idx += 1
                    continue

                curr_indent = get_indent(line)
                if curr_indent < indent:
                    break

                if curr_indent > indent:
                    start_idx += 1
                    continue

                if ':' not in stripped:
                    start_idx += 1
                    continue

                key, _, val = stripped.partition(':')
                key = key.strip()
                val = val.strip()

                if val == '|':
                    # Multiline string
                    start_idx += 1
                    ml_lines = []
                    ml_base_indent = indent + 2
                    while start_idx < len(lines):
                        ml_line = lines[start_idx]
                        ml_indent = get_indent(ml_line) if ml_line.strip() else ml_base_indent

                        if ml_line.strip() == '' or ml_indent >= ml_base_indent:
                            if len(ml_line) > ml_base_indent:
                                ml_lines.append(ml_line[ml_base_indent:])
                            else:
                                ml_lines.append('')
                            start_idx += 1
                        else:
                            break
                    result[key] = '\n'.join(ml_lines).rstrip()
                elif val:
                    result[key] = parse_value(val)
                    start_idx += 1
                else:
                    # Empty value - nested structure
                    start_idx += 1
                    if start_idx < len(lines):
                        nested_val, start_idx = parse_block(start_idx, indent + 2)
                        result[key] = nested_val

            return result, start_idx

        return None, start_idx + 1

    result, _ = parse_block(0, -2)
    return result if isinstance(result, dict) else {}


def parse_graph_yaml(content: str) -> Graph:
    """Parse graph YAML content into a Graph object.

    Args:
        content: YAML content as string

    Returns:
        Parsed Graph object

    Raises:
        GraphParseError: If parsing fails or validation errors occur
    """
    try:
        data = parse_yaml_simple(content)
    except Exception as e:
        raise GraphParseError(f"Failed to parse YAML: {e}")

    # Extract metadata
    metadata = data.get('metadata', {})
    if not isinstance(metadata, dict):
        metadata = {}

    # Create graph
    graph = Graph(metadata=metadata)

    # Parse nodes
    nodes_data = data.get('nodes', [])
    if not isinstance(nodes_data, list):
        raise GraphParseError("'nodes' must be a list")

    for node_data in nodes_data:
        if not isinstance(node_data, dict):
            continue

        node_id = node_data.get('id')
        if not node_id:
            raise GraphParseError("Node missing required 'id' field")

        # Get mcps_enabled, handling both list and single value
        mcps_enabled = node_data.get('mcps_enabled', ['*'])
        if isinstance(mcps_enabled, str):
            mcps_enabled = [mcps_enabled]
        elif not isinstance(mcps_enabled, list):
            mcps_enabled = ['*']

        # Get tools_blocked
        tools_blocked = node_data.get('tools_blocked', [])
        if isinstance(tools_blocked, str):
            tools_blocked = [tools_blocked]
        elif not isinstance(tools_blocked, list):
            tools_blocked = []

        node = Node(
            id=node_id,
            name=node_data.get('name', node_id),
            mcps_enabled=mcps_enabled,
            tools_blocked=tools_blocked,
            prompt_injection=node_data.get('prompt_injection'),
            is_start=bool(node_data.get('is_start', False)),
            is_end=bool(node_data.get('is_end', False)),
            max_visits=int(node_data.get('max_visits', 10))
        )

        graph.add_node(node)

    # Parse edges
    edges_data = data.get('edges', [])
    if not isinstance(edges_data, list):
        raise GraphParseError("'edges' must be a list")

    for edge_data in edges_data:
        if not isinstance(edge_data, dict):
            continue

        edge_id = edge_data.get('id')
        from_node = edge_data.get('from')
        to_node = edge_data.get('to')

        if not edge_id:
            raise GraphParseError("Edge missing required 'id' field")
        if not from_node:
            raise GraphParseError(f"Edge '{edge_id}' missing required 'from' field")
        if not to_node:
            raise GraphParseError(f"Edge '{edge_id}' missing required 'to' field")

        # Parse condition
        condition_data = edge_data.get('condition', {})
        if not isinstance(condition_data, dict):
            condition_data = {'type': 'always'}

        condition_type = condition_data.get('type', 'always')
        condition_tool = condition_data.get('tool')

        # Get phrases, handling both list and single value
        condition_phrases = condition_data.get('phrases', [])
        if isinstance(condition_phrases, str):
            condition_phrases = [condition_phrases]
        elif not isinstance(condition_phrases, list):
            condition_phrases = []

        condition = EdgeCondition(
            type=condition_type,
            tool=condition_tool,
            phrases=condition_phrases
        )

        edge = Edge(
            id=edge_id,
            from_node=from_node,
            to_node=to_node,
            condition=condition,
            priority=int(edge_data.get('priority', 1))
        )

        graph.add_edge(edge)

    # Validate graph
    errors = graph.validate()
    if errors:
        raise GraphParseError(f"Graph validation failed:\n" + "\n".join(f"  - {e}" for e in errors))

    return graph


def load_graph_from_file(file_path: Path) -> Graph:
    """Load and parse a graph from a YAML file.

    Args:
        file_path: Path to the graph.yaml file

    Returns:
        Parsed Graph object

    Raises:
        GraphParseError: If file doesn't exist or parsing fails
    """
    if not file_path.exists():
        raise GraphParseError(f"Graph file not found: {file_path}")

    try:
        content = file_path.read_text()
    except Exception as e:
        raise GraphParseError(f"Failed to read file {file_path}: {e}")

    return parse_graph_yaml(content)
