# AgentCockpit V2

<p align="center">
  <strong>Modern Terminal Manager with AI Workflow Control</strong>
</p>

<p align="center">
  Built with React, TypeScript, and Tauri
</p>

---

## What's New in V2

### Workflow Control System
- **Real-Time UI Sync**: Workflow state updates automatically every 2 seconds
- **Visual Progress Tracking**: Step progress bar shows current position
- **Workflow Selector**: Dropdown with scroll to switch between workflows
- **Enable/Disable Switch**: Toggle workflow enforcement on/off
- **MCP Integration**: Control workflows via Claude Code or any MCP client

### Workflow Manager MCP
- `workflow_status` - Get current workflow state
- `workflow_advance` - Move to next step
- `workflow_reset` - Reset to step 0
- `workflow_set_step` - Jump to specific step
- `workflow_set_enabled` - Enable/disable enforcer
- `workflow_get_enabled` - Check enforcer state

### Global Workflow Library
Pre-built workflows stored in `.claude/workflows/`:
- **testing-demo** - Workflow testing and demonstration

Create your own custom workflows following the YAML schema.

### Workflow Hooks
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
- **Workflow Manager**: Control AI agent workflows
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

### Download (Recommended)

Grab the latest precompiled release from [GitHub Releases](https://github.com/Rixmerz/agentcockpit/releases/latest):

| Format | Platform | Install |
|--------|----------|---------|
| **AppImage** | Any Linux distro | `chmod +x AgentCockpit-*.AppImage && ./AgentCockpit-*.AppImage` |
| **RPM** | Fedora / RHEL / Bazzite | `sudo dnf install ./AgentCockpit-*.rpm` |
| **DEB** | Ubuntu / Debian | `sudo dpkg -i AgentCockpit_*.deb` |

See [Linux Installation Guide](docs/INSTALL_LINUX.md) for detailed instructions.

### Build from Source

```bash
git clone https://github.com/Rixmerz/agentcockpit.git
cd agentcockpit
pnpm install
pnpm tauri build
```

Requires Node.js 18+, pnpm, and Rust. See [docs/INSTALL_LINUX.md](docs/INSTALL_LINUX.md) for prerequisites.

---

## Workflow Control

### Activating a Workflow
1. Open the **Workflow Panel** in the sidebar
2. Select a workflow from the dropdown
3. Toggle the switch to enable enforcement

### Creating Custom Workflows
Create a YAML file in `.claude/workflows/`:

```yaml
metadata:
  name: "My Workflow"
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

### Workflow via MCP
```bash
# Check status
mcp__workflow-manager__workflow_status(project_dir="/path/to/project")

# Enable workflow
mcp__workflow-manager__workflow_set_enabled(project_dir="/path", enabled=true)

# Advance to next step
mcp__workflow-manager__workflow_advance(project_dir="/path")
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
- **MCP**: Workflow Manager integration

---

## Project Structure

```
agentcockpit/
├── src/
│   ├── components/
│   │   ├── workflow/        # Workflow UI components
│   │   ├── terminal/        # Terminal components
│   │   └── settings/        # Settings components
│   ├── services/
│   │   ├── workflowService.ts  # Workflow state management
│   │   └── projectSessionService.ts
│   ├── hooks/
│   └── contexts/
├── src-tauri/               # Tauri backend (Rust)
├── .claude/
│   ├── workflow/            # Active workflow state
│   ├── workflows/           # Global workflow library
│   └── hooks/               # Workflow hooks
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
