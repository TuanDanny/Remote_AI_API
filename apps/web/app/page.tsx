'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Device, Session, Message } from '../../../types';
import { Sidebar, parseSessionMeta } from '../components/Sidebar';
import { ChatFeed } from '../components/ChatFeed';
import { PasscodeGate } from '../components/PasscodeGate';
import PromptBar from '../components/PromptBar';
import SpecularButton from '../components/SpecularButton';
import CometDial from '../components/CometDial';
import { Play, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

const MODEL_OPTIONS = [
  { key: 'cx/gpt-6.1-sol', name: 'GPT-6.1 Sol', tag: 'Reasoning (Light-Max)' },
  { key: 'ag/gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', tag: 'Fast' },
  { key: 'cx/gpt-6-astra', name: 'GPT-6 Astra', tag: 'Coding & Speed' },
  { key: 'cx/gpt-6-luna[1m]', name: 'GPT-6 Luna [1M]', tag: '1M Context' },
  { key: 'ag/claude-opus-4-6-thinking', name: 'Claude Opus 4.6', tag: 'Thinking' }
];

export default function DashboardPage() {
  const [device, setDevice] = useState<Device | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedModel, setSelectedModel] = useState('cx/gpt-6.1-sol');
  const [selectedFolder, setSelectedFolder] = useState<string>('D:\\Project');
  const [showDial, setShowDial] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      const { data: dev } = await supabase.from('devices').select('*').limit(1).maybeSingle();
      if (dev) {
        setDevice(dev as Device);
        if (dev.working_directory) {
          setSelectedFolder(dev.working_directory);
        }
      }

      const { data: sess } = await supabase.from('sessions').select('*').order('created_at', { ascending: false });
      if (sess && sess.length > 0) {
        setSessions(sess as Session[]);
        setActiveSessionId(sess[0].id);
        const firstFolder = parseSessionMeta(sess[0] as Session).cwd;
        if (firstFolder) setSelectedFolder(firstFolder);
      }
    }
    loadData();

    // Subscribe to devices status
    const devSub = supabase
      .channel('device-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload) => {
        if (payload.new) {
          setDevice(payload.new as Device);
        }
      })
      .subscribe();

    // Subscribe to sessions status
    const sessSub = supabase
      .channel('sessions-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, (payload) => {
        if (payload.eventType === 'UPDATE') {
          setSessions((prev) => prev.map((s) => (s.id === payload.new.id ? (payload.new as Session) : s)));
        } else if (payload.eventType === 'INSERT') {
          setSessions((prev) => {
            if (prev.some((s) => s.id === payload.new.id)) return prev;
            return [payload.new as Session, ...prev];
          });
        } else if (payload.eventType === 'DELETE') {
          setSessions((prev) => prev.filter((s) => s.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(devSub);
      supabase.removeChannel(sessSub);
    };
  }, []);

  // Load messages for active session & subscribe to realtime
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }

    async function loadMessages() {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', activeSessionId)
        .order('created_at', { ascending: true });
      if (data) setMessages(data as Message[]);
    }
    loadMessages();

    const msgSub = supabase
      .channel(`messages-${activeSessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `session_id=eq.${activeSessionId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.new.id)) return prev;
              return [...prev, payload.new as Message];
            });
          } else if (payload.eventType === 'UPDATE') {
            setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? (payload.new as Message) : m)));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(msgSub);
    };
  }, [activeSessionId]);

  useEffect(() => {
    const current = sessions.find((s) => s.id === activeSessionId);
    if (current?.model) {
      setSelectedModel(current.model);
    }
  }, [activeSessionId, sessions]);

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    const chosen = sessions.find((s) => s.id === id);
    if (chosen) {
      const folder = parseSessionMeta(chosen).cwd;
      if (folder) setSelectedFolder(folder);
    }
  };

  const handleModelChange = async (newModel: string) => {
    setSelectedModel(newModel);
    if (activeSessionId) {
      await supabase.from('sessions').update({ model: newModel }).eq('id', activeSessionId);
      setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? { ...s, model: newModel } : s)));
    }
  };

  const handleUpdateFolder = async (newFolder: string) => {
    setSelectedFolder(newFolder);

    // 1. Update device working directory on Supabase
    if (device?.id) {
      await supabase.from('devices').update({ working_directory: newFolder }).eq('id', device.id);
      setDevice((prev) => (prev ? { ...prev, working_directory: newFolder } : null));
    }

    // 2. Update active session cwd in system_prompt metadata
    if (activeSessionId) {
      const active = sessions.find((s) => s.id === activeSessionId);
      let existingMeta = {};
      try {
        existingMeta = JSON.parse(active?.system_prompt || '{}');
      } catch {}
      const updatedMeta = JSON.stringify({ ...existingMeta, cwd: newFolder });

      await supabase.from('sessions').update({ system_prompt: updatedMeta }).eq('id', activeSessionId);
      setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? { ...s, system_prompt: updatedMeta } : s)));
    }
  };

  const handleCreateSession = async () => {
    const meta = JSON.stringify({
      cwd: selectedFolder,
      source: 'remoteai'
    });

    const { data } = await supabase
      .from('sessions')
      .insert({
        title: 'New Session',
        model: selectedModel,
        status: 'idle',
        system_prompt: meta,
        ...(device?.id ? { device_id: device.id } : {})
      })
      .select()
      .single();

    if (data) {
      const newSession = data as Session;
      setSessions((prev) => [newSession, ...prev.filter((s) => s.id !== newSession.id)]);
      setActiveSessionId(newSession.id);
    }
  };

  const handleDeleteSession = async (id: string) => {
    await supabase.from('sessions').delete().eq('id', id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      setActiveSessionId(remaining[0]?.id || null);
    }
  };

  const handleSendPrompt = async (promptText: string, options?: any) => {
    if (!promptText.trim()) return;

    let targetId = activeSessionId;
    const modelToUse = options?.model?.key || selectedModel;
    const effortToUse = options?.effort || 'High';

    if (!targetId) {
      const meta = JSON.stringify({
        cwd: selectedFolder,
        source: 'remoteai'
      });
      const { data: newSess } = await supabase
        .from('sessions')
        .insert({
          title: promptText.slice(0, 30),
          model: modelToUse,
          effort: effortToUse,
          status: 'idle',
          system_prompt: meta,
          ...(device?.id ? { device_id: device.id } : {})
        })
        .select()
        .single();
      if (!newSess) return;
      targetId = newSess.id;
      setSessions((prev) => [newSess, ...prev]);
      setActiveSessionId(newSess.id);
    }

    await supabase.from('messages').insert({
      session_id: targetId,
      role: 'user',
      content: promptText.trim(),
      model: modelToUse,
      effort: effortToUse
    });
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Approximate context window token usage %
  const contextPct = useMemo(() => {
    const totalChars = messages.reduce((acc, m) => acc + (m.content?.length || 0) + (m.reasoning?.length || 0), 0);
    const approxTokens = Math.round(totalChars / 3.8);
    return Math.min(100, Math.max(1, Math.round((approxTokens / 200000) * 100)));
  }, [messages]);

  return (
    <PasscodeGate>
      <div className="flex h-screen w-full bg-[#0d1117] overflow-hidden">
        {/* Collapsible Sidebar Container */}
        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0 ${
            sidebarOpen ? 'w-80' : 'w-0'
          }`}
        >
          <Sidebar
            device={device}
            sessions={sessions}
            activeSessionId={activeSessionId}
            currentFolder={selectedFolder}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            onUpdateFolder={handleUpdateFolder}
            onCloseSidebar={() => setSidebarOpen(false)}
          />
        </div>

        <main className="flex-1 flex flex-col h-screen min-w-0">
          {/* Header */}
          <header className="h-14 border-b border-[#30363d] bg-[#161b22] px-4 flex items-center justify-between">
            <div className="flex items-center gap-3 truncate max-w-lg">
              {/* Toggle Sidebar Button */}
              <button
                type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#21262d] border border-[#30363d] transition flex-shrink-0"
                title={sidebarOpen ? "Thu gọn thanh bên" : "Mở rộng thanh bên"}
              >
                {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4 text-[#58a6ff]" />}
              </button>

              <div className="font-semibold text-sm text-white truncate">
                {activeSession?.title || 'Chọn một phiên làm việc'}
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Context Window Dial Trigger */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowDial(!showDial)}
                  className="flex items-center gap-2 rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-1.5 text-xs text-gray-300 hover:text-white transition"
                  title="Context Window Usage"
                >
                  <span className="text-[11px] text-gray-400">Context:</span>
                  <span className="font-mono font-semibold text-[#58a6ff]">{contextPct}%</span>
                </button>

                {showDial && (
                  <div className="absolute right-0 top-11 z-50 rounded-2xl bg-[#161b22] border border-[#30363d] p-4 shadow-2xl flex flex-col items-center">
                    <p className="text-xs font-medium text-gray-300 mb-2">Context Window Usage</p>
                    <CometDial
                      value={contextPct}
                      size={170}
                      thickness={4}
                      accent="#58a6ff"
                      ink="#fdfdfd"
                      unit="%"
                      label="Context Window"
                    />
                  </div>
                )}
              </div>

              {/* Run Action Button (SpecularButton) */}
              <SpecularButton
                size="sm"
                radius={12}
                tint="#238636"
                tintOpacity={0.25}
                lineColor="#3fb950"
                baseColor="#2ea043"
                onClick={handleCreateSession}
              >
                <Play className="h-3 w-3 fill-current" />
                <span>New Run</span>
              </SpecularButton>
            </div>
          </header>

          {/* Chat Feed */}
          <ChatFeed
            messages={messages}
            sessionStatus={activeSession?.status || 'idle'}
            sessionTitle={activeSession?.title}
            sessionFolder={selectedFolder}
            sessionModel={activeSession?.model}
          />

          {/* PromptBar Footer */}
          <footer className="p-4 border-t border-[#30363d] bg-[#161b22] flex justify-center">
            <PromptBar
              placeholder="Nhập yêu cầu điều khiển máy local (VD: Viết test cho file auth.ts)..."
              models={MODEL_OPTIONS}
              defaultModel={selectedModel}
              efforts={['Light', 'Medium', 'High', 'XHigh', 'Max']}
              defaultEffort="High"
              busy={activeSession?.status === 'running'}
              onSend={(text, options) => {
                if (options?.model?.key && options.model.key !== selectedModel) {
                  handleModelChange(options.model.key);
                }
                handleSendPrompt(text, options);
              }}
              onStop={async () => {
                if (activeSessionId) {
                  await supabase.from('sessions').update({ status: 'idle' }).eq('id', activeSessionId);
                }
              }}
              width={840}
              background="#0d1117"
              menuBackground="#1c2128"
              color="#f5f5f5"
              sparkColor="#58a6ff"
            />
          </footer>
        </main>
      </div>
    </PasscodeGate>
  );
}
