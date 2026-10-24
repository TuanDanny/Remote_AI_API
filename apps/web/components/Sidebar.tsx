'use client';
import React, { useState } from 'react';
import { Session, Device } from '../../../types';
import { Plus, Terminal, Laptop, Trash2, Folder, Check, Edit2, Search } from 'lucide-react';

interface SidebarProps {
  device: Device | null;
  sessions: Session[];
  activeSessionId: string | null;
  currentFolder?: string;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onUpdateFolder?: (newFolder: string) => void;
}

const COMMON_FOLDERS = [
  'D:\\Project',
  'D:\\Project\\RemoteAI',
  'D:\\Project\\AW-Car',
  'D:\\Project\\ClaudechatMCP',
  'D:\\Project\\IoT-MCP',
  'D:\\Project\\IoT_Core',
  'D:\\Project\\Audio_Compass',
  'D:\\Project\\devices',
  'D:\\Project\\Finace',
  'D:\\Project\\meomeo_project',
  'D:\\Project\\MYS',
  'D:\\Project\\Note_ClipBoard',
  'D:\\Project\\SHTP',
  'D:\\Project\\Skill-for-antigravity',
  'D:\\Project\\yolo'
];

export function Sidebar({
  device,
  sessions,
  activeSessionId,
  currentFolder,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onUpdateFolder
}: SidebarProps) {
  const isOnline = device?.status === 'online';
  const [editingFolder, setEditingFolder] = useState(false);
  const [folderInput, setFolderInput] = useState(currentFolder || device?.working_directory || 'D:\\Project');
  const [sessionSearch, setSessionSearch] = useState('');

  const displayFolder = currentFolder || device?.working_directory || 'D:\\Project';

  const handleSaveFolder = () => {
    if (folderInput.trim() && onUpdateFolder) {
      onUpdateFolder(folderInput.trim());
    }
    setEditingFolder(false);
  };

  const filteredSessions = sessions.filter(s =>
    (s.title || 'Untitled Session').toLowerCase().includes(sessionSearch.toLowerCase())
  );

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

      {/* Device & Folder Selector Info */}
      <div className="p-3 bg-[#0d1117] mx-3 my-2 rounded-lg border border-[#30363d] text-xs">
        <div className="flex items-center justify-between text-gray-300 font-medium">
          <div className="flex items-center gap-1.5">
            <Laptop className="h-3.5 w-3.5 text-[#58a6ff]" />
            <span>{device?.name || 'Windows Host'}</span>
          </div>
          <button
            onClick={() => setEditingFolder(!editingFolder)}
            className="text-gray-400 hover:text-white p-0.5 transition"
            title="Đổi thư mục làm việc"
          >
            <Edit2 className="h-3 w-3" />
          </button>
        </div>

        {editingFolder ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex gap-1">
              <input
                type="text"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="Đường dẫn thư mục..."
                className="flex-1 bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-[11px] text-white outline-none focus:border-[#58a6ff]"
              />
              <button
                onClick={handleSaveFolder}
                className="bg-[#238636] hover:bg-[#2ea043] px-2 py-1 rounded text-white transition"
              >
                <Check className="h-3 w-3" />
              </button>
            </div>
            {/* Quick dropdown select */}
            <select
              onChange={(e) => {
                if (e.target.value) {
                  setFolderInput(e.target.value);
                  if (onUpdateFolder) onUpdateFolder(e.target.value);
                  setEditingFolder(false);
                }
              }}
              defaultValue=""
              className="w-full bg-[#161b22] border border-[#30363d] rounded px-1.5 py-1 text-[10px] text-gray-300 outline-none"
            >
              <option value="" disabled>-- Chọn nhanh thư mục --</option>
              {COMMON_FOLDERS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        ) : (
          <div
            onClick={() => setEditingFolder(true)}
            className="mt-1 flex items-center gap-1 text-gray-400 hover:text-gray-200 cursor-pointer transition truncate"
            title={`Bấm để đổi folder: ${displayFolder}`}
          >
            <Folder className="h-3 w-3 flex-shrink-0 text-amber-400" />
            <span className="truncate text-[11px] font-mono">{displayFolder}</span>
          </div>
        )}
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

      {/* Search Sessions */}
      {sessions.length > 3 && (
        <div className="px-3 py-1">
          <div className="flex items-center gap-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg px-2 py-1 text-xs">
            <Search className="h-3 w-3 text-gray-500" />
            <input
              type="text"
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              placeholder="Tìm kiếm phiên..."
              className="bg-transparent border-0 text-[11px] text-white outline-none placeholder-gray-500 w-full"
            />
          </div>
        </div>
      )}

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        <div className="px-2 flex items-center justify-between text-[10px] font-semibold text-gray-400 tracking-wider uppercase">
          <span>Phiên làm việc</span>
          <span className="bg-[#21262d] px-1.5 py-0.5 rounded text-gray-400 font-mono">{sessions.length}</span>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-500">
            {sessionSearch ? 'Không tìm thấy phiên nào' : 'Chưa có session nào'}
          </div>
        ) : (
          filteredSessions.map((s) => {
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
                <div className="truncate flex-1 pr-2">
                  <div className="truncate">{s.title || 'Untitled Session'}</div>
                  {s.model && (
                    <div className="text-[10px] text-gray-500 truncate mt-0.5">
                      {s.model.split('/').pop()}
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400 transition"
                  title="Xóa phiên"
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
