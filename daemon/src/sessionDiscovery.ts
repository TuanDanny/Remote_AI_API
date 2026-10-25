import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { SupabaseClient } from '@supabase/supabase-js';

export interface DiscoveredSession {
  sourceId: string;
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

function cleanTitle(rawTitle: string): string {
  if (!rawTitle) return 'Untitled Session';
  let t = rawTitle.trim();

  if (t.includes('"title":"')) {
    const m = /"title":"([^"]+)"/.exec(t);
    if (m && m[1]) t = m[1];
  }
  if (t.includes('## My request:')) {
    const parts = t.split('## My request:');
    t = parts[parts.length - 1];
  }

  t = t.replace(/^\[(Codex|Claude|Remote)\]\s*/i, '');
  t = t.replace(/^Codex:\s*/i, '').replace(/^Claude:\s*/i, '');
  t = t.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  t = t.replace(/\[@[^\]]+\]/g, '');
  t = t.replace(/plugin:\/\/[^\s\)]+/g, '');
  t = t.replace(/^[#\s]+/, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 55) t = t.slice(0, 52) + '...';
  return t || 'Untitled Session';
}

function isNoiseMessage(text: string): boolean {
  if (!text || !text.trim()) return true;
  const t = text.trim();
  if (t.includes("There's an issue with the selected model")) return true;
  if (t === 'No response requested.') return true;
  if (t.startsWith('Base directory for this skill:')) return true;
  if (t.startsWith('[SYSTEM NOTIFICATION')) return true;
  if (t.startsWith('[Image: source:') && t.endsWith(']')) return true;
  return false;
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
    let firstUserPrompt = '';

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const otype = obj.type;
        const mcontent = obj.message?.content;

        const isToolResult = otype === 'user' && Array.isArray(mcontent) && mcontent.some((c: any) => c.type === 'tool_result');

        if (otype === 'user' && !isToolResult && mcontent) {
          if (curAssistant && curAssistant.content.trim()) {
            turns.push(curAssistant);
            curAssistant = null;
          }
          let text = typeof mcontent === 'string'
            ? mcontent
            : Array.isArray(mcontent)
            ? mcontent.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('\n')
            : '';

          text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
          text = text.replace(/\[Image:\s*source:[^\]]+\]/g, '').trim();

          if (text && !isNoiseMessage(text)) {
            const prevUser = turns.filter(t => t.role === 'user').pop();
            if (!prevUser || prevUser.content !== text) {
              turns.push({ role: 'user', content: text, tool_calls: [] });
            }
          }
        } else if (otype === 'assistant' && mcontent) {
          if (!curAssistant) {
            curAssistant = { role: 'assistant', content: '', tool_calls: [] };
          }
          if (typeof mcontent === 'string') {
            if (!isNoiseMessage(mcontent)) {
              curAssistant.content += (curAssistant.content ? '\n\n' : '') + mcontent;
            }
          } else if (Array.isArray(mcontent)) {
            for (const item of mcontent) {
              if (item.type === 'text' && item.text && !isNoiseMessage(item.text)) {
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

    if (curAssistant && curAssistant.content.trim()) {
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

                  const title = cleanTitle(data.title || 'Claude Session');

                  results.push({
                    sourceId: data.cliSessionId || data.sessionId,
                    cliSessionId: data.cliSessionId,
                    desktopSessionId: data.sessionId,
                    title: `[Claude] ${title}`,
                    cwd: data.cwd || 'D:\\Project',
                    source: 'claude',
                    model: data.model || 'claude-sonnet-4-5',
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
      const proc = spawnSync('python', [scriptToRun], { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 });
      if (proc.stdout) {
        const list = JSON.parse(proc.stdout);
        for (const item of list) {
          results.push({
            sourceId: item.sourceId || item.id,
            title: item.title,
            cwd: item.cwd || 'D:\\Project',
            source: 'codex',
            model: item.model || 'cx/gpt-6.1-sol',
            messages: item.turns || []
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

    // Fetch existing sessions once to prevent ANY duplicate inserts
    const { data: existingList } = await this.supabase
      .from('sessions')
      .select('id, title, system_prompt')
      .eq('device_id', this.deviceId);

    const existingMap = new Map<string, string>(); // sourceId -> session UUID
    for (const s of existingList || []) {
      try {
        const meta = JSON.parse(s.system_prompt || '{}');
        const sid = meta.sourceId || meta.cliSessionId || meta.desktopSessionId;
        if (sid) existingMap.set(sid, s.id);
      } catch {}
    }

    let syncedCount = 0;

    for (const ds of allDiscovered) {
      const meta = JSON.stringify({
        sourceId: ds.sourceId,
        cwd: ds.cwd,
        source: ds.source,
        cliSessionId: ds.cliSessionId || null,
        desktopSessionId: ds.desktopSessionId || null,
        isExternal: true
      });

      let targetSessionId = existingMap.get(ds.sourceId);

      if (targetSessionId) {
        // Update session metadata without inserting
        await this.supabase
          .from('sessions')
          .update({
            title: ds.title,
            system_prompt: meta,
            model: ds.model || 'claude-sonnet-4-5'
          })
          .eq('id', targetSessionId);
      } else {
        // Insert new session once
        const { data: newSession, error: sErr } = await this.supabase
          .from('sessions')
          .insert({
            device_id: this.deviceId,
            title: ds.title,
            model: ds.model || 'claude-sonnet-4-5',
            system_prompt: meta,
            status: 'idle'
          })
          .select()
          .single();

        if (sErr || !newSession) {
          continue;
        }
        targetSessionId = newSession.id;
        existingMap.set(ds.sourceId, newSession.id);
        syncedCount++;
      }

      // Sync recent turns if present
      if (ds.messages.length > 0 && targetSessionId) {
        const { count } = await this.supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', targetSessionId);

        if (!count || count < 3) {
          const recent = ds.messages.slice(-30);
          const batch = recent.map(m => ({
            session_id: targetSessionId,
            role: m.role,
            content: m.content || '',
            tool_calls: m.tool_calls || []
          }));
          await this.supabase.from('messages').insert(batch);
        }
      }
    }

    return syncedCount;
  }
}
