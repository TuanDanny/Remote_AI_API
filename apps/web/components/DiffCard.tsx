'use client';
import React, { useState } from 'react';
import { FileCode, ChevronDown, ChevronRight } from 'lucide-react';

interface DiffCardProps {
  diffText?: string;
  filePath?: string;
}

export function DiffCard({ diffText, filePath }: DiffCardProps) {
  const [open, setOpen] = useState(true);
  if (!diffText) return null;

  const lines = diffText.split('\n');

  return (
    <div className="my-2 rounded-lg border border-[#30363d] bg-[#0d1117] overflow-hidden text-xs">
      <div
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between bg-[#161b22] px-3 py-2 cursor-pointer border-b border-[#30363d]"
      >
        <div className="flex items-center gap-2 text-gray-300">
          <FileCode className="h-4 w-4 text-blue-400" />
          <span className="font-mono text-gray-200">{filePath || 'Code Modification Diff'}</span>
        </div>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
      </div>
      {open && (
        <div className="p-2 font-mono text-[11px] max-h-60 overflow-y-auto">
          {lines.map((line, idx) => {
            let bg = '';
            let text = 'text-gray-300';
            if (line.startsWith('+') && !line.startsWith('+++')) {
              bg = 'bg-emerald-950/40';
              text = 'text-emerald-400';
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              bg = 'bg-red-950/40';
              text = 'text-red-400';
            } else if (line.startsWith('@@')) {
              text = 'text-cyan-400';
            }
            return (
              <div key={idx} className={`${bg} ${text} px-2 py-0.5 whitespace-pre`}>
                {line}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
