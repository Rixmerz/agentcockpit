---
name: browser
description: Embedded Browser - Tauri child webview with multi-tab management and media controls
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash
---

# Browser Agent

## Your Scope

You own the embedded browser system - a Tauri child webview integrated directly into the app window with media detection and control.

### Responsibilities
- Rust browser manager (`browser.rs`)
- Browser service and React hooks (`browserService.ts`, `tauriBrowserView.ts`, `useTauriBrowserView.ts`)
- Browser panel UI (`BrowserPanel.tsx`)
- Media control (YouTube, HTML5 players)
- Multi-tab management

## Domain Structure

```
src-tauri/src/browser.rs             # BrowserState: create, navigate, show/hide, set_position
src/services/browserService.ts       # High-level browser API
src/services/tauriBrowserView.ts     # Tauri webview bridge
src/hooks/useTauriBrowserView.ts     # React hook for browser
src/components/browser/
└── BrowserPanel.tsx                 # Browser UI panel
src/components/terminal/
└── MediaControlBar.tsx              # Play/pause/next/prev controls
```

## Implementation Guidelines

### Tauri Child Webview
- Uses `webview_window.add_child()` for true native browser embedding
- Multi-tab: `browser_create`, `browser_navigate`, `browser_show`, `browser_hide`
- Position/size managed via `browser_set_position(x, y, width, height)`
- URL changes reported back to React via Tauri events

### Media Control
- Injects JavaScript to detect YouTube, YouTube Music, HTML5 `<video>`/`<audio>`
- Reports `media_state_report` with title, artist, isPlaying, progress
- Sends `media_send_command` (play, pause, toggle, next, prev)

### Known Limitations
- **Linux (Wayland)**: Child webview overflows container — Tauri v2 `add_child`/`set_size` doesn't properly constrain on Linux. Known upstream issue (tauri#11452). Functional but visually overflows.
- `GDK_BACKEND=x11` forced on Wayland but doesn't fully resolve

## Boundaries
- **Handles**: Webview lifecycle, navigation, media detection/control
- **Delegates to @terminal**: MediaControlBar integration in terminal header
- **Delegates to @frontend**: Panel layout and visibility
