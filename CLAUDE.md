# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SpectrAI is a multi-AI CLI session orchestration platform built with Electron 28, React 18, and TypeScript. It manages multiple AI provider sessions (Claude Code, Codex CLI, Gemini CLI, iFlow, OpenCode) through a unified adapter architecture, providing structured conversation views, file change tracking, Agent orchestration via MCP, and Agent Teams for multi-role AI collaboration.

## Development Commands

```bash
# Install dependencies
npm install

# Rebuild native modules (required after install or when switching Node versions)
npm run rebuild

# Development mode with hot reload
npm run dev

# Type checking
npm run typecheck          # Check both node and web
npm run typecheck:node     # Main process only
npm run typecheck:web      # Renderer process only

# Linting
npm run lint

# Build for production
npm run build              # Build only
npm run build:win          # Build + create Windows dev package
npm run build:mac          # Build + create macOS dev package (requires npm run rebuild first)

# Distribution packages
npm run dist               # Windows NSIS installer
npm run dist:mac           # macOS current-arch DMG + ZIP
npm run dist:mac:x64       # macOS x64 DMG + ZIP
npm run dist:mac:safe      # macOS current-arch generic update publish
```

**Important**: Always run `npm run rebuild` after `npm install` to recompile native modules (better-sqlite3, node-pty) for Electron's Node version.

## Auto Update Notes

- The app uses `electron-updater` generic feeds.
- Windows expects `.../releases/stable/win/x64/latest.yml`.
- macOS expects `.../releases/stable/mac/<arch>/latest-mac.yml`.
- If `latest-mac.yml` is missing, packaged builds will show an update-feed error and skip repeated background checks.
- When publishing macOS builds, upload `latest-mac.yml` together with the ZIP/DMG artifacts to the matching arch directory.

## Architecture

### Three-Process Model

1. **Main Process** (`src/main/`) - Electron backend, manages sessions, database, IPC
2. **Renderer Process** (`src/renderer/`) - React UI, Zustand state management
3. **MCP Server Process** (`src/main/agent/AgentMCPServer.ts`) - Standalone Agent orchestration server

### Provider Adapter Layer (SDK V2 Architecture)

The core abstraction that unifies different AI CLI providers:

```
User Input / Agent Command
  → SessionManagerV2 (thin coordinator, event-driven)
  → AdapterRegistry.getAdapter(adapterType)
  → Specific Adapter (ClaudeSdk / Codex / Gemini / IFlow / OpenCode)
      ├── Claude: Agent SDK V2, structured event stream
      ├── Codex:  JSON-RPC (codex serve), tool call mapping
      ├── Gemini: NDJSON streaming, thinking extraction
      ├── iFlow:  ACP protocol, standardized messages
      └── OpenCode: CLI adapter, auto-accept
  → toolMapping (unified event format)
  → ConversationMessage persistence + IPC broadcast
  → Zustand Store → React conversation view
```

**Key Files**:
- `src/main/adapter/types.ts` - `BaseProviderAdapter` interface, `ProviderEvent` types
- `src/main/adapter/AdapterRegistry.ts` - Factory pattern for adapter instantiation
- `src/main/adapter/toolMapping.ts` - Maps provider-specific events to unified format
- `src/main/session/SessionManagerV2.ts` - Event-driven session coordinator (replaces PTY-based SessionManager)

**Adapter Implementations**:
- `ClaudeSdkAdapter.ts` - Uses `@anthropic-ai/claude-agent-sdk` V2, supports session resume
- `CodexAppServerAdapter.ts` - JSON-RPC via `codex serve`
- `GeminiHeadlessAdapter.ts` - NDJSON streaming parser
- `IFlowAcpAdapter.ts` - ACP protocol adapter
- `OpenCodeSdkAdapter.ts` - Uses `@opencode-ai/sdk`

### Agent Orchestration (MCP-based)

Agents are sub-sessions spawned by a parent session via MCP tools:

- **AgentManagerV2** (`src/main/agent/AgentManagerV2.ts`) - Deterministic readiness detection via `turn_complete` events (no timeout heuristics)
- **AgentMCPServer** (`src/main/agent/AgentMCPServer.ts`) - Standalone MCP server process exposing tools: `spawn_agent`, `send_to_agent`, `wait_agent`, `get_agent_output`, `cancel_agent`
- **AgentBridge** (`src/main/agent/AgentBridge.ts`) - WebSocket bridge between parent session and MCP server
- **Supervisor Mode** - Injects system prompt to guide Claude to use Agent tools for task decomposition

### Agent Teams (Multi-Role Collaboration)

Decentralized multi-AI parallel collaboration (distinct from Supervisor's centralized orchestration):

- **TeamManager** (`src/main/team/TeamManager.ts`) - Lifecycle coordinator for team instances
- **SharedTaskList** (`src/main/team/SharedTaskList.ts`) - SQLite-backed task queue with atomic claim (`WHERE status='pending'`)
- **TeamBus** (`src/main/team/TeamBus.ts`) - P2P message routing (unicast + broadcast)
- **MCP Tools**: `team_claim_task`, `team_complete_task`, `team_message_role`, `team_broadcast`, `team_get_tasks`
- **Database Tables**: `teams`, `roles`, `instances`, `members`, `tasks`, `messages`

Each role can use a different AI provider (Claude for architecture, Gemini for large files, Codex for coding).

### File Change Tracking

- **FileChangeTracker** (`src/main/tracker/FileChangeTracker.ts`) - FS Watch with 300ms debounce, multi-session attribution by directory depth + recent activity, Worktree merge attribution via `git diff`
- **IPC Handlers**: `fileManagerHandlers.ts` - File tree, directory watch, session changes query
- **UI Components**: `src/renderer/components/file-manager/` - FileTree with blue dot indicators, SessionChangedFiles list, CodeViewer

### Data Persistence (Repository Pattern)

- **DatabaseManager** (`src/main/storage/Database.ts`) - SQLite connection pool with WAL mode, auto-fallback to in-memory if better-sqlite3 unavailable
- **Repositories** (`src/main/storage/repositories/`) - Domain-specific data access layers:
  - `SessionRepository` - Session metadata, status, timestamps
  - `ConversationRepository` - Structured AI messages (ConversationMessage)
  - `TaskRepository` - Kanban tasks
  - `UsageRepository` - Token usage statistics
  - `ProviderRepository` - AI provider configurations
  - `TeamRepository` - Agent Teams data (6 tables)
  - `AgentRepository`, `WorkspaceRepository`, `McpRepository`, `SkillRepository`, etc.

### IPC Communication (Modular Handlers)

All IPC handlers in `src/main/ipc/`:
- `sessionHandlers.ts` - Session CRUD, send message, respond permission
- `agentHandlers.ts` - Agent spawn, send, wait, cancel
- `taskHandlers.ts` - Task CRUD, status updates
- `providerHandlers.ts` - Provider management, CLI detection
- `gitHandlers.ts` - Git operations, worktree management
- `fileManagerHandlers.ts` - File tree, watch, session changes
- `teamHandlers.ts` - 14 `team:*` channels for Agent Teams
- `mcpHandlers.ts`, `skillHandlers.ts`, `systemHandlers.ts`, etc.

### State Management (Zustand)

Renderer stores in `src/renderer/stores/`:
- `sessionStore.ts` - Sessions + conversation messages
- `settingsStore.ts` - Global settings
- `taskStore.ts` - Kanban tasks
- `teamStore.ts` - Team definitions, instances, tasks, messages
- `workflowStore.ts`, `plannerStore.ts`, `telegramStore.ts`

## Key Patterns

### Adding a New AI Provider

1. Implement `BaseProviderAdapter` in `src/main/adapter/YourAdapter.ts`
2. Register in `AdapterRegistry.ts`
3. Add event mapping rules in `toolMapping.ts` if needed
4. Define provider preset in `src/shared/types.ts` (like `BUILTIN_CLAUDE_PROVIDER`)
5. Add icon handling in UI components

### Creating Structured Conversation Messages

Use `ConversationMessage` type from `src/shared/types.ts`:
- `role`: 'user' | 'assistant' | 'system'
- `content`: Text content
- `toolUses`: Array of tool calls with name, input, result
- `thinking`: Reasoning/planning content (Gemini, Claude extended thinking)
- `timestamp`, `tokens`

Store via `ConversationRepository.addMessage()`, broadcast via IPC `conversation:message-added`.

### File Change Attribution

When multiple sessions run concurrently:
1. FileChangeTracker receives FS event
2. Finds candidate sessions by directory overlap
3. Ranks by directory depth (deeper = more specific) + recent activity
4. Stores in `file_changes` table with `session_id`
5. UI queries via `file-manager:get-session-changes`

For Worktree sessions after merge:
- Runs `git diff <base-branch>...<worktree-branch>` to capture all changes
- Attributes to Worktree session even if files modified after merge

## Important Constraints

### Native Modules

- **better-sqlite3** and **node-pty** require native compilation
- Always run `npm run rebuild` after dependency changes
- On Windows, requires Visual Studio Build Tools
- On macOS, run `npm run rebuild` before `build:mac` or `dist:mac`

### Electron Build Configuration

- `electron.vite.config.ts` externalizes only native modules and builtins
- Pure JS dependencies are bundled by Vite to avoid hoisting issues
- `asarUnpack` includes `node-pty`, `better-sqlite3`, and `out/main/agent/**` (MCP server must be unpackaged)

### MCP Server Process

- `AgentMCPServer.ts` is a separate entry point built by electron-vite
- Spawned as child process, communicates via stdio (MCP protocol)
- Must be in `asarUnpack` to allow dynamic require/import

### Windows PATH Issues

- Electron apps don't inherit interactive shell PATH on Windows
- `bootstrapShellPath()` in `src/main/bootstrap/shellPath.ts` loads PATH from PowerShell profile
- Provider `command` can be absolute path to bypass PATH issues

### macOS Finder Launch

- Double-clicking `.app` doesn't load shell init scripts (`.bashrc`, `.zshrc`)
- `bootstrapShellPath()` sources shell profile to populate PATH
- If AI CLI still not found, set absolute path in Provider settings

## Testing Considerations

- No formal test suite currently exists
- Manual testing via `npm run dev`
- Test native module rebuild: `npm run rebuild && npm run dev`
- Test distribution build: `npm run dist` (Windows) or `npm run dist:mac` (macOS)

## Common Pitfalls

1. **Forgetting `npm run rebuild`** after `npm install` - causes native module errors
2. **Modifying `SessionManager.ts` instead of `SessionManagerV2.ts`** - old PTY-based manager is legacy, use V2
3. **Adding logic to adapters that belongs in SessionManagerV2** - adapters should be thin event translators
4. **Not handling `turn_complete` events** - AgentManagerV2 relies on this for readiness detection
5. **Hardcoding provider-specific logic outside adapters** - use `toolMapping.ts` for event normalization
6. **Forgetting to add new IPC handlers to `src/main/ipc/index.ts`** - handlers must be registered in `registerIpcHandlers()`

## Code Style

- Use TypeScript strict mode
- Prefer `interface` over `type` for object shapes
- Use `EventEmitter` for internal event buses
- Repository methods return domain objects, not raw SQL rows
- IPC handlers validate input and return `{ success: boolean, data?, error? }`
- Zustand stores use immer for immutable updates
- React components use functional style with hooks

## Git Workflow

- Main branch: `main`
- Commit messages in Chinese (project convention)
- Use descriptive commit messages explaining the "why"
- Worktree support: `GitWorktreeService` manages isolated branches per task
