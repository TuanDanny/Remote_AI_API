'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Device, Session, Message } from '../../../types';
import { Sidebar } from '../components/Sidebar';
import { ChatFeed } from '../components/ChatFeed';
import { PasscodeGate } from '../components/PasscodeGate';
import PromptBar from '../components/PromptBar';
import SpecularButton from '../components/SpecularButton';
import CometDial from '../components/CometDial';
import { Play } from 'lucide-react';

const MODEL_OPTIONS = [
  { key: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', tag: 'Fast & Smart' },
  { key: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', tag: 'Instant' },
  { key: 'claude-claude_anti', name: 'Claude Anti', tag: 'Special' },
  { key: 'modelapi/gpt-6-sol', name: 'GPT-6 Sol', tag: 'Powerful' },
  { key: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', tag: 'Standard' },
  { key: 'openai/gpt-4o', name: 'GPT-4o', tag: 'OpenAI' }
];

export default function DashboardPage() {
  const [device, setDevice] = useState<Device | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5');
  const [showDial, setShowDial] = useState(false);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      const { data: dev } = await supabase.from('devices').select('*').limit(1).maybeSingle();
      if (dev) setDevice(dev as Device);

      const { data: sess } = await supabase.from('sessions').select('*').order('created_at', { ascending: false });
      if (sess && sess.length > 0) {
        setSessions(sess as Session[]);
        setActiveSessionId(sess[0].id);
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

  const handleModelChange = async (newModel: string) => {
    setSelectedModel(newModel);
    if (activeSessionId) {
      await supabase.from('sessions').update({ model: newModel }).eq('id', activeSessionId);
      setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? { ...s, model: newModel } : s)));
    }
  };

  const handleCreateSession = async () => {
    const { data } = await supabase
      .from('sessions')
      .insert({
        title: 'New Session',
        model: selectedModel,
        status: 'idle',
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

  const handleSendPrompt = async (promptText: string) => {
    if (!promptText.trim()) return;

    let targetId = activeSessionId;
    if (!targetId) {
      // Create session first if none active
      const { data: newSess } = await supabase
        .from('sessions')
        .insert({
          title: promptText.slice(0, 30),
          model: selectedModel,
          status: 'idle',
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
      content: promptText.trim()
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
        <Sidebar
          device={device}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
        />

        <main className="flex-1 flex flex-col h-screen">
          {/* Header */}
          <header className="h-14 border-b border-[#30363d] bg-[#161b22] px-6 flex items-center justify-between">
            <div className="font-semibold text-sm text-white truncate max-w-sm">
              {activeSession?.title || 'Chọn một phiên làm việc'}
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
          <ChatFeed messages={messages} sessionStatus={activeSession?.status || 'idle'} />

          {/* PromptBar Footer */}
          <footer className="p-4 border-t border-[#30363d] bg-[#161b22] flex justify-center">
            <PromptBar
              placeholder="Nhập yêu cầu điều khiển máy local (VD: Viết test cho file auth.ts)..."
              models={MODEL_OPTIONS}
              defaultModel={selectedModel}
              busy={activeSession?.status === 'running'}
              onSend={(text, options) => {
                if (options?.model?.key && options.model.key !== selectedModel) {
                  handleModelChange(options.model.key);
                }
                handleSendPrompt(text);
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
