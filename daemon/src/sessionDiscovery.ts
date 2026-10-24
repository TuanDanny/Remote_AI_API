import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';
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
              if (normSession !== normTarget && !normSession.startsWith(normTarget)) {
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

    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; tool_calls?: any[] }> = [];
    let detectedCwd = '';
    let firstUserPrompt = '';

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.cwd && !detectedCwd) {
          detectedCwd = obj.cwd;
        }

        if (obj.type === 'user' && obj.message?.content) {
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
            messages.push({ role: 'user', content: cleanText });
          }
        } else if (obj.type === 'assistant' && obj.message?.content) {
          let text = '';
          const toolCalls: any[] = [];
          if (Array.isArray(obj.message.content)) {
            for (const item of obj.message.content) {
              if (item.type === 'text') text += item.text;
              if (item.type === 'tool_use') {
                toolCalls.push({ name: item.name, args: item.input });
              }
            }
          } else if (typeof obj.message.content === 'string') {
            text = obj.message.content;
          }
          if (text || toolCalls.length > 0) {
            messages.push({ role: 'assistant', content: text, tool_calls: toolCalls });
          }
        }
      } catch {
        // ignore malformed json line
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
    const indexPath = path.join(this.getHomeDir(), '.codex', 'session_index.jsonl');

    if (!fs.existsSync(indexPath)) return results;

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
      console.error('[SessionDiscovery] Error reading Codex sessions:', err?.message || err);
    }

    return results;
  }

  async syncDiscoveredSessionsToSupabase(folder?: string): Promise<number> {
    const claudeSessions = await this.discoverClaudeSessions(folder);
    const codexSessions = await this.discoverCodexSessions(folder);
    const allDiscovered = [...claudeSessions, ...codexSessions];

    let syncedCount = 0;

    for (const ds of allDiscovered) {
      // Check if session already exists by title and device
      const { data: existing } = await this.supabase
        .from('sessions')
        .select('id')
        .eq('device_id', this.deviceId)
        .eq('title', ds.title)
        .maybeSingle();

      if (existing) {
        continue;
      }

      // Insert new session with cwd in system_prompt metadata
      const meta = JSON.stringify({
        cwd: ds.cwd,
        source: ds.source,
        isExternal: true
      });

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

      // Sync recent messages (take last 20 for quick responsive loading)
      const recentMessages = ds.messages.slice(-20);
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

    console.log(`[SessionDiscovery] Synced ${syncedCount} new external sessions to Supabase.`);
    return syncedCount;
  }
}
