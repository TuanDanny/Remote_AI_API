# SDD ledger — plan: docs/superpowers/plans/2026-10-24-remote-ai.md

## Pre-flight Conflict Scan
| Task Pair | Produces / Consumes | Conflict Status |
| --- | --- | --- |
| Task 1 -> Task 2 | `types/index.ts` -> `daemon/src/tools.ts` | Clean (Types match) |
| Task 2 -> Task 3 | `LocalTools` -> `AgentRunner` | Clean (Method signatures match) |
| Task 3 -> Task 4 | `AgentRunner` -> `index.ts` Coordinator | Clean (Signatures match) |
| Task 1 -> Task 5 | `types/index.ts` -> `apps/web/lib/supabase.ts` | Clean |
| Task 5 -> Task 6 | Web foundation -> `Sidebar.tsx`, `PasscodeGate.tsx` | Clean |
| Task 6 -> Task 7 | Components -> `ChatFeed.tsx`, `page.tsx` | Clean |
| Task 7 -> Task 8 | Full app -> `start.bat`, `README.md` | Clean |

Pre-flight scan verdict: Clean. No conflicts between tasks or with global constraints.
