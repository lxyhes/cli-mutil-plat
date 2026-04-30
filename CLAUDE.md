# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SpectrAI (PrismOps) is an Electron desktop app for multi-AI CLI session orchestration and management. It integrates multiple AI providers (Claude, Codex, Gemini, OpenCode, Qwen, IFlow) through a unified adapter layer and provides session management, team collaboration, task tracking, and workflow automation.

## Development Commands

```bash
# Development (auto-rebuilds native modules, then launches electron-vite dev)
npm run dev

# Build (compiles main, preload, and renderer)
npm run build

# Type checking (both main process and renderer)
npm run typecheck

# Lint
npm run lint

# Tests
npm run test              # single run
npm run test:watch        # watch mode
npm run test:coverage     # with v8 coverage

# Run a single test file
npx vitest run src/main/adapter/AdapterRegistry.test.ts

# Rebuild native modules (node-pty, better-sqlite3) for Electron
npm run rebuild

# Distribution builds
npm run build:win         # Windows NSIS installer
npm run build:mac         # macOS DMG
npm run dist              # Windows distribution script
npm run dist:mac          # macOS distribution script
```

## Architecture

### Three-Process Electron Architecture

The app follows Electron's standard three-process model:

- **Main process** (`src/main/`) — Node.js backend. Contains all business logic, IPC handlers, database access, AI provider adapters, and background services.
- **Preload** (`src/preload/index.ts`) — Bridge between main and renderer via `contextBridge`. Defines the entire `window.electronAPI` surface (~1189 lines). Any new IPC channel must be registered here.
- **Renderer** (`src/renderer/`) — React 18 frontend with Zustand stores, Tailwind CSS, and xterm.js terminals.
- **Shared** (`src/shared/`) — Types (`types.ts`, ~1295 lines) and constants (`constants.ts`, ~906 lines including IPC channel names) consumed by both main and renderer.

### Path Aliases

- `@renderer/*` → `src/renderer/*` (renderer process only)
- `@shared/*` → `src/shared/*` (both processes)

### Provider Adapter System

All AI providers implement `BaseProviderAdapter` and are registered in `AdapterRegistry` (`src/main/adapter/`). Each adapter handles its own protocol (Agent SDK V2, JSON-RPC, NDJSON, ACP, etc.). The registry uses a factory pattern to instantiate adapters by `AdapterType`.

Current adapters: ClaudeSdk, CodexAppServer, GeminiHeadless, IFlowAcp, OpenCodeSdk, QwenSdk.

### Session Management (V2)

`SessionManagerV2` and `AgentManagerV2` are the current-generation session/agent managers. The older `SessionManager` (PTY-based) and `AgentManager` exist for backward compatibility. New features should target V2.

### IPC Communication

IPC handlers live in `src/main/ipc/` as 36 domain-specific files (session, agent, task, provider, git, team, etc.). They receive dependencies via the `IpcDependencies` interface and are registered centrally in `ipc/index.ts`. IPC channel names are string constants in `src/shared/constants.ts`.

### Database Layer

SQLite via `better-sqlite3`. Database singleton in `src/main/storage/Database.ts` with 21 repository classes following the Repository pattern (Session, Conversation, Task, Usage, Provider, Team, Goal, Scheduler, Skill, etc.).

### Renderer State Management

34 Zustand stores in `src/renderer/stores/` manage all UI state. Stores follow a domain-per-file convention (sessionStore, settingsStore, taskStore, teamStore, workflowStore, gitStore, fileManagerStore, etc.).

### Native Modules

`better-sqlite3` and `node-pty` require rebuilding for Electron's Node version. `scripts/dev.mjs` auto-detects and rebuilds when needed (uses a stamp file for cache). If you see native module errors, run `npm run rebuild`.

## TypeScript Configuration

Three tsconfig files with project references:
- `tsconfig.json` — root, delegates to node and web configs
- `tsconfig.node.json` — main + preload + shared (ES2022 target, strict)
- `tsconfig.web.json` — renderer + shared (ES2020, JSX react-jsx)

When adding new imports between processes, ensure the target file is included in the correct tsconfig.

## Testing

Vitest with `src/**/*.test.ts` pattern. Coverage focuses on `src/main/adapter/`, `src/main/team/`, `src/main/storage/`. Tests run in Node environment with globals enabled.

## Conventions

- Commit messages use Conventional Commits format with Chinese descriptions: `feat(scope): 中文描述`
- UI themes use CSS variables in `src/renderer/styles/globals.css` (dark, light, solarized-dark)
- Icons via `lucide-react`
- Markdown rendering via `react-markdown` + `remark-gfm` + `rehype-highlight`
