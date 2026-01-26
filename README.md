# AgentCockpit V2

<p align="center">
  <strong>Modern Terminal Manager with AI Pipeline Control</strong>
</p>

<p align="center">
  Built with React, TypeScript, and Tauri
</p>

---

## What's New in V2

### Pipeline Control System
- **Real-Time UI Sync**: Pipeline state updates automatically every 2 seconds
- **Visual Progress Tracking**: Step progress bar shows current position
- **Pipeline Selector**: Dropdown with scroll to switch between pipelines
- **Enable/Disable Switch**: Toggle pipeline enforcement on/off
- **MCP Integration**: Control pipelines via Claude Code or any MCP client

### Pipeline Manager MCP
- `pipeline_status` - Get current pipeline state
- `pipeline_advance` - Move to next step
- `pipeline_reset` - Reset to step 0
- `pipeline_set_step` - Jump to specific step
- `pipeline_set_enabled` - Enable/disable enforcer
- `pipeline_get_enabled` - Check enforcer state

### Global Pipeline Library
Pre-built pipelines stored in `.claude/pipelines/`:
- **testing-demo** - Pipeline testing and demonstration

Create your own custom pipelines following the YAML schema.

### Pipeline Hooks
- **Enforcer Hook**: Validates tool usage per step
- **Auto-Advance Hook**: Automatic step progression on gate triggers

---

## Features

### Core Functionality
- **Multi-Terminal Management**: Run multiple terminals per project
- **Project Workspaces**: Organize terminals by project
- **Smart Notifications**: Get notified when commands finish
- **Session Persistence**: Terminal state saves automatically

### Notification System
- **Customizable Sounds**: 6 different notification sounds
- **Visual Indicators**: See finished terminals at a glance
- **Sound Preview**: Test sounds before selecting
- **Configurable Delays**: Adjust detection sensitivity (1-10 seconds)

### Integrations
- **MCP Support**: Model Context Protocol integration
- **Pipeline Manager**: Control AI agent workflows
- **Claude Code**: Built-in Claude integration
- **Cursor Agent**: AI-powered development assistance
- **GitHub Integration**: Connect your repositories

### UI Design
- **Glass-Morphism Design**: Modern, elegant interface
- **Customizable Backgrounds**: Set your own background images
- **Opacity Controls**: Adjust transparency
- **Dark Mode**: Easy on the eyes
- **Idle Mode**: UI fades during inactivity

### Snapshots
- **Git-Based Snapshots**: Version control for your workspace
- **Easy Restore**: Roll back to any previous state
- **Automatic Tracking**: Snapshots at key points

---

## Getting Started

### Prerequisites
- **Node.js** 18+
- **pnpm**
- **Rust** (for Tauri)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/agentcockpit.git

# Navigate to directory
cd agentcockpit

# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

---

## Pipeline Control

### Activating a Pipeline
1. Open the **Pipeline Panel** in the sidebar
2. Select a pipeline from the dropdown
3. Toggle the switch to enable enforcement

### Creating Custom Pipelines
Create a YAML file in `.claude/pipelines/`:

```yaml
metadata:
  name: "My Pipeline"
  description: "Custom workflow"
  version: "1.0.0"

config:
  reset_policy: "timeout"
  timeout_minutes: 30
  force_sequential: true

steps:
  - id: "step-1"
    order: 0
    name: "First Step"
    mcps_enabled:
      - "sequential-thinking"
    tools_blocked:
      - "Write"
      - "Edit"
    gate_type: "any"
```

### Pipeline via MCP
```bash
# Check status
mcp__pipeline-manager__pipeline_status(project_dir="/path/to/project")

# Enable pipeline
mcp__pipeline-manager__pipeline_set_enabled(project_dir="/path", enabled=true)

# Advance to next step
mcp__pipeline-manager__pipeline_advance(project_dir="/path")
```

---

## Usage

### Creating a Project
1. Click **+** in the sidebar
2. Enter project name and select directory
3. First terminal creates automatically

### Managing Terminals
- **Add Terminal**: Click `+` next to project name
- **Rename**: Double-click terminal name
- **Switch**: Click on any terminal
- **Close**: Click the x button

### Keyboard Shortcuts
- `Cmd/Ctrl + K`: Focus command palette
- `Cmd/Ctrl + W`: Close active terminal
- `Cmd/Ctrl + T`: New terminal
- `Cmd/Ctrl + ,`: Open settings

---

## Tech Stack

- **Frontend**: React 19 + TypeScript
- **Desktop**: Tauri v2
- **Terminal**: xterm.js
- **Build**: Vite with Rolldown
- **Audio**: Web Audio API
- **Styling**: CSS with glass-morphism
- **Icons**: Lucide React
- **MCP**: Pipeline Manager integration

---

## Project Structure

```
agentcockpit/
├── src/
│   ├── components/
│   │   ├── pipeline/        # Pipeline UI components
│   │   ├── terminal/        # Terminal components
│   │   └── settings/        # Settings components
│   ├── services/
│   │   ├── pipelineService.ts  # Pipeline state management
│   │   └── projectSessionService.ts
│   ├── hooks/
│   └── contexts/
├── src-tauri/               # Tauri backend (Rust)
├── .claude/
│   ├── pipeline/            # Active pipeline state
│   ├── pipelines/           # Global pipeline library
│   └── hooks/               # Pipeline hooks
└── public/
    └── sounds/              # Notification sounds
```

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Known Issues

None reported for V2.0.0

---

## License

Rixmerz License (RXL) - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Tauri](https://tauri.app/) - Desktop framework
- [xterm.js](https://xtermjs.org/) - Terminal emulation
- [Lucide](https://lucide.dev/) - Icons
- [Mixkit](https://mixkit.co/) - Notification sounds

---

<p align="center">
  Made with care by the AgentCockpit team
</p>
