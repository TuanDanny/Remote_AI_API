import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import spawn from 'cross-spawn';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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

function getClaudeEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
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

  async function handleNewUserMessage(messageRow: any) {
    const sessionId = messageRow.session_id;
    const userContent = messageRow.content;

    console.log(`[Bridge] Processing prompt for session ${sessionId}: "${userContent.slice(0, 50)}..."`);

    // Verify session exists and belongs to this device
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (session && session.device_id && session.device_id !== deviceId) {
      console.log(`[Bridge] Skipping session ${sessionId}: assigned to device ${session.device_id}, not ${deviceId}`);
      return;
    }

    // Update session status to running
    await supabase.from('sessions').update({ status: 'running' }).eq('id', sessionId);

    // Create empty assistant response message placeholder in DB
    const { data: assistantMsg, error: insertErr } = await supabase
      .from('messages')
      .insert({
        session_id: sessionId,
        role: 'assistant',
        content: '',
        tool_calls: []
      })
      .select()
      .single();

    if (insertErr || !assistantMsg) {
      console.error('[Bridge] Failed to create assistant message placeholder:', insertErr?.message);
      await supabase.from('sessions').update({ status: 'idle' }).eq('id', sessionId);
      return;
    }

    let sessionMeta: any = {};
    if (session?.system_prompt) {
      try {
        sessionMeta = JSON.parse(session.system_prompt);
      } catch {}
    }

    let activeWorkspace = session?.working_directory || sessionMeta.cwd;
    if (!activeWorkspace) {
      const { data: dev } = await supabase
        .from('devices')
        .select('working_directory')
        .eq('id', deviceId)
        .maybeSingle();
      if (dev?.working_directory) {
        activeWorkspace = dev.working_directory;
      }
    }
    activeWorkspace = activeWorkspace || heartbeat.getWorkingDirectory() || workspaceRoot;

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
    } else {
      cliModel = 'claude-sonnet-4-5';
    }

    const cliArgs = cliSessionId
      ? ['-p', '--resume', cliSessionId, '--model', cliModel, userContent]
      : ['-p', '--model', cliModel, userContent];

    console.log(`[Bridge] Invoking Claude CLI (${cliSessionId ? `resuming ${cliSessionId}` : 'new turn'}) model=${cliModel} in "${activeWorkspace}"...`);

    let accumulatedContent = '';

    try {
      const proc = spawn(claudeBin, cliArgs, {
        env: cliEnv,
        cwd: activeWorkspace
      });

      proc.stdout?.on('data', async (d) => {
        accumulatedContent += d.toString();
        await supabase
          .from('messages')
          .update({ content: accumulatedContent })
          .eq('id', assistantMsg.id);
      });

      proc.stderr?.on('data', (d) => {
        console.log('[Claude CLI stderr]:', d.toString().slice(0, 150));
      });

      await new Promise<void>((resolve) => {
        proc.on('close', async (code) => {
          console.log(`[Bridge] Claude CLI finished with exit code ${code}`);
          const finalReply = accumulatedContent.trim() || 'Đã hoàn tất xử lý từ phiên CLI trên máy tính.';
          await supabase
            .from('messages')
            .update({ content: finalReply })
            .eq('id', assistantMsg.id);
          await supabase.from('sessions').update({ status: 'idle' }).eq('id', sessionId);
          resolve();
        });
      });
    } catch (err: any) {
      console.error('[Bridge] CLI Execution error:', err?.message || err);
      await supabase.from('messages').update({
        content: `Lỗi thực thi từ CLI máy tính: ${err?.message || err}`
      }).eq('id', assistantMsg.id);
      await supabase.from('sessions').update({ status: 'idle' }).eq('id', sessionId);
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
  console.log('🚀 Starting RemoteAI CLI Bridge Daemon on Windows...');
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

  // Discover and sync local Claude Code and Codex sessions
  try {
    console.log('🔍 Discovering existing local Claude & Codex sessions...');
    await discovery.syncDiscoveredSessionsToSupabase();
  } catch (err: any) {
    console.error('[SessionDiscovery] Sync error:', err?.message || err);
  }

  // Start live bi-directional platform session watcher
  const platformWatcher = new PlatformWatcher(discovery);
  platformWatcher.start();

  // Subscribe to device updates so heartbeat stays in sync with changes from Web UI
  const deviceChannel = supabase
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

  // Subscribe to new user messages via Supabase Realtime
  const channel = supabase
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

  console.log('👂 Listening for incoming prompts from Vercel Web to relay directly to CLI...');
}

if (process.argv[1] && process.argv[1].endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  main().catch((err) => {
    console.error('Fatal Daemon Error:', err);
    process.exit(1);
  });
}
