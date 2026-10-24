import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { SupabaseClient } from '@supabase/supabase-js';

export interface DiscoveredSession {
  id?: string;
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

  async discoverClaudeSessions(targetFolder?: string): Promise<DiscoveredSession[]> {
    const results: DiscoveredSession[] = [];
    const claudeProjectsDir = path.join(this.getHomeDir(), '.claude', 'projects');

    if (!fs.existsSync(claudeProjectsDir)) return results;

    const projectDirs = fs.readdirSync(claudeProjectsDir);

    for (const pDir of projectDirs) {
      const fullProjectDirPath = path.join(claudeProjectsDir, pDir);
      if (!fs.statSync(fullProjectDirPath).isDirectory()) continue;

      const jsonlFiles = fs.readdirSync(fullProjectDirPath).filter(f => f.endsWith('.jsonl'));
      for (const jsonlFile of jsonlFiles) {
        const filePath = path.join(fullProjectDirPath, jsonlFile);
        try {
          const sessionData = await this.parseClaudeSessionFile(filePath);
          if (sessionData && sessionData.messages.length > 0) {
            if (targetFolder) {
              const normTarget = path.normalize(targetFolder).toLowerCase();
              const normSession = path.normalize(sessionData.cwd).toLowerCase();
              if (normSession !== normTarget && !normSession.startsWith(normTarget + path.sep)) {
                continue;
              }
            }
            results.push(sessionData);
          }
        } catch (err: any) {
          console.error(`[SessionDiscovery] Error reading ${filePath}:`, err?.message || err);
        }
      }
    }

    return results;
  }

  private async parseClaudeSessionFile(filePath: string): Promise<DiscoveredSession | null> {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const rawMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; tool_calls?: any[] }> = [];
    let detectedCwd = '';
    let firstUserPrompt = '';
    let currentAssistant: { role: 'assistant'; content: string; tool_calls: any[] } | null = null;

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.cwd && !detectedCwd) {
          detectedCwd = obj.cwd;
        }

        if (obj.type === 'user' && obj.message?.content) {
          if (currentAssistant) {
            rawMessages.push(currentAssistant);
            currentAssistant = null;
          }
          let text = '';
          if (typeof obj.message.content === 'string') {
            text = obj.message.content;
          } else if (Array.isArray(obj.message.content)) {
            text = obj.message.content.map((c: any) => c.text || '').join('\n');
          }
          const cleanText = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
          if (cleanText) {
            if (!firstUserPrompt) {
              firstUserPrompt = cleanText.slice(0, 50).trim();
            }
            rawMessages.push({ role: 'user', content: cleanText });
          }
        } else if (obj.type === 'assistant' && obj.message?.content) {
          if (!currentAssistant) {
            currentAssistant = { role: 'assistant', content: '', tool_calls: [] };
          }
          if (Array.isArray(obj.message.content)) {
            for (const item of obj.message.content) {
              if (item.type === 'text') currentAssistant.content += item.text;
              if (item.type === 'tool_use') {
                currentAssistant.tool_calls.push({ name: item.name, args: item.input });
              }
            }
          } else if (typeof obj.message.content === 'string') {
            currentAssistant.content += obj.message.content;
          }
        }
      } catch {
        // ignore malformed json line
      }
    }

    if (currentAssistant) {
      rawMessages.push(currentAssistant);
    }

    // Merge consecutive assistant messages so tools and texts in a turn stay together
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; tool_calls?: any[] }> = [];
    for (const m of rawMessages) {
      const prev = messages[messages.length - 1];
      if (prev && prev.role === 'assistant' && m.role === 'assistant') {
        if (m.content) {
          prev.content += (prev.content ? '\n\n' : '') + m.content;
        }
        if (m.tool_calls && m.tool_calls.length > 0) {
          prev.tool_calls = [...(prev.tool_calls || []), ...m.tool_calls];
        }
      } else {
        messages.push({ ...m, tool_calls: [...(m.tool_calls || [])] });
      }
    }

    if (!detectedCwd) {
      detectedCwd = 'D:\\Project';
    }

    return {
      title: firstUserPrompt ? `Claude: ${firstUserPrompt}` : 'Claude Local Session',
      cwd: detectedCwd,
      source: 'claude',
      model: 'ag/claude-opus-4-6-thinking',
      messages
    };
  }

  async discoverCodexSessions(targetFolder?: string): Promise<DiscoveredSession[]> {
    const results: DiscoveredSession[] = [];
    const queryScriptPath = path.join(process.cwd(), 'src', 'query_codex.py');
    const fallbackPath = path.join(__dirname, 'query_codex.py');
    const rootPath = path.join(process.cwd(), 'daemon', 'src', 'query_codex.py');
    const scriptToRun = fs.existsSync(queryScriptPath)
      ? queryScriptPath
      : fs.existsSync(rootPath)
      ? rootPath
      : fallbackPath;

    if (fs.existsSync(scriptToRun)) {
      try {
        const proc = spawnSync('python', [scriptToRun], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        if (proc.stdout) {
          const list = JSON.parse(proc.stdout);
          for (const item of list) {
            const cwd = item.cwd || 'D:\\Project';
            if (targetFolder) {
              const normTarget = path.normalize(targetFolder).toLowerCase();
              const normSession = path.normalize(cwd).toLowerCase();
              if (normSession !== normTarget && !normSession.startsWith(normTarget + path.sep)) {
                continue;
              }
            }
            results.push({
              id: item.id,
              title: item.title ? `Codex: ${item.title}` : 'Codex Session',
              cwd: cwd,
              source: 'codex',
              model: item.model || 'cx/gpt-6.1-sol',
              messages: item.first_message ? [{ role: 'user', content: item.first_message }] : []
            });
          }
          return results;
        }
      } catch (err: any) {
        console.error('[SessionDiscovery] Python Codex query error:', err?.message || err);
      }
    }

    // Fallback if python script not available
    const indexPath = path.join(this.getHomeDir(), '.codex', 'session_index.jsonl');
    if (fs.existsSync(indexPath)) {
      try {
        const fileStream = fs.createReadStream(indexPath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            results.push({
              id: obj.id,
              title: `Codex: ${obj.thread_name || 'Thread'}`,
              cwd: targetFolder || 'D:\\Project',
              source: 'codex',
              model: 'cx/gpt-6.1-sol',
              updatedAt: obj.updated_at,
              messages: []
            });
          } catch {}
        }
      } catch (err: any) {
        console.error('[SessionDiscovery] Fallback index reading error:', err?.message || err);
      }
    }

    return results;
  }

  async syncDiscoveredSessionsToSupabase(folder?: string): Promise<number> {
    const claudeSessions = await this.discoverClaudeSessions(folder);
    const codexSessions = await this.discoverCodexSessions(folder);
    const allDiscovered = [...claudeSessions, ...codexSessions];

    let syncedCount = 0;

    for (const ds of allDiscovered) {
      const meta = JSON.stringify({
        cwd: ds.cwd,
        source: ds.source,
        isExternal: true
      });

      // Check if session already exists by title and device
      const { data: existing } = await this.supabase
        .from('sessions')
        .select('id, system_prompt')
        .eq('device_id', this.deviceId)
        .eq('title', ds.title)
        .maybeSingle();

      if (existing) {
        // Update cwd and clean up messages if it was previously filled with fragmented tool calls
        await this.supabase
          .from('sessions')
          .update({
            system_prompt: meta,
            model: ds.model || 'cx/gpt-6.1-sol'
          })
          .eq('id', existing.id);

        if (ds.messages.length > 0) {
          const { count } = await this.supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('session_id', existing.id);

          // If messages were fragmented or need refresh
          if (!count || count < 5 || count > 30) {
            await this.supabase.from('messages').delete().eq('session_id', existing.id);
            const recentMessages = ds.messages.slice(-16);
            for (const m of recentMessages) {
              await this.supabase.from('messages').insert({
                session_id: existing.id,
                role: m.role,
                content: m.content || '',
                tool_calls: m.tool_calls || []
              });
            }
          }
        }
        continue;
      }

      // Insert new session with cwd in system_prompt metadata
      const { data: newSession, error: sErr } = await this.supabase
        .from('sessions')
        .insert({
          device_id: this.deviceId,
          title: ds.title,
          model: ds.model || 'cx/gpt-6.1-sol',
          system_prompt: meta,
          status: 'idle'
        })
        .select()
        .single();

      if (sErr || !newSession) {
        console.error('[SessionDiscovery] Insert session error:', sErr?.message);
        continue;
      }

      // Sync recent messages (take last 16 merged turns for responsive loading)
      const recentMessages = ds.messages.slice(-16);
      for (const m of recentMessages) {
        await this.supabase.from('messages').insert({
          session_id: newSession.id,
          role: m.role,
          content: m.content || '',
          tool_calls: m.tool_calls || []
        });
      }

      syncedCount++;
    }

    console.log(`[SessionDiscovery] Synced / refreshed external sessions in Supabase.`);
    return syncedCount;
  }
}
