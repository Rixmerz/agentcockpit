# AgentCockpit - Linux Installation Guide

## Quick Install (Precompiled)

Download the latest release from [GitHub Releases](https://github.com/Rixmerz/agentcockpit/releases/latest) and choose your format:

### AppImage (Recommended - works on any distro)

```bash
# Download
wget https://github.com/Rixmerz/agentcockpit/releases/download/v1.2.0/AgentCockpit-1.2.0-x86_64.AppImage

# Make executable and run
chmod +x AgentCockpit-1.2.0-x86_64.AppImage
./AgentCockpit-1.2.0-x86_64.AppImage
```

No dependencies needed. Works on Bazzite, Fedora, Ubuntu, Arch, and any other distro.

### RPM (Fedora / RHEL / Bazzite)

```bash
# Fedora / RHEL
sudo dnf install ./AgentCockpit-1.2.0-1.x86_64.rpm

# Bazzite / Fedora Atomic
rpm-ostree install ./AgentCockpit-1.2.0-1.x86_64.rpm
systemctl reboot
```

### DEB (Ubuntu / Debian)

```bash
sudo dpkg -i AgentCockpit_1.2.0_amd64.deb
sudo apt-get install -f  # fix dependencies if needed
```

---

## Build from Source

Only needed if you want to modify the code or your architecture isn't x86_64.

### Prerequisites

**System dependencies (Fedora/RHEL):**

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel pango-devel \
  gtk3-devel glib2-devel
```

**Ubuntu/Debian:**

```bash
sudo apt install libwebkit2gtk-4.1-dev libssl-dev curl wget file \
  libayatana-appindicator3-dev librsvg2-dev libpango1.0-dev \
  libgtk-3-dev libglib2.0-dev
```

**Rust + Node.js:**

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Node.js + pnpm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install --lts
npm install -g pnpm
```

### Build

```bash
git clone https://github.com/Rixmerz/agentcockpit.git
cd agentcockpit
pnpm install
npx tauri build
```

Output binaries in `src-tauri/target/release/bundle/`:
- `appimage/` - AppImage
- `rpm/` - RPM package
- `deb/` - DEB package

### Development Mode

```bash
pnpm install
npx tauri dev
```

---

## Bazzite / Fedora Atomic Notes

Bazzite is an immutable OS. The **AppImage is the easiest option** - no system modifications needed.

If you need to build from source, use a Distrobox container:

```bash
distrobox create --name agentcockpit-dev --image fedora:latest
distrobox enter agentcockpit-dev
# Install dependencies with dnf and build inside the container
```

---

## Configuration Paths

| Config | Path |
|--------|------|
| AgentCockpit | `~/.agentcockpit/` |
| Claude Code | `~/.claude.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| DeltaCodeCube | `~/.deltacodecube/` |

## Known Limitations

- **Browser panel**: Uses WebKitGTK on Linux (vs WebKit on macOS). Some sites may behave differently.
- **Claude Desktop app**: Not available on Linux. Use Claude Code CLI instead.

## Troubleshooting

**Build fails with missing webkit2gtk**: Install `webkit2gtk4.1-devel` (not `webkit2gtk3.0-devel`). Tauri 2.x requires WebKitGTK 4.1.

**AppImage won't run**: Make sure FUSE is available. On some systems: `sudo dnf install fuse`

**Claude CLI not found**: Ensure it's in your PATH:
- `~/.local/bin/claude`
- `/usr/local/bin/claude`
- `~/.cargo/bin/claude`
