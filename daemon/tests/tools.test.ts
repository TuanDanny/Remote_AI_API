import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { LocalTools } from '../src/tools.js';

describe('LocalTools Suite', () => {
  const testRoot = path.join(process.cwd(), 'temp_test_workspace');
  let tools: LocalTools;

  before(() => {
    if (!fs.existsSync(testRoot)) fs.mkdirSync(testRoot, { recursive: true });
    tools = new LocalTools(testRoot);
  });

  after(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true, force: true });
  });

  test('write_file and read_file successfully', async () => {
    const filePath = 'hello.txt';
    const writeRes = await tools.writeFile(filePath, 'Hello World\nLine 2');
    assert.strictEqual(writeRes.success, true);

    const readRes = await tools.readFile(filePath);
    assert.strictEqual(readRes.success, true);
    assert.match(readRes.content || '', /Hello World/);
  });

  test('path traversal is blocked', async () => {
    const maliciousPath = '../outside.txt';
    const res = await tools.readFile(maliciousPath);
    assert.strictEqual(res.success, false);
    assert.match(res.error || '', /Access denied: Path is outside workspace/);
  });

  test('edit_file generates diff and modifies content', async () => {
    const filePath = 'code.js';
    await tools.writeFile(filePath, 'const x = 1;\nconsole.log(x);');

    const editRes = await tools.editFile(filePath, 'const x = 1;', 'const x = 2;');
    assert.strictEqual(editRes.success, true);
    assert.ok(editRes.diff && editRes.diff.includes('+const x = 2;'));

    const readRes = await tools.readFile(filePath);
    assert.match(readRes.content || '', /const x = 2;/);
  });

  test('execute_command runs shell commands', async () => {
    const res = await tools.executeCommand('node -e "console.log(\'Command Test Output\')"');
    assert.strictEqual(res.success, true);
    assert.match(res.output || '', /Command Test Output/);
  });
});
