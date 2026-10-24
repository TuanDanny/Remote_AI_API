'use client';
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Device, Session, Message } from '../../../types';
import { Sidebar } from '../components/Sidebar';
import { ChatFeed } from '../components/ChatFeed';
import { PasscodeGate } from '../components/PasscodeGate';
import { Send } from 'lucide-react';

export default function DashboardPage() {
  const [device, setDevice] = useState<Device | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5');

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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !activeSessionId) return;

    const userText = prompt.trim();
    setPrompt('');

    await supabase.from('messages').insert({
      session_id: activeSessionId,
      role: 'user',
      content: userText
    });
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

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
            <div className="font-semibold text-sm text-white truncate">
              {activeSession?.title || 'Chọn một phiên làm việc'}
            </div>
            <select
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="bg-[#0d1117] border border-[#30363d] rounded-lg px-2.5 py-1 text-xs text-gray-300 outline-none focus:border-[#58a6ff]"
            >
              <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
              <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
              <option value="claude-claude_anti">Claude Anti</option>
              <option value="modelapi/gpt-6-sol">GPT-6 Sol</option>
              <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
              <option value="openai/gpt-4o">GPT-4o</option>
            </select>
          </header>

          {/* Chat Feed */}
          <ChatFeed messages={messages} sessionStatus={activeSession?.status || 'idle'} />

          {/* Input Box */}
          <footer className="p-4 border-t border-[#30363d] bg-[#161b22]">
            <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-2">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Nhập yêu cầu cho Agent trên máy tính (VD: Viết test cho file auth.ts)..."
                className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-500 outline-none focus:border-[#58a6ff]"
              />
              <button
                type="submit"
                disabled={!prompt.trim() || !activeSessionId}
                className="bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 text-white rounded-xl px-4 py-2.5 flex items-center justify-center transition"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </footer>
        </main>
      </div>
    </PasscodeGate>
  );
}
