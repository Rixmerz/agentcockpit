# One-Term 🚀

<p align="center">
  <strong>Modern, Beautiful Terminal Manager for Developers</strong>
</p>

<p align="center">
  Built with React, TypeScript, and Tauri
</p>

---

## ✨ Features

### 🎯 Core Functionality
- **Multi-Terminal Management**: Run multiple terminals per project with easy switching
- **Project Workspaces**: Organize terminals by project for better workflow
- **Smart Notifications**: Get notified when long-running commands finish
- **Session Persistence**: Your terminal state saves automatically

### 🔔 Notification System
- **Customizable Sounds**: Choose from 6 different notification sounds
- **Visual Indicators**: See which terminals have finished at a glance
- **Sound Preview**: Test sounds before selecting
- **Configurable Delays**: Adjust detection sensitivity (1-10 seconds)

### 🔌 Integrations
- **MCP Support**: Model Context Protocol integration
- **Claude Code**: Built-in Claude integration
- **Cursor Agent**: AI-powered development assistance
- **GitHub Integration**: Connect your repositories

### 🎨 Beautiful UI
- **Glass-Morphism Design**: Modern,  elegant interface
- **Customizable Backgrounds**: Set your own background images
- **Opacity Controls**: Adjust transparency for both background and terminals
- **Dark Mode**: Easy on the eyes
- **Idle Mode**: UI fades during inactivity to reduce distraction

### 📸 Snapshots
- **Git-Based Snapshots**: Version control for your entire workspace
- **Easy Restore**: Roll back to any previous state
- **Automatic Tracking**: Snapshots created at key points

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** 18+
- **npm** or **pnpm**
- **Rust** (for Tauri)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/one-term.git

# Navigate to directory
cd one-term

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

---

## 📖 Usage

### Creating a Project
1. Click the **+** button in the sidebar
2. Enter project name and select the directory
3. Your first terminal will be created automatically

### Managing Terminals
- **Add Terminal**: Click `+` next to project name
- **Rename**: Double-click terminal name
- **Switch**: Click on any terminal to activate it
- **Close**: Click the × button

### Customizing Notifications
1. Open **Settings** (gear icon)
2. Go to **Terminal Notifications**
3. Enable/disable sounds
4. Choose your preferred notification sound
5. Adjust detection delay
6. Click 🔊 to preview sounds

### Keyboard Shortcuts
- `Cmd/Ctrl + K`: Focus command palette
- `Cmd/Ctrl + W`: Close active terminal
- `Cmd/Ctrl + T`: New terminal
- `Cmd/Ctrl + ,`: Open settings

---

## 🛠️ Tech Stack

- **Frontend**: React 19 + TypeScript
- **Desktop**: Tauri v2
- **Terminal**: xterm.js
- **Build**: Vite with Rolldown
- **Audio**: Web Audio API
- **Styling**: CSS with glass-morphism
- **Icons**: Lucide React

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📋 Project Structure

```
one-term/
├── src/                      # React application
│   ├── components/           # UI components
│   ├── services/             # Business logic
│   ├── hooks/                # Custom React hooks
│   ├── contexts/             # React contexts
│   └── agents/               # Plugin integrations
├── src-tauri/                # Tauri backend (Rust)
├── public/                   # Static assets
│   └── sounds/               # Notification sounds
├── docs/                     # Documentation
└── dist/                     # Build output
```

---

## 🐛 Known Issues

None reported for v1.0.0

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Tauri](https://tauri.app/) for the amazing desktop framework
- [xterm.js](https://xtermjs.org/) for terminal emulation
- [Lucide](https://lucide.dev/) for beautiful icons
- [Mixkit](https://mixkit.co/) for notification sounds

---

## 📧 Contact

- **Issues**: [GitHub Issues](https://github.com/yourusername/one-term/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/one-term/discussions)

---

<p align="center">
  Made with ❤️ by the One-Term team
</p>
