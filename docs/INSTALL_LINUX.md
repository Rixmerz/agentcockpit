# AgentCockpit - Linux Installation Guide

Build and run AgentCockpit on Linux (tested on Bazzite/Fedora).

## Prerequisites

### 1. System Dependencies (Fedora/RHEL)

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel pango-devel \
  gtk3-devel glib2-devel
```

### 2. Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

### 3. Node.js + pnpm

Via nvm (recommended):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install --lts
npm install -g pnpm
```

Or via dnf:

```bash
sudo dnf install nodejs
npm install -g pnpm
```

## Build

```bash
git clone https://github.com/Rixmerz/agentcockpit.git
cd agentcockpit
pnpm install
npx tauri build
```

Output binaries will be in `src-tauri/target/release/bundle/`:
- `appimage/` - Portable AppImage
- `rpm/` - Fedora/RHEL package

## Install

**AppImage** (portable, no install needed):

```bash
chmod +x src-tauri/target/release/bundle/appimage/AgentCockpit_*.AppImage
./AgentCockpit_*.AppImage
```

**RPM** (system install):

```bash
sudo dnf install src-tauri/target/release/bundle/rpm/AgentCockpit-*.rpm
```

## Development Mode

```bash
pnpm install
npx tauri dev
```

## Bazzite / Fedora Atomic Notes

Bazzite is an immutable OS based on Fedora Atomic. System packages can't be installed with `dnf` directly.

**Option A: Use a Distrobox container (recommended for building)**

```bash
distrobox create --name agentcockpit-dev --image fedora:latest
distrobox enter agentcockpit-dev
# Then install dependencies with dnf and build inside the container
```

**Option B: Layer packages with rpm-ostree**

```bash
rpm-ostree install webkit2gtk4.1-devel openssl-devel \
  libappindicator-gtk3-devel librsvg2-devel pango-devel \
  gtk3-devel glib2-devel
systemctl reboot  # Required after rpm-ostree install
```

After building, the AppImage runs on the host without layered packages.

## Configuration Paths on Linux

| Config | Path |
|--------|------|
| Claude Code | `~/.claude.json` |
| Claude Desktop | `~/.config/Claude/claude_desktop_config.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| AgentCockpit | `~/.agentcockpit/` |
| DeltaCodeCube | `~/.deltacodecube/` |

## Known Limitations

- **Browser panel**: Uses WebKitGTK on Linux (vs WebKit on macOS). Some sites may behave differently. This feature is deferred for Linux.
- **Claude Desktop app**: Not available on Linux. The Claude Desktop config path (`~/.config/Claude/`) only applies if you manually create it. Claude Code CLI (`~/.claude.json`) works normally.

## Troubleshooting

**Build fails with missing webkit2gtk**: Make sure you installed `webkit2gtk4.1-devel` (not `webkit2gtk3.0-devel`). Tauri 2.x requires WebKitGTK 4.1.

**`xdg-open` not working**: Install `xdg-utils` if not already present:

```bash
sudo dnf install xdg-utils
```

**Claude CLI not found**: Ensure it's in your PATH. Common locations:
- `~/.local/bin/claude`
- `/usr/local/bin/claude`
- `~/.cargo/bin/claude`
