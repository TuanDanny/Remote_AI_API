'use client';
import React from 'react';
import { Session, Device } from '../../../types';
import { Plus, Terminal, Laptop, Trash2 } from 'lucide-react';

interface SidebarProps {
  device: Device | null;
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
}

export function Sidebar({
  device,
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession
}: SidebarProps) {
  const isOnline = device?.status === 'online';

  return (
    <aside className="w-72 flex-shrink-0 border-r border-[#30363d] bg-[#161b22] flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 border-b border-[#30363d] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-[#58a6ff]" />
          <span className="font-bold text-base text-white">RemoteAI</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-gray-400">{isOnline ? 'PC Online' : 'PC Offline'}</span>
        </div>
      </div>

      {/* Device Info */}
      <div className="p-3 bg-[#0d1117] mx-3 my-2 rounded-lg border border-[#30363d] text-xs">
        <div className="flex items-center gap-1.5 text-gray-300 font-medium">
          <Laptop className="h-3.5 w-3.5" />
          <span>{device?.name || 'Windows Host'}</span>
        </div>
        <div className="mt-1 text-gray-500 truncate" title={device?.working_directory}>
          {device?.working_directory || 'No workspace selected'}
        </div>
      </div>

      {/* New Session Button */}
      <div className="px-3 py-1">
        <button
          onClick={onCreateSession}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] py-2 text-xs font-semibold text-white transition"
        >
          <Plus className="h-4 w-4" />
          Tạo Phiên Mới
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        <div className="px-2 text-[10px] font-semibold text-gray-400 tracking-wider uppercase">
          Phiên làm việc gần đây
        </div>
        {sessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-500">Chưa có session nào</div>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={`group flex items-center justify-between rounded-lg px-2.5 py-2 text-xs cursor-pointer transition ${
                  isActive
                    ? 'bg-[#1f6feb]/20 text-[#58a6ff] border border-[#1f6feb]/40 font-medium'
                    : 'text-gray-300 hover:bg-[#21262d]'
                }`}
              >
                <div className="truncate flex-1 pr-2">{s.title || 'Untitled Session'}</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400 transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
