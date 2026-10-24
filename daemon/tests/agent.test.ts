import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { LocalTools } from '../src/tools.js';
import { AgentRunner } from '../src/agent.js';
import type { ToolCall } from '../../types/index.js';

describe('AgentRunner Suite', () => {
  const testRoot = path.join(process.cwd(), 'temp_agent_test_workspace');
  let tools: LocalTools;
  let server: http.Server;
  let baseUrl: string;
  let mockHandler: (req: http.IncomingMessage, res: http.ServerResponse, reqBody: string) => void;

  before(async () => {
    if (!fs.existsSync(testRoot)) {
      fs.mkdirSync(testRoot, { recursive: true });
    }
    tools = new LocalTools(testRoot);

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (mockHandler) {
          mockHandler(req, res, body);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    mockHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Default response' } }] }));
    };
  });

  test('getToolDefinitions returns complete OpenAI function calling schema', () => {
    const agent = new AgentRunner({
      routerBaseUrl: baseUrl,
      apiKey: 'test-key',
      model: 'test-model',
      tools
    });

    const definitions = agent.getToolDefinitions();
    assert.strictEqual(Array.isArray(definitions), true);
    assert.strictEqual(definitions.length, 6);

    const toolNames = definitions.map(d => d.function.name);
    assert.deepStrictEqual(
      toolNames.sort(),
      ['edit_file', 'execute_command', 'list_directory', 'read_file', 'search_code', 'write_file'].sort()
    );

    for (const def of definitions) {
      assert.strictEqual(def.type, 'function');
      assert.ok(def.function.description);
      assert.strictEqual(def.function.parameters.type, 'object');
    }
  });

  test('runStep calls AI Router with auth header and streams response text', async () => {
    let capturedReq: { headers: http.IncomingHttpHeaders; body: any } | null = null;

    mockHandler = (req, res, body) => {
      capturedReq = { headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello! I can help you with your project.'
            }
          }
        ]
      }));
    };

    const agent = new AgentRunner({
      routerBaseUrl: baseUrl,
      apiKey: 'secret-token-123',
      model: 'anthropic/claude-3.5-sonnet',
      tools
    });

    const streamChunks: string[] = [];
    const result = await agent.runStep(
      [{ role: 'user', content: 'Hi' }],
      (chunk) => { streamChunks.push(chunk); },
      async () => true
    );

    assert.ok(capturedReq);
    const reqData = capturedReq as { headers: http.IncomingHttpHeaders; body: any };
    assert.strictEqual(reqData.headers['authorization'], 'Bearer secret-token-123');
    assert.strictEqual(reqData.headers['content-type'], 'application/json');
    assert.strictEqual(reqData.body.model, 'anthropic/claude-3.5-sonnet');
    assert.strictEqual(reqData.body.messages[0].content, 'Hi');

    assert.strictEqual(result.responseText, 'Hello! I can help you with your project.');
    assert.deepStrictEqual(streamChunks, ['Hello! I can help you with your project.']);
    assert.strictEqual(result.toolCalls.length, 0);
  });

  test('runStep handles read_file and write_file tool calls', async () => {
    fs.writeFileSync(path.join(testRoot, 'source.txt'), 'line 1\nline 2', 'utf8');

    mockHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Reading source and writing dest',
              tool_calls: [
                {
                  id: 'call_read_1',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: JSON.stringify({ path: 'source.txt' })
                  }
                },
                {
                  id: 'call_write_1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({ path: 'output.txt', content: 'new content here' })
                  }
                }
              ]
            }
          }
        ]
      }));
    };

    const agent = new AgentRunner({
      routerBaseUrl: baseUrl,
      apiKey: 'test-key',
      model: 'test-model',
      tools
    });

    const result = await agent.runStep([], () => {}, async () => true);

    assert.strictEqual(result.toolCalls.length, 2);

    const readCall = result.toolCalls[0];
    assert.strictEqual(readCall.name, 'read_file');
    assert.strictEqual(readCall.status, 'completed');
    assert.match(readCall.result || '', /1\tline 1/);

    const writeCall = result.toolCalls[1];
    assert.strictEqual(writeCall.name, 'write_file');
    assert.strictEqual(writeCall.status, 'completed');
    assert.strictEqual(fs.readFileSync(path.join(testRoot, 'output.txt'), 'utf8'), 'new content here');
  });

  test('runStep handles edit_file and generates diff', async () => {
    fs.writeFileSync(path.join(testRoot, 'script.js'), 'const a = 1;\nconsole.log(a);', 'utf8');

    mockHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Editing script.js',
              tool_calls: [
                {
                  id: 'call_edit_1',
                  type: 'function',
                  function: {
                    name: 'edit_file',
                    arguments: JSON.stringify({
                      path: 'script.js',
                      old_content: 'const a = 1;',
                      new_content: 'const a = 42;'
                    })
                  }
                }
              ]
            }
          }
        ]
      }));
    };

    const agent = new AgentRunner({
      routerBaseUrl: baseUrl,
      apiKey: 'test-key',
      model: 'test-model',
      tools
    });

    const result = await agent.runStep([], () => {}, async () => true);

    assert.strictEqual(result.toolCalls.length, 1);
    const editCall = result.toolCalls[0];
    assert.strictEqual(editCall.name, 'edit_file');
    assert.strictEqual(editCall.status, 'completed');
    assert.ok(editCall.diff && editCall.diff.includes('+const a = 42;'));

    const updated = fs.readFileSync(path.join(testRoot, 'script.js'), 'utf8');
    assert.match(updated, /const a = 42;/);
  });

  test('runStep handles list_directory and search_code', async () => {
    fs.writeFileSync(path.join(testRoot, 'findme.ts'), 'export const targetSymbol = 100;', 'utf8');

    mockHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Inspecting repo',
              tool_calls: [
                {
                  id: 'call_list_1',
                  type: 'function',
                  function: {
                    name: 'list_directory',
                    arguments: JSON.stringify({ path: '.' })
                  }
                },
                {
                  id: 'call_search_1',
                  type: 'function',
                  function: {
                    name: 'search_code',
                    arguments: JSON.stringify({ pattern: 'targetSymbol' })
                  }
                }
              ]
            }
          }
        ]
      }));
    };

    const agent = new AgentRunner({
      routerBaseUrl: baseUrl,
      apiKey: 'test-key',
      model: 'test-model',
      tools
    });

    const result = await agent.runStep([], () => {}, async () => true);

    assert.strictEqual(result.toolCalls.length, 2);
    const listCall = result.toolCalls[0];
    assert.strictEqual(listCall.name, 'list_directory');
    assert.strictEqual(listCall.status, 'completed');
    assert.match(listCall.result || '', /findme\.ts/);

    const searchCall = result.toolCalls[1];
    assert.strictEqual(searchCall.name, 'search_code');
    assert.strictEqual(searchCall.status, 'completed');
    assert.match(searchCall.result || '', /targetSymbol/);
  });

  test('runStep handles execute_command when approved', async () => {
    mockHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Running command',
              tool_calls: [
                {
                  id: 'call_exec_1',
                  type: 'function',
                  function: {
                    name: 'execute_command',
                    arguments: JSON.stringify({ command: 'node -e "console.log(\'Agent Executed\')"' })
                  }
                }
              ]
            }
          }
        ]
      }));
    };

    const agent = new AgentRunner({
      routerBaseUrl: baseUrl,
      apiKey: 'test-key',
      model: 'test-model',
      tools
    });

    let toolChecked: ToolCall | null = null;
    const result = await agent.runStep(
      [],
      () => {},
      async (toolCall) => {
        toolChecked = toolCall;
        return true;
      }
    );

    assert.ok(toolChecked);
    assert.strictEqual((toolChecked as ToolCall).name, 'execute_command');
    assert.strictEqual(result.toolCalls[0].status, 'completed');
    assert.match(result.toolCalls[0].result || '', /Agent Executed/);
  });

  test('runStep handles execute_command when rejected', async () => {
    mockHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Running dangerous command',
              tool_calls: [
                {
                  id: 'call_exec_2',
                  type: 'function',
                  function: {
                    name: 'execute_command',
                    arguments: JSON.stringify({ command: 'rm -rf /' })
                  }
                }
              ]
            }
          }
        ]
      }));
    };

    const agent = new AgentRunner({
      routerBaseUrl: baseUrl,
      apiKey: 'test-key',
      model: 'test-model',
      tools
    });

    const result = await agent.runStep(
      [],
      () => {},
      async () => false // User rejects execution
    );

    assert.strictEqual(result.toolCalls[0].status, 'rejected');
    assert.match(result.toolCalls[0].result || '', /rejected/i);
  });

  test('runStep throws error on AI Router non-200 response', async () => {
    mockHandler = (_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    };

    const agent = new AgentRunner({
      routerBaseUrl: baseUrl,
      apiKey: 'bad-key',
      model: 'test-model',
      tools
    });

    await assert.rejects(
      async () => {
        await agent.runStep([], () => {}, async () => true);
      },
      /AI Router Error \(401\)/
    );
  });

  test('runStep supports SSE streaming when text/event-stream is returned', async () => {
    mockHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Chunk 1 "}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"Chunk 2"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    };

    const agent = new AgentRunner({
      routerBaseUrl: baseUrl,
      apiKey: 'test-key',
      model: 'test-model',
      tools,
      stream: true
    });

    const receivedChunks: string[] = [];
    const result = await agent.runStep(
      [{ role: 'user', content: 'Stream test' }],
      (chunk) => { receivedChunks.push(chunk); },
      async () => true
    );

    assert.deepStrictEqual(receivedChunks, ['Chunk 1 ', 'Chunk 2']);
    assert.strictEqual(result.responseText, 'Chunk 1 Chunk 2');
  });

  test('processMessage delegates to runStep with user prompt', async () => {
    mockHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Answer from processMessage'
            }
          }
        ]
      }));
    };

    const agent = new AgentRunner({
      routerBaseUrl: baseUrl,
      apiKey: 'test-key',
      model: 'test-model',
      tools
    });

    const result = await agent.processMessage(
      'session-xyz',
      'What is 2+2?',
      () => {}
    );

    assert.strictEqual(result.responseText, 'Answer from processMessage');
    assert.strictEqual(result.toolCalls.length, 0);
  });
});
