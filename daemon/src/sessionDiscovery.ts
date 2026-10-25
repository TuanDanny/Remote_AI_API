import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { SupabaseClient } from '@supabase/supabase-js';

export interface DiscoveredSession {
  id?: string;
  cliSessionId?: string;
  desktopSessionId?: string;
  title: string;
  cwd: string;
  source: 'claude' | 'codex' | 'remoteai';
  model?: string;
  updatedAt?: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    tool_calls?: any[];
  }>;
}

export class SessionDiscoveryService {
  private supabase: SupabaseClient;
  private deviceId: string;

  constructor(supabase: SupabaseClient, deviceId: string) {
    this.supabase = supabase;
    this.deviceId = deviceId;
  }

  private getHomeDir(): string {
    return os.homedir();
  }

  findClaudeJsonl(cliSessionId: string): string | null {
    const pDir = path.join(this.getHomeDir(), '.claude', 'projects');
    if (!fs.existsSync(pDir)) return null;
    try {
      const dirs = fs.readdirSync(pDir);
      for (const d of dirs) {
        const full = path.join(pDir, d, cliSessionId + '.jsonl');
        if (fs.existsSync(full)) return full;
      }
    } catch {}
    return null;
  }

  async parseClaudeJsonlFile(filePath: string): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string; tool_calls?: any[] }>> {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const turns: Array<{ role: 'user' | 'assistant' | 'system'; content: string; tool_calls?: any[] }> = [];
    let curAssistant: { role: 'assistant'; content: string; tool_calls: any[] } | null = null;

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const otype = obj.type;
        const mcontent = obj.message?.content;

        // In Claude Code jsonl, tool results come back as user turns with tool_result blocks.
        // These are internal engine replies, NOT real human messages.
        const isToolResult = otype === 'user' && Array.isArray(mcontent) && mcontent.some((c: any) => c.type === 'tool_result');

        if (otype === 'user' && !isToolResult && mcontent) {
          if (curAssistant) {
            turns.push(curAssistant);
            curAssistant = null;
          }
          let text = typeof mcontent === 'string'
            ? mcontent
            : Array.isArray(mcontent)
            ? mcontent.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('\n')
            : '';

          // Remove system reminders
          text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

          // Exclude internal setup commands
          if (text && !text.startsWith('Base directory for this skill:') && !text.startsWith('[SYSTEM NOTIFICATION')) {
            turns.push({ role: 'user', content: text, tool_calls: [] });
          }
        } else if (otype === 'assistant' && mcontent) {
          if (!curAssistant) {
            curAssistant = { role: 'assistant', content: '', tool_calls: [] };
          }
          if (typeof mcontent === 'string') {
            curAssistant.content += (curAssistant.content ? '\n\n' : '') + mcontent;
          } else if (Array.isArray(mcontent)) {
            for (const item of mcontent) {
              if (item.type === 'text' && item.text) {
                curAssistant.content += (curAssistant.content ? '\n\n' : '') + item.text;
              } else if (item.type === 'tool_use') {
                curAssistant.tool_calls.push({
                  name: item.name,
                  args: item.input || {}
                });
              }
            }
          }
        }
      } catch {}
    }

    if (curAssistant) {
      turns.push(curAssistant);
    }

    return turns;
  }

  async discoverClaudeDesktopSessions(): Promise<DiscoveredSession[]> {
    const results: DiscoveredSession[] = [];
    const base = path.join(this.getHomeDir(), 'AppData', 'Local', 'Claude-3p', 'claude-code-sessions');
    if (!fs.existsSync(base)) return results;

    try {
      for (const acc of fs.readdirSync(base)) {
        const accPath = path.join(base, acc);
        if (!fs.statSync(accPath).isDirectory()) continue;
        for (const sub of fs.readdirSync(accPath)) {
          const subPath = path.join(accPath, sub);
          if (!fs.statSync(subPath).isDirectory()) continue;
          for (const f of fs.readdirSync(subPath)) {
            if (f.startsWith('local_') && f.endsWith('.json')) {
              try {
                const data = JSON.parse(fs.readFileSync(path.join(subPath, f), 'utf8'));
                if (!data.isArchived && data.cliSessionId) {
                  const jsonlPath = this.findClaudeJsonl(data.cliSessionId);
                  let messages: any[] = [];
                  if (jsonlPath) {
                    messages = await this.parseClaudeJsonlFile(jsonlPath);
                  }

                  results.push({
                    id: data.sessionId,
                    cliSessionId: data.cliSessionId,
                    desktopSessionId: data.sessionId,
                    title: data.title || 'Claude Session',
                    cwd: data.cwd || 'D:\\Project',
                    source: 'claude',
                    model: data.model || 'ag/claude-opus-4-6-thinking',
                    messages
                  });
                }
              } catch {}
            }
          }
        }
      }
    } catch (err: any) {
      console.error('[SessionDiscovery] Claude Desktop scan error:', err.message);
    }

    return results;
  }

  async discoverCodexSessions(): Promise<DiscoveredSession[]> {
    const results: DiscoveredSession[] = [];
    const queryScriptPath = path.join(process.cwd(), 'src', 'query_codex.py');
    const rootPath = path.join(process.cwd(), 'daemon', 'src', 'query_codex.py');
    const scriptToRun = fs.existsSync(queryScriptPath) ? queryScriptPath : fs.existsSync(rootPath) ? rootPath : null;

    if (!scriptToRun) return results;

    try {
      const proc = spawnSync('python', [scriptToRun], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      if (proc.stdout) {
        const list = JSON.parse(proc.stdout);
        for (const item of list) {
          const cwd = item.cwd || 'D:\\Project';
          results.push({
            id: item.id,
            title: item.title ? `Codex: ${item.title}` : 'Codex Session',
            cwd: cwd,
            source: 'codex',
            model: item.model || 'cx/gpt-6.1-sol',
            messages: item.first_message ? [{ role: 'user', content: item.first_message, tool_calls: [] }] : []
          });
        }
      }
    } catch (err: any) {
      console.error('[SessionDiscovery] Codex discovery error:', err.message);
    }

    return results;
  }

  async syncDiscoveredSessionsToSupabase(folder?: string): Promise<number> {
    const claudeSessions = await this.discoverClaudeDesktopSessions();
    const codexSessions = await this.discoverCodexSessions();
    const allDiscovered = [...claudeSessions, ...codexSessions];

    let syncedCount = 0;

    for (const ds of allDiscovered) {
      const meta = JSON.stringify({
        cwd: ds.cwd,
        source: ds.source,
        cliSessionId: ds.cliSessionId || null,
        desktopSessionId: ds.desktopSessionId || null,
        isExternal: true
      });

      // Check if session already exists in Supabase
      const { data: existing } = await this.supabase
        .from('sessions')
        .select('id, system_prompt')
        .eq('device_id', this.deviceId)
        .eq('title', ds.title)
        .maybeSingle();

      let targetSessionId = existing?.id;

      if (existing) {
        // Update session meta
        await this.supabase
          .from('sessions')
          .update({
            system_prompt: meta,
            model: ds.model || 'ag/claude-opus-4-6-thinking'
          })
          .eq('id', existing.id);
      } else {
        // Insert new session
        const { data: newSession, error: sErr } = await this.supabase
          .from('sessions')
          .insert({
            device_id: this.deviceId,
            title: ds.title,
            model: ds.model || 'ag/claude-opus-4-6-thinking',
            system_prompt: meta,
            status: 'idle'
          })
          .select()
          .single();

        if (sErr || !newSession) {
          console.error('[SessionDiscovery] Insert session error:', sErr?.message);
          continue;
        }
        targetSessionId = newSession.id;
        syncedCount++;
      }

      // Sync latest 25 messages if present
      if (ds.messages.length > 0 && targetSessionId) {
        const { count } = await this.supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', targetSessionId);

        // If messages count is significantly different, replace with clean turns
        if (!count || Math.abs(count - Math.min(ds.messages.length, 25)) > 2) {
          await this.supabase.from('messages').delete().eq('session_id', targetSessionId);
          const recent = ds.messages.slice(-25);
          for (const m of recent) {
            await this.supabase.from('messages').insert({
              session_id: targetSessionId,
              role: m.role,
              content: m.content || '',
              tool_calls: m.tool_calls || []
            });
          }
        }
      }
    }

    console.log(`[SessionDiscovery] Synced ${claudeSessions.length} Claude Desktop + ${codexSessions.length} Codex sessions.`);
    return syncedCount;
  }
}
