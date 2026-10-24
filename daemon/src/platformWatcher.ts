import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionDiscoveryService } from './sessionDiscovery.js';

export class PlatformWatcher {
  private discovery: SessionDiscoveryService;
  private isSyncing = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastCodexMtime = 0;
  private claudeWatcher: fs.FSWatcher | null = null;

  constructor(discovery: SessionDiscoveryService) {
    this.discovery = discovery;
  }

  start(intervalMs = 3000) {
    const home = os.homedir();
    const claudeProjects = path.join(home, '.claude', 'projects');
    const codexWal = path.join(home, '.codex', 'thread_history_1.sqlite-wal');
    const codexState = path.join(home, '.codex', 'state_5.sqlite');

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
      }, 800);
    };

    // 1. Watch Claude Code projects directory
    if (fs.existsSync(claudeProjects)) {
      try {
        this.claudeWatcher = fs.watch(claudeProjects, { recursive: true }, (_event, filename) => {
          if (filename && filename.endsWith('.jsonl')) {
            scheduleSync();
          }
        });
        console.log('👀 [PlatformWatcher] Watching Claude Code session transcripts in real-time...');
      } catch (err: any) {
        console.log('[PlatformWatcher] Claude watch notice:', err.message);
      }
    }

    // 2. Poll Codex SQLite WAL / state modification time
    this.pollTimer = setInterval(() => {
      try {
        const fileToCheck = fs.existsSync(codexWal)
          ? codexWal
          : fs.existsSync(codexState)
          ? codexState
          : null;

        if (fileToCheck) {
          const stat = fs.statSync(fileToCheck);
          const mtime = stat.mtimeMs;
          if (this.lastCodexMtime && mtime > this.lastCodexMtime + 500) {
            scheduleSync();
          }
          this.lastCodexMtime = mtime;
        }
      } catch {}
    }, intervalMs);

    console.log('👀 [PlatformWatcher] Real-time platform session watcher active.');
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.claudeWatcher) this.claudeWatcher.close();
  }
}
