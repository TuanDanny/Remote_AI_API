import { LocalTools } from './tools.js';
import type { ToolCall } from '../../types/index.js';

export interface AgentOptions {
  routerBaseUrl: string;
  apiKey: string;
  model: string;
  tools: LocalTools;
  stream?: boolean;
}

export class AgentRunner {
  private routerBaseUrl: string;
  private apiKey: string;
  private model: string;
  private tools: LocalTools;
  private stream: boolean;

  constructor(opts: AgentOptions) {
    this.routerBaseUrl = opts.routerBaseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.tools = opts.tools;
    this.stream = opts.stream ?? false;
  }

  getToolDefinitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read the contents of a file at path',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path to file' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Create or overwrite a file at path with content',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path to file' },
              content: { type: 'string', description: 'Full content to write' }
            },
            required: ['path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'edit_file',
          description: 'Replace old_content with new_content in an existing file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path to file' },
              old_content: { type: 'string', description: 'Text to replace' },
              new_content: { type: 'string', description: 'New text' }
            },
            required: ['path', 'old_content', 'new_content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'list_directory',
          description: 'List files and folders in directory',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative directory path' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'execute_command',
          description: 'Execute a shell command on the local machine',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Shell command line to execute' }
            },
            required: ['command']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_code',
          description: 'Search for regex pattern across files in directory',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Regex pattern to search' },
              path: { type: 'string', description: 'Relative directory path' }
            },
            required: ['pattern']
          }
        }
      }
    ];
  }

  async runStep(
    messages: any[],
    onStream: (chunk: string) => void | Promise<void>,
    onToolExecute: (toolCall: ToolCall) => Promise<boolean>,
    modelOverride?: string
  ): Promise<{ responseText: string; toolCalls: ToolCall[] }> {
    const url = `${this.routerBaseUrl}/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: modelOverride || this.model,
        messages,
        tools: this.getToolDefinitions(),
        stream: this.stream
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI Router Error (${res.status}): ${errText}`);
    }

    const isStream = res.headers.get('content-type')?.includes('text/event-stream');
    let content = '';
    const rawToolCalls: Array<{ id: string; function?: { name?: string; arguments?: string } }> = [];

    if (isStream) {
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const rawToolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') continue;
            if (trimmed.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) {
                  content += delta.content;
                  await Promise.resolve(onStream(delta.content));
                }
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    const existing = rawToolCallsMap.get(idx) || { id: '', name: '', arguments: '' };
                    if (tc.id) existing.id = tc.id;
                    if (tc.function?.name) existing.name += tc.function.name;
                    if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                    rawToolCallsMap.set(idx, existing);
                  }
                }
              } catch {
                // ignore partial JSON parse error
              }
            }
          }
        }
      }

      for (const item of rawToolCallsMap.values()) {
        rawToolCalls.push({
          id: item.id,
          function: {
            name: item.name,
            arguments: item.arguments
          }
        });
      }
    } else {
      const data: any = await res.json();
      const choice = data.choices?.[0];
      const message = choice?.message || {};
      content = message.content || '';
      if (Array.isArray(message.tool_calls)) {
        rawToolCalls.push(...message.tool_calls);
      }

      if (content) {
        await Promise.resolve(onStream(content));
      }
    }

    const toolCalls: ToolCall[] = [];

    for (const tc of rawToolCalls) {
      const name = tc.function?.name || '';
      let args: Record<string, any> = {};
      try {
        args = typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments || {});
      } catch {
        args = {};
      }

      const toolCall: ToolCall = {
        id: tc.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name,
        args,
        status: 'running'
      };

      let resultText = '';
      if (name === 'read_file') {
        const r = await this.tools.readFile(args.path);
        resultText = r.success ? r.content || '' : `Error: ${r.error}`;
        if (!r.success) toolCall.status = 'failed';
      } else if (name === 'write_file') {
        const r = await this.tools.writeFile(args.path, args.content);
        resultText = r.success ? r.content || '' : `Error: ${r.error}`;
        if (!r.success) toolCall.status = 'failed';
      } else if (name === 'edit_file') {
        const r = await this.tools.editFile(args.path, args.old_content, args.new_content);
        resultText = r.success ? r.content || '' : `Error: ${r.error}`;
        toolCall.diff = r.diff;
        if (!r.success) toolCall.status = 'failed';
      } else if (name === 'list_directory') {
        const r = await this.tools.listDirectory(args.path || '.');
        resultText = r.success ? (r.files || []).join('\n') : `Error: ${r.error}`;
        if (!r.success) toolCall.status = 'failed';
      } else if (name === 'search_code') {
        const r = await this.tools.searchCode(args.pattern, args.path || '.');
        resultText = r.success ? r.content || '' : `Error: ${r.error}`;
        if (!r.success) toolCall.status = 'failed';
      } else if (name === 'execute_command') {
        toolCall.command = args.command;
        const approved = await onToolExecute(toolCall);
        if (!approved) {
          resultText = 'User rejected this command execution.';
          toolCall.status = 'rejected';
        } else {
          const r = await this.tools.executeCommand(args.command);
          resultText = r.success ? r.output || 'Command completed.' : `Error: ${r.error}\nOutput: ${r.output}`;
          toolCall.status = r.success ? 'completed' : 'failed';
        }
      } else {
        resultText = `Unknown tool: ${name}`;
        toolCall.status = 'failed';
      }

      toolCall.result = resultText;
      if (toolCall.status === 'running') {
        toolCall.status = 'completed';
      }
      toolCalls.push(toolCall);
    }

    return { responseText: content, toolCalls };
  }

  async processMessage(
    _sessionId: string,
    userPrompt: string,
    onStream: (chunk: string) => void | Promise<void>,
    onToolExecute?: (toolCall: ToolCall) => Promise<boolean>,
    modelOverride?: string
  ): Promise<{ responseText: string; toolCalls: ToolCall[] }> {
    return this.runStep(
      [{ role: 'user', content: userPrompt }],
      onStream,
      onToolExecute || (async () => true),
      modelOverride
    );
  }
}
