import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import spawn from 'cross-spawn';
import { createClient } from '@supabase/supabase-js';
import { HeartbeatService } from './heartbeat.js';
import { SessionDiscoveryService } from './sessionDiscovery.js';
import { PlatformWatcher } from './platformWatcher.js';

function findClaudeBinary(): string {
  const candidates = [
    'C:/Users/tuand/AppData/Local/Claude-3p/claude-code/2.1.308/c17a819afb40/claude.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Claude-3p', 'claude-code', '2.1.308', 'c17a819afb40', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    'claude.exe',
    'claude'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'claude';
}

function findCodexBinary(): string {
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex'),
    'codex.exe',
    'codex'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'codex';
}

function getClaudeEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  const base = path.join(os.homedir(), 'AppData', 'Local', 'Claude-3p');
  if (fs.existsSync(base)) {
    try {
      const files = fs.readdirSync(base).filter(f => f.startsWith('host-creds-') && f.endsWith('.json'));
      if (files.length > 0) {
        const creds = JSON.parse(fs.readFileSync(path.join(base, files[0]), 'utf8'));
        if (creds?.env) {
          Object.assign(env, creds.env);
        }
      }
    } catch {}
  }
  return env;
}

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const DEVICE_ID = process.env.DEVICE_ID || 'win11-main';
const DEVICE_NAME = process.env.DEVICE_NAME || 'My Windows PC';
const WORKSPACE_ROOT = process.env.ALLOWED_WORKSPACE_ROOT || process.cwd();

export function createCoordinator(options?: {
  supabaseUrl?: string;
  supabaseKey?: string;
  deviceId?: string;
  deviceName?: string;
  workspaceRoot?: string;
}) {
  const url = options?.supabaseUrl || SUPABASE_URL;
  const key = options?.supabaseKey || SUPABASE_KEY;
  const deviceId = options?.deviceId || DEVICE_ID;
  const deviceName = options?.deviceName || DEVICE_NAME;
  const workspaceRoot = options?.workspaceRoot || WORKSPACE_ROOT;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in environment');
  }

  const supabase = createClient(url, key);
  const heartbeat = new HeartbeatService(supabase, deviceId, deviceName, workspaceRoot);
  const discovery = new SessionDiscoveryService(supabase, deviceId);

  // Relay prompt from Web to local CLI / Codex session
  async function handleNewUserMessage(messageRow: any) {
    const sessionId = messageRow.session_id;
    const userContent = messageRow.content;

    if (!userContent || !userContent.trim()) return;

    console.log(`[Bridge] Incoming prompt from Web for session ${sessionId}: "${userContent.slice(0, 50)}..."`);

    // Fetch session details from Supabase
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (session && session.device_id && session.device_id !== deviceId) {
      console.log(`[Bridge] Skipping session ${sessionId}: belongs to ${session.device_id}, not ${deviceId}`);
      return;
    }

    let sessionMeta: any = {};
    if (session?.system_prompt) {
      try {
        sessionMeta = JSON.parse(session.system_prompt);
      } catch {}
    }

    const activeWorkspace = session?.working_directory || sessionMeta.cwd || workspaceRoot;

    // 1. RELAY TO CODEX
    if (sessionMeta.source === 'codex' && sessionMeta.sourceId) {
      console.log(`[Bridge] Relaying to Codex thread "${sessionMeta.sourceId}"...`);
      const codexBin = findCodexBinary();

      try {
        const proc = spawn(codexBin, ['queue', '--thread', sessionMeta.sourceId, '--message', userContent], {
          cwd: activeWorkspace,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        proc.on('close', async (code) => {
          console.log(`[Bridge] Codex queue finished with exit code ${code}`);
          // Immediate sync to reflect queued state
          await discovery.syncDiscoveredSessionsToSupabase();
        });
        return;
      } catch (err: any) {
        console.error('[Bridge] Failed to dispatch to Codex:', err?.message || err);
      }
    }

    // 2. RELAY TO CLAUDE CODE
    const claudeBin = findClaudeBinary();
    const cliEnv = getClaudeEnv();
    const cliSessionId = sessionMeta.cliSessionId;

    const rawModel = (session?.model || sessionMeta.model || 'claude-sonnet-4-5').toLowerCase();
    let cliModel = 'claude-sonnet-4-5';
    if (rawModel.includes('opus')) {
      cliModel = 'claude-opus-4-6-thinking';
    } else if (rawModel.includes('haiku')) {
      cliModel = 'claude-haiku-4-5';
    } else if (rawModel.includes('anti')) {
      cliModel = 'claude-claude_anti';
    }

    const cliArgs = cliSessionId
      ? ['-p', '--resume', cliSessionId, '--model', cliModel, userContent]
      : ['-p', '--model', cliModel, userContent];

    console.log(`[Bridge] Relaying to Claude CLI (${cliSessionId ? `resuming ${cliSessionId}` : 'new session'}) in "${activeWorkspace}"...`);

    try {
      const proc = spawn(claudeBin, cliArgs, {
        env: cliEnv,
        cwd: activeWorkspace,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      proc.on('close', async (code) => {
        console.log(`[Bridge] Claude CLI finished with exit code ${code}`);
        // Watcher will automatically pick up the new turns written to JSONL
        await discovery.syncDiscoveredSessionsToSupabase();
      });
    } catch (err: any) {
      console.error('[Bridge] Failed to spawn Claude CLI:', err?.message || err);
    }
  }

  return {
    supabase,
    heartbeat,
    discovery,
    handleNewUserMessage
  };
}

export async function main() {
  console.log('🚀 Starting RemoteAI Simple Bridge Daemon on Windows...');
  console.log(`📂 Workspace Root: ${WORKSPACE_ROOT}`);

  let coordinator: ReturnType<typeof createCoordinator>;
  try {
    coordinator = createCoordinator();
  } catch (err: any) {
    console.error(`❌ Initialization Error: ${err.message}`);
    process.exit(1);
  }

  const { supabase, heartbeat, discovery, handleNewUserMessage } = coordinator;

  await heartbeat.start();
  console.log('🟢 Heartbeat service active (Online).');

  // Initial clean sync of all local sessions and messages
  try {
    console.log('🔍 Syncing local Claude Code & Codex sessions...');
    await discovery.syncDiscoveredSessionsToSupabase();
    console.log('✅ Local sessions synced to Supabase successfully.');
  } catch (err: any) {
    console.error('[SessionDiscovery] Sync error:', err?.message || err);
  }

  // Start real-time local file watcher (mirrors local chat to web immediately)
  const platformWatcher = new PlatformWatcher(discovery);
  platformWatcher.start(1500);

  // Subscribe to device updates from Web UI (working directory changes)
  supabase
    .channel('devices-channel')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'devices', filter: `id=eq.${coordinator.heartbeat['deviceId'] || DEVICE_ID}` },
      (payload) => {
        const updated = payload.new as any;
        if (updated?.working_directory) {
          heartbeat.setWorkingDirectory(updated.working_directory);
          console.log(`[Heartbeat] Working directory updated to: ${updated.working_directory}`);
          discovery.syncDiscoveredSessionsToSupabase(updated.working_directory).catch(() => {});
        }
      }
    )
    .subscribe();

  // Subscribe to new user messages from Web UI
  supabase
    .channel('messages-channel')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      async (payload) => {
        const newMsg = payload.new as any;
        if (newMsg && newMsg.role === 'user') {
          await handleNewUserMessage(newMsg);
        }
      }
    )
    .subscribe((status) => {
      console.log(`[Realtime] Subscription status: ${status}`);
    });

  console.log('👂 Listening for prompts from Web Dashboard...');
}

if (process.argv[1] && (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js'))) {
  main().catch((err) => {
    console.error('Fatal Daemon Error:', err);
    process.exit(1);
  });
}
