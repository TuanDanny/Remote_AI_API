'use client';
import React, { useState } from 'react';
import { Terminal, ChevronDown, ChevronRight } from 'lucide-react';

interface TerminalCardProps {
  command?: string;
  output?: string;
  status: string;
}

export function TerminalCard({ command, output, status }: TerminalCardProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="my-2 rounded-lg border border-[#30363d] bg-[#0d1117] overflow-hidden text-xs">
      <div
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between bg-[#161b22] px-3 py-2 cursor-pointer border-b border-[#30363d]"
      >
        <div className="flex items-center gap-2 text-gray-300">
          <Terminal className="h-4 w-4 text-emerald-400" />
          <span className="font-mono text-gray-200">{command || 'Terminal Execution'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
            status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
            status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400 animate-pulse'
          }`}>
            {status}
          </span>
          {open ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
        </div>
      </div>
      {open && (
        <pre className="p-3 text-[11px] font-mono text-gray-300 max-h-60 overflow-y-auto whitespace-pre-wrap">
          {output || '(Đang chạy...)'}
        </pre>
      )}
    </div>
  );
}
