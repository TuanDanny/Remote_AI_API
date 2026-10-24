import fs from 'node:fs';
import path from 'node:path';
import spawn from 'cross-spawn';
import * as diff from 'diff';

export interface ToolResult {
  success: boolean;
  content?: string;
  output?: string;
  diff?: string;
  error?: string;
  files?: string[];
}

export class LocalTools {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  private resolveSafePath(relPath: string): string {
    const fullPath = path.resolve(this.workspaceRoot, relPath);
    const normalizedRoot = path.normalize(this.workspaceRoot);
    const normalizedPath = path.normalize(fullPath);

    const relative = path.relative(normalizedRoot, normalizedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !normalizedPath.startsWith(normalizedRoot)) {
      throw new Error(`Access denied: Path is outside workspace (${relPath})`);
    }
    return normalizedPath;
  }

  async readFile(relPath: string): Promise<ToolResult> {
    try {
      const safePath = this.resolveSafePath(relPath);
      if (!fs.existsSync(safePath)) {
        return { success: false, error: `File not found: ${relPath}` };
      }
      const raw = fs.readFileSync(safePath, 'utf8');
      const lines = raw.split('\n');
      const numbered = lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
      return { success: true, content: numbered };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async writeFile(relPath: string, content: string): Promise<ToolResult> {
    try {
      const safePath = this.resolveSafePath(relPath);
      const parentDir = path.dirname(safePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(safePath, content, 'utf8');
      return { success: true, content: `File written: ${relPath}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async editFile(relPath: string, oldContent: string, newContent: string): Promise<ToolResult> {
    try {
      const safePath = this.resolveSafePath(relPath);
      if (!fs.existsSync(safePath)) {
        return { success: false, error: `File not found: ${relPath}` };
      }
      const current = fs.readFileSync(safePath, 'utf8');
      if (!current.includes(oldContent)) {
        return { success: false, error: `oldContent not found in ${relPath}` };
      }
      const updated = current.replace(oldContent, newContent);
      fs.writeFileSync(safePath, updated, 'utf8');

      const patch = diff.createPatch(relPath, current, updated, 'before', 'after');
      return { success: true, content: `File updated: ${relPath}`, diff: patch };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async listDirectory(relPath: string = '.'): Promise<ToolResult> {
    try {
      const safePath = this.resolveSafePath(relPath);
      const entries = fs.readdirSync(safePath, { withFileTypes: true });
      const files = entries.map(e => e.isDirectory() ? `${e.name}/` : e.name);
      return { success: true, files };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async executeCommand(command: string, cwdRel: string = '.'): Promise<ToolResult> {
    return new Promise((resolve) => {
      try {
        const safeCwd = this.resolveSafePath(cwdRel);
        const isWindows = process.platform === 'win32';
        const shell = isWindows ? 'powershell.exe' : '/bin/bash';
        const shellArgs = isWindows ? ['-NoProfile', '-Command', command] : ['-c', command];

        const proc = spawn(shell, shellArgs, {
          cwd: safeCwd,
          env: process.env,
        });

        let output = '';

        proc.stdout?.on('data', (d) => { output += d.toString(); });
        proc.stderr?.on('data', (d) => { output += d.toString(); });

        const timer = setTimeout(() => {
          proc.kill();
          resolve({ success: false, output, error: 'Command timed out after 60s' });
        }, 60000);

        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({
            success: code === 0,
            output,
            error: code !== 0 ? `Process exited with code ${code}` : undefined
          });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ success: false, output, error: err.message });
        });
      } catch (err: any) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  async searchCode(pattern: string, relPath: string = '.'): Promise<ToolResult> {
    try {
      const safePath = this.resolveSafePath(relPath);
      const regex = new RegExp(pattern);
      const matches: string[] = [];

      const searchDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            searchDir(full);
          } else if (entry.isFile()) {
            try {
              const content = fs.readFileSync(full, 'utf8');
              const lines = content.split('\n');
              lines.forEach((line, idx) => {
                if (regex.test(line)) {
                  const rel = path.relative(this.workspaceRoot, full);
                  matches.push(`${rel}:${idx + 1}: ${line.trim()}`);
                }
              });
            } catch {
              // ignore unreadable/binary files
            }
          }
        }
      };

      searchDir(safePath);
      return { success: true, files: matches, content: matches.join('\n') };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
