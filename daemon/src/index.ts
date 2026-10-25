import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import spawn from 'cross-spawn';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { LocalTools } from './tools.js';
import { AgentRunner } from './agent.js';
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

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const DEVICE_ID = process.env.DEVICE_ID || 'win11-main';
const DEVICE_NAME = process.env.DEVICE_NAME || 'My Windows PC';
const WORKSPACE_ROOT = process.env.ALLOWED_WORKSPACE_ROOT || process.cwd();
const ROUTER_BASE_URL = process.env.AI_ROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const ROUTER_API_KEY = process.env.AI_ROUTER_API_KEY || '';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'anthropic/claude-3.5-sonnet';

export function createCoordinator(options?: {
  supabaseUrl?: string;
  supabaseKey?: string;
  deviceId?: string;
  deviceName?: string;
  workspaceRoot?: string;
  routerBaseUrl?: string;
  routerApiKey?: string;
  defaultModel?: string;
}) {
  const url = options?.supabaseUrl || SUPABASE_URL;
  const key = options?.supabaseKey || SUPABASE_KEY;
  const deviceId = options?.deviceId || DEVICE_ID;
  const deviceName = options?.deviceName || DEVICE_NAME;
  const workspaceRoot = options?.workspaceRoot || WORKSPACE_ROOT;
  const routerBaseUrl = options?.routerBaseUrl || ROUTER_BASE_URL;
  const routerApiKey = options?.routerApiKey || ROUTER_API_KEY;
  const defaultModel = options?.defaultModel || DEFAULT_MODEL;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in environment');
  }

  const supabase = createClient(url, key);
  const tools = new LocalTools(workspaceRoot);
  const agent = new AgentRunner({
    routerBaseUrl,
    apiKey: routerApiKey,
    model: defaultModel,
    tools
  });
  const heartbeat = new HeartbeatService(supabase, deviceId, deviceName, workspaceRoot);

  async function handleNewUserMessage(messageRow: any) {
    const sessionId = messageRow.session_id;
    const userContent = messageRow.content;

    console.log(`[Agent] Processing prompt for session ${sessionId}: "${userContent}"`);

    // Verify session exists and belongs to this device
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (session && session.device_id && session.device_id !== deviceId) {
      console.log(`[Agent] Skipping session ${sessionId}: assigned to device ${session.device_id}, not ${deviceId}`);
      return;
    }

    // Update session status to running
    await supabase.from('sessions').update({ status: 'running' }).eq('id', sessionId);

    // Fetch full conversation history
    const { data: allMessages } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    const conversationHistory: Array<{ role: string; content: string }> = [];

    // Prepend session system_prompt if specified and not already in conversation
    if (session?.system_prompt) {
      conversationHistory.push({
        role: 'system',
        content: session.system_prompt
      });
    }

    for (const m of allMessages || []) {
      if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
        conversationHistory.push({
          role: m.role,
          content: m.content || ''
        });
      }
    }

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
      console.error('[Agent] Failed to create assistant message placeholder:', insertErr?.message);
      await supabase.from('sessions').update({ status: 'idle' }).eq('id', sessionId);
      return;
    }

    let accumulatedContent = '';
    let accumulatedReasoning = '';

    const activeModel = messageRow.model || session?.model || defaultModel;
    const activeEffort = messageRow.effort || session?.effort;

    // Determine working directory priority: session.system_prompt (cwd) -> session.working_directory -> device.working_directory -> workspaceRoot
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

    // DIRECT CLI BRIDGE: If this session is linked to an existing Claude CLI session
    if (sessionMeta.cliSessionId) {
      console.log(`[Bridge] Forwarding prompt to local Claude CLI session "${sessionMeta.cliSessionId}" in ${activeWorkspace}...`);
      const claudeBin = findClaudeBinary();
      const cliEnv: Record<string, string> = {
        ...process.env as Record<string, string>,
        ANTHROPIC_AUTH_TOKEN: routerApiKey || 'sk-3107ddc0b81c7c4b-r57ief-e34d7f3c',
        ANTHROPIC_BASE_URL: routerBaseUrl || 'http://localhost:20128/v1',
        CLAUDE_CODE_HOST_AUTH_ENV_VAR: 'ANTHROPIC_AUTH_TOKEN'
      };

      try {
        const proc = spawn(claudeBin, ['-p', '--resume', sessionMeta.cliSessionId, userContent], {
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
            console.log(`[Bridge] Claude CLI session ${sessionMeta.cliSessionId} turn ended with code ${code}`);
            await supabase
              .from('messages')
              .update({
                content: accumulatedContent.trim() || 'Đã hoàn tất xử lý từ phiên CLI.'
              })
              .eq('id', assistantMsg.id);
            await supabase.from('sessions').update({ status: 'idle' }).eq('id', sessionId);
            resolve();
          });
        });
        return;
      } catch (err: any) {
        console.error('[Bridge] Failed to spawn Claude CLI:', err?.message || err);
      }
    }

    // Scope tools and agent to activeWorkspace
    const scopedTools = new LocalTools(activeWorkspace);
    const scopedAgent = new AgentRunner({
      routerBaseUrl,
      apiKey: routerApiKey,
      model: activeModel,
      tools: scopedTools
    });

    try {
      const result = await scopedAgent.runLoop(
        conversationHistory,
        async (chunk: string) => {
          accumulatedContent += chunk;
          await supabase
            .from('messages')
            .update({ content: accumulatedContent })
            .eq('id', assistantMsg.id);
        },
        async (rChunk: string) => {
          accumulatedReasoning += rChunk;
          await supabase
            .from('messages')
            .update({ reasoning: accumulatedReasoning })
            .eq('id', assistantMsg.id);
        },
        async (toolCall) => {
          console.log(`[Tool] Running ${toolCall.name} in ${activeWorkspace} with args:`, toolCall.args);
          return true;
        },
        activeModel,
        activeEffort
      );

      // Save final content, reasoning and tool_calls
      await supabase
        .from('messages')
        .update({
          content: result.responseText || accumulatedContent || 'Đã hoàn tất thực thi các công cụ.',
          reasoning: result.reasoning || accumulatedReasoning,
          tool_calls: result.toolCalls
        })
        .eq('id', assistantMsg.id);

    } catch (err: any) {
      console.error('[Agent] Execution error:', err?.message || err);
      await supabase.from('messages').insert({
        session_id: sessionId,
        role: 'system',
        content: `Lỗi thực thi từ Agent Daemon: ${err?.message || err}`
      });
    } finally {
      await supabase.from('sessions').update({ status: 'idle' }).eq('id', sessionId);
    }
  }

  const discovery = new SessionDiscoveryService(supabase, deviceId);

  return {
    supabase,
    tools,
    agent,
    heartbeat,
    discovery,
    handleNewUserMessage
  };
}

export async function main() {
  console.log('🚀 Starting RemoteAI Local Daemon on Windows...');
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

  console.log('👂 Listening for incoming sessions & prompts from Vercel Web...');

  return { coordinator, channel, deviceChannel };
}

// Auto-run if executed as main process
const isMainModule = !process.env.NODE_TEST_CONTEXT && (
  process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')
);

if (isMainModule) {
  main().catch((err) => {
    console.error('Fatal daemon error:', err);
    process.exit(1);
  });
}
