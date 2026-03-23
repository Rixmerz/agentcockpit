Detect this project's tech stack and deploy specialized subagents.

Steps:
1. Analyze the project to identify languages and frameworks:
   - Check file extensions in the project root and src/ directories
   - Read package.json, Cargo.toml, go.mod, pyproject.toml, etc. if they exist
   - Identify the primary languages (e.g., typescript, python, rust, go)
   - Identify frameworks (e.g., react, tauri, fastapi, gin)

2. Call the `deploy_project_agents` MCP tool:
   ```
   deploy_project_agents(
     project_path: "<current project path>",
     tech_stack: ["<detected languages and frameworks>"],
     include_core: true
   )
   ```

3. Report what was deployed:
   - List the agents created in `.claude/agents/`
   - List the skills assigned to each agent
   - Confirm the agents are ready to use

If `deploy_project_agents` is not available (workflow-manager MCP not connected), explain that the user needs to connect to AgentCockpit first.
