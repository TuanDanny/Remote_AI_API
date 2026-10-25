import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionDiscoveryService } from './sessionDiscovery.js';

export class PlatformWatcher {
  private discovery: SessionDiscoveryService;
  private isSyncing = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastCodexMtime = 0;
  private claudeMtimes = new Map<string, number>();

  constructor(discovery: SessionDiscoveryService) {
    this.discovery = discovery;
  }

  start(intervalMs = 1500) {
    const home = os.homedir();
    const codexWal = path.join(home, '.codex', 'thread_history_1.sqlite-wal');
    const codexState = path.join(home, '.codex', 'state_5.sqlite');
    const claudeSessionsDir = path.join(home, 'AppData', 'Local', 'Claude-3p', 'claude-code-sessions');

    let debounceTimer: NodeJS.Timeout | null = null;

    const scheduleSync = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (this.isSyncing) return;
        this.isSyncing = true;
        try {
          await this.discovery.syncDiscoveredSessionsToSupabase();
        } catch (err: any) {
          console.error('[PlatformWatcher] Sync error:', err?.message || err);
        } finally {
          this.isSyncing = false;
        }
      }, 600);
    };

    // Polling-based watcher: Extremely stable on Windows, zero libuv crash risk
    this.pollTimer = setInterval(async () => {
      try {
        let changed = false;

        // 1. Check Claude Code desktop active sessions & their jsonl files
        if (fs.existsSync(claudeSessionsDir)) {
          const activeSessions = await this.discovery.discoverClaudeDesktopSessions();
          for (const s of activeSessions) {
            if (s.cliSessionId) {
              const jsonlPath = this.discovery.findClaudeJsonl(s.cliSessionId);
              if (jsonlPath && fs.existsSync(jsonlPath)) {
                try {
                  const mtime = fs.statSync(jsonlPath).mtimeMs;
                  const prev = this.claudeMtimes.get(jsonlPath) || 0;
                  if (prev && mtime > prev + 200) {
                    changed = true;
                  }
                  this.claudeMtimes.set(jsonlPath, mtime);
                } catch {}
              }
            }
          }
        }

        // 2. Check Codex SQLite WAL / state modification
        const codexFile = fs.existsSync(codexWal)
          ? codexWal
          : fs.existsSync(codexState)
          ? codexState
          : null;

        if (codexFile) {
          try {
            const mtime = fs.statSync(codexFile).mtimeMs;
            if (this.lastCodexMtime && mtime > this.lastCodexMtime + 200) {
              changed = true;
            }
            this.lastCodexMtime = mtime;
          } catch {}
        }

        if (changed) {
          scheduleSync();
        }
      } catch (err: any) {
        // Silently ignore stat errors during file writes
      }
    }, intervalMs);

    console.log('👀 [PlatformWatcher] Polling-based real-time watcher active (1500ms).');
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
