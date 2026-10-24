# RemoteAI Development & Operational Protocol

## 1. Core Working Principles (Quy tắc làm việc cơ bản)
1. **Always Verify with Python Test Suite Before Deploying:**
   - Whenever any component (Web, Daemon, Database, or Router integration) is created or modified, execute `python tests/test_remote_ai_e2e.py`.
   - Ensure all checks pass (100% pass rate) before committing or declaring work complete.
2. **Never Deploy Broken or Raw Formatting:**
   - All markdown content must render through `react-markdown` with `remark-gfm`.
   - Tool calls must be collapsed into compact summary badges (`ToolCallsCollapsible`) rather than flooding the screen as full-width raw badges.
   - Scrollbars must remain sleek, thin, and translucent (5px width, transparent track).
3. **Strict Folder-Scoped Session Isolation:**
   - Every session must have its exact working directory preserved in `system_prompt` metadata.
   - When filtering by folder (`isSessionInFolder`), only display sessions that belong directly to that folder or its subfolders. Never leak unrelated sessions into foreign folders.
4. **Router Model Constraints:**
   - Restrict selectable models to the 5 designated endpoints:
     1. `cx/gpt-6.1-sol` (GPT-6.1 Sol - Reasoning with Light, Medium, High, XHigh, Max efforts)
     2. `ag/gemini-3.8-flash-high` (Gemini 3.8 Flash High - Fast)
     3. `cx/gpt-6-astra` (GPT-6 Astra - Coding & Speed)
     4. `cx/gpt-6-luna[1m]` (GPT-6 Luna [1M] - 1M Context)
     5. `ag/claude-opus-4-6-thinking` (Claude Opus 4.6 - Thinking)
5. **No Blind Assumptions:**
   - Always verify daemon live logs in the active terminal tab after changes.
   - Run production builds (`npm run build` in `apps/web`) and daemon unit tests (`npm test` in `daemon`) to ensure zero regression.

## 2. Directory Structure & Key Files
- `apps/web/`: Next.js 15 App Router Frontend (deployed 24/7 on Vercel)
  - `components/PromptBar.tsx`: Advanced prompt bar with model selection and effort slider
  - `components/Sidebar.tsx`: Collapsible folder-scoped sidebar with session resume
  - `components/ChatFeed.tsx`: Markdown chat container with collapsed tool call accordions
  - `components/SpecularButton.tsx`, `CallChip.tsx`, `CometDial.tsx`, `ThoughtLine.tsx`
- `daemon/`: Windows Background Daemon
  - `src/index.ts`: Realtime coordinator syncing with Supabase and executing tools
  - `src/agent.ts`: Autonomous multi-turn agent loop connecting to 9Router
  - `src/sessionDiscovery.ts`: Local session discovery from Claude Code and Codex
  - `src/tools.ts`: Sandboxed local tool executors (read, write, edit, list, execute)
- `tests/`: Automated test suite
  - `tests/test_remote_ai_e2e.py`: End-to-end Python validation script

## 3. Running Validation
```bash
# Run Python E2E verification
python tests/test_remote_ai_e2e.py

# Run Daemon unit tests
npm --prefix daemon test

# Verify Web production build
npm --prefix apps/web run build
```
