'use client';
import React, { useState, useMemo, useEffect } from 'react';
import { Session, Device } from '../../../types';
import {
  Plus,
  Terminal,
  Laptop,
  Trash2,
  Folder,
  FolderOpen,
  Check,
  Edit2,
  Search,
  Play,
  History,
  PanelLeftClose,
  ChevronDown,
  Layers
} from 'lucide-react';

interface SidebarProps {
  device: Device | null;
  sessions: Session[];
  activeSessionId: string | null;
  currentFolder?: string;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onUpdateFolder?: (newFolder: string) => void;
  onCloseSidebar?: () => void;
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
  'D:\\Project\\sky',
  'D:\\Project\\yolo'
];

export function cleanSessionTitle(rawTitle: string): string {
  if (!rawTitle) return 'Untitled Session';
  let t = rawTitle;
  // If title contains ChatGPT reference JSON with "title":"..."
  if (t.includes('"title":"')) {
    const m = /"title":"([^"]+)"/.exec(t);
    if (m && m[1]) t = m[1];
  }
  if (t.includes('## My request:')) {
    const parts = t.split('## My request:');
    t = parts[parts.length - 1];
  }
  // Strip [Codex], [Claude], [Remote]
  t = t.replace(/^\[(Codex|Claude|Remote)\]\s*/i, '');
  t = t.replace(/^Codex:\s*/i, '').replace(/^Claude:\s*/i, '');
  // Strip markdown links [text](url) -> text
  t = t.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  t = t.replace(/\[@[^\]]+\]/g, '');
  t = t.replace(/plugin:\/\/[^\s\)]+/g, '');
  t = t.replace(/^[#\s]+/, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 55) t = t.slice(0, 52) + '...';
  return t || 'Session';
}

export function parseSessionMeta(session: Session) {
  let cwd = session.working_directory || '';
  let source: 'claude' | 'codex' | 'remoteai' = 'remoteai';
  if (session.system_prompt) {
    try {
      const meta = JSON.parse(session.system_prompt);
      if (meta.cwd) cwd = meta.cwd;
      if (meta.source) source = meta.source;
    } catch {}
  }
  return { cwd: cwd || 'D:\\Project', source };
}

export function isSessionInFolder(sessionCwd: string, selectedFolder: string): boolean {
  if (!sessionCwd || !selectedFolder) return false;
  const normSess = sessionCwd.split('\\').join('/').replace(/\/+$/, '').toLowerCase();
  const normTarget = selectedFolder.split('\\').join('/').replace(/\/+$/, '').toLowerCase();
  return normSess === normTarget || normSess.startsWith(normTarget + '/');
}

export function Sidebar({
  device,
  sessions,
  activeSessionId,
  currentFolder,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onUpdateFolder,
  onCloseSidebar
}: SidebarProps) {
  const isOnline = device?.status === 'online';
  const [editingFolder, setEditingFolder] = useState(false);
  const [folderInput, setFolderInput] = useState(currentFolder || device?.working_directory || 'D:\\Project');
  const [sessionSearch, setSessionSearch] = useState('');
  const [viewScope, setViewScope] = useState<'current_folder' | 'by_project' | 'all'>('current_folder');
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (currentFolder) {
      setFolderInput(currentFolder);
    }
  }, [currentFolder]);

  const displayFolder = currentFolder || device?.working_directory || 'D:\\Project';

  const handleSaveFolder = () => {
    if (folderInput.trim() && onUpdateFolder) {
      onUpdateFolder(folderInput.trim());
    }
    setEditingFolder(false);
  };

  const toggleProject = (projectName: string) => {
    setCollapsedProjects((prev) => ({
      ...prev,
      [projectName]: !prev[projectName]
    }));
  };

  // Group sessions by Project for by_project view
  const projectGroups = useMemo(() => {
    const groups: Record<string, { cwd: string; sessions: Session[] }> = {};
    for (const s of sessions) {
      const cleanT = cleanSessionTitle(s.title);
      if (sessionSearch && !cleanT.toLowerCase().includes(sessionSearch.toLowerCase())) {
        continue;
      }
      const { cwd } = parseSessionMeta(s);
      const projName = cwd.split(/[/\\]/).filter(Boolean).pop() || 'General';
      if (!groups[projName]) {
        groups[projName] = { cwd, sessions: [] };
      }
      groups[projName].sessions.push(s);
    }
    return Object.entries(groups).sort((a, b) => b[1].sessions.length - a[1].sessions.length);
  }, [sessions, sessionSearch]);

  // Filter sessions for current_folder or all views
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const cleanT = cleanSessionTitle(s.title);
      const titleMatch = cleanT.toLowerCase().includes(sessionSearch.toLowerCase());
      if (!titleMatch) return false;

      if (viewScope === 'current_folder') {
        const { cwd } = parseSessionMeta(s);
        return isSessionInFolder(cwd, displayFolder);
      }
      return true;
    });
  }, [sessions, sessionSearch, viewScope, displayFolder]);

  const currentFolderCount = useMemo(() => {
    return sessions.filter((s) => {
      const { cwd } = parseSessionMeta(s);
      return isSessionInFolder(cwd, displayFolder);
    }).length;
  }, [sessions, displayFolder]);

  const renderSessionCard = (s: Session) => {
    const isActive = s.id === activeSessionId;
    const { cwd, source } = parseSessionMeta(s);
    const cleanT = cleanSessionTitle(s.title);
    const folderName = cwd.split(/[/\\]/).filter(Boolean).pop() || cwd;

    return (
      <div
        key={s.id}
        onClick={() => onSelectSession(s.id)}
        className={`group flex flex-col rounded-xl p-2.5 text-xs cursor-pointer transition border select-none ${
          isActive
            ? 'bg-[#1f6feb]/15 text-[#58a6ff] border-[#1f6feb]/50 font-medium shadow-sm'
            : 'text-gray-300 border-transparent hover:bg-[#21262d] hover:border-[#30363d]'
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          <div className="font-semibold truncate flex-1 text-white pr-1">
            {cleanT}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteSession(s.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400 transition rounded"
            title="Xóa phiên"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Metadata row */}
        <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1.5">
          <div className="flex items-center gap-1.5 truncate max-w-[170px]">
            {source === 'claude' ? (
              <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">Claude</span>
            ) : source === 'codex' ? (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">Codex</span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-medium">Remote</span>
            )}
            <span className="truncate text-gray-400 font-mono" title={cwd}>📁 {folderName}</span>
          </div>

          {isActive ? (
            <span className="text-[10px] font-medium text-emerald-400 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
              Đang xem
            </span>
          ) : (
            <span className="opacity-0 group-hover:opacity-100 text-[#58a6ff] font-medium flex items-center gap-0.5 transition">
              <Play className="h-2.5 w-2.5 fill-current" />
              Resume
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className="w-80 flex-shrink-0 border-r border-[#30363d] bg-[#161b22] flex flex-col h-screen select-none">
      {/* Header */}
      <div className="p-4 border-b border-[#30363d] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-[#58a6ff]" />
          <span className="font-bold text-base text-white tracking-tight">RemoteAI</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-gray-400 font-medium">{isOnline ? 'PC Online' : 'PC Offline'}</span>
          </div>
          {onCloseSidebar && (
            <button
              type="button"
              onClick={onCloseSidebar}
              className="p-1 rounded-md text-gray-400 hover:text-white hover:bg-[#21262d] transition"
              title="Thu gọn Sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Device & Folder Selector Info */}
      <div className="p-3 bg-[#0d1117] mx-3 my-2 rounded-xl border border-[#30363d] text-xs shadow-inner">
        <div className="flex items-center justify-between text-gray-300 font-medium">
          <div className="flex items-center gap-1.5">
            <Laptop className="h-3.5 w-3.5 text-[#58a6ff]" />
            <span className="text-white font-semibold">{device?.name || 'Windows Host'}</span>
          </div>
          <button
            onClick={() => setEditingFolder(!editingFolder)}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#21262d] transition"
            title="Đổi thư mục làm việc"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {editingFolder ? (
          <div className="mt-2 space-y-2">
            <div className="flex gap-1">
              <input
                type="text"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="Đường dẫn thư mục..."
                className="flex-1 bg-[#161b22] border border-[#30363d] rounded-lg px-2.5 py-1 text-xs text-white outline-none focus:border-[#58a6ff]"
              />
              <button
                onClick={handleSaveFolder}
                className="bg-[#238636] hover:bg-[#2ea043] px-2.5 py-1 rounded-lg text-white transition flex items-center justify-center"
              >
                <Check className="h-3.5 w-3.5" />
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
              className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-1.5 text-[11px] text-gray-300 outline-none"
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
            className="mt-1.5 flex items-center gap-1.5 text-gray-300 hover:text-white cursor-pointer transition truncate group"
            title={`Bấm để đổi folder: ${displayFolder}`}
          >
            <Folder className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
            <span className="truncate text-xs font-mono font-medium">{displayFolder}</span>
            <span className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-500 ml-auto">Đổi</span>
          </div>
        )}
      </div>

      {/* New Session Button */}
      <div className="px-3 py-1">
        <button
          onClick={onCreateSession}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#238636] hover:bg-[#2ea043] py-2.5 text-xs font-semibold text-white shadow transition"
        >
          <Plus className="h-4 w-4" />
          Tạo Phiên Mới
        </button>
      </div>

      {/* Scope Filter Tabs (3 Modes) */}
      <div className="px-3 pt-2">
        <div className="flex rounded-lg bg-[#0d1117] p-0.5 border border-[#30363d] text-[11px]">
          <button
            type="button"
            onClick={() => setViewScope('current_folder')}
            className={`flex-1 py-1 rounded text-center font-medium transition flex items-center justify-center gap-1 ${
              viewScope === 'current_folder'
                ? 'bg-[#21262d] text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            title="Chỉ hiện phiên trong thư mục đang chọn"
          >
            <Folder className="h-3 w-3 text-amber-400" />
            <span>Thư mục</span>
            <span className="text-[10px] px-1 bg-[#161b22] rounded-full text-gray-400">{currentFolderCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewScope('by_project')}
            className={`flex-1 py-1 rounded text-center font-medium transition flex items-center justify-center gap-1 ${
              viewScope === 'by_project'
                ? 'bg-[#21262d] text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            title="Nhóm theo từng Dự án / Repository"
          >
            <Layers className="h-3 w-3 text-emerald-400" />
            <span>Dự án</span>
            <span className="text-[10px] px-1 bg-[#161b22] rounded-full text-gray-400">{projectGroups.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewScope('all')}
            className={`flex-1 py-1 rounded text-center font-medium transition flex items-center justify-center gap-1 ${
              viewScope === 'all'
                ? 'bg-[#21262d] text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            title="Hiển thị toàn bộ tất cả phiên"
          >
            <History className="h-3 w-3 text-blue-400" />
            <span>Tất cả</span>
            <span className="text-[10px] px-1 bg-[#161b22] rounded-full text-gray-400">{sessions.length}</span>
          </button>
        </div>
      </div>

      {/* Search Sessions */}
      <div className="px-3 pt-2">
        <div className="flex items-center gap-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg px-2.5 py-1.5 text-xs">
          <Search className="h-3 w-3 text-gray-500" />
          <input
            type="text"
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
            placeholder="Tìm kiếm phiên làm việc..."
            className="bg-transparent border-0 text-xs text-white outline-none placeholder-gray-500 w-full"
          />
        </div>
      </div>

      {/* Sessions List Container */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {viewScope === 'by_project' ? (
          /* Project Accordions */
          projectGroups.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">Không tìm thấy dự án nào.</div>
          ) : (
            projectGroups.map(([projName, group]) => {
              const isCollapsed = collapsedProjects[projName];
              const isCurrentActiveProj = isSessionInFolder(group.cwd, displayFolder);

              return (
                <div key={projName} className="mb-2 rounded-xl bg-[#0d1117]/60 border border-[#30363d]/70 overflow-hidden">
                  {/* Project Header */}
                  <div
                    onClick={() => toggleProject(projName)}
                    className="flex items-center justify-between p-2.5 bg-[#161b22]/90 hover:bg-[#21262d] cursor-pointer transition"
                  >
                    <div className="flex items-center gap-2 truncate flex-1">
                      {isCurrentActiveProj ? (
                        <FolderOpen className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <Folder className="h-4 w-4 text-amber-400 flex-shrink-0" />
                      )}
                      <span className="font-semibold text-xs text-white truncate">{projName}</span>
                      <span className="text-[10px] px-1.5 py-0.2 bg-[#0d1117] rounded-full text-gray-400 font-mono">
                        {group.sessions.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {onUpdateFolder && !isCurrentActiveProj && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateFolder(group.cwd);
                          }}
                          className="text-[10px] text-gray-400 hover:text-[#58a6ff] hover:bg-[#0d1117] px-1.5 py-0.5 rounded transition"
                          title={`Chuyển workspace sang ${group.cwd}`}
                        >
                          Chọn
                        </button>
                      )}
                      <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                    </div>
                  </div>

                  {/* Sessions inside this project */}
                  {!isCollapsed && (
                    <div className="p-1 space-y-1 bg-[#0d1117]/30 border-t border-[#30363d]/40">
                      {group.sessions.map((s) => renderSessionCard(s))}
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : (
          /* Current Folder or All Flat List */
          filteredSessions.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">
              {viewScope === 'current_folder' ? (
                <div>
                  <p>Chưa có phiên nào trong thư mục này.</p>
                  <button
                    onClick={onCreateSession}
                    className="mt-2 text-[#58a6ff] hover:underline font-medium inline-block"
                  >
                    + Tạo phiên làm việc mới
                  </button>
                </div>
              ) : (
                'Không tìm thấy phiên làm việc nào.'
              )}
            </div>
          ) : (
            filteredSessions.map((s) => renderSessionCard(s))
          )
        )}
      </div>
    </aside>
  );
}
