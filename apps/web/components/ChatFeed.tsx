'use client';
import React, { useRef, useEffect } from 'react';
import { Message } from '../../../types';
import { TerminalCard } from './TerminalCard';
import { DiffCard } from './DiffCard';
import ReactMarkdown from 'react-markdown';

interface ChatFeedProps {
  messages: Message[];
  sessionStatus: string;
}

export function ChatFeed({ messages, sessionStatus }: ChatFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sessionStatus]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-4xl mx-auto w-full">
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 py-20">
          <p className="text-base font-medium">Phiên làm việc mới</p>
          <p className="text-xs text-gray-400 mt-1">Gửi yêu cầu bên dưới để bắt đầu điều khiển Agent trên máy local</p>
        </div>
      ) : (
        messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                  isUser
                    ? 'bg-[#1f6feb] text-white rounded-br-none'
                    : 'bg-[#161b22] border border-[#30363d] text-gray-200 rounded-bl-none shadow-sm'
                }`}
              >
                {/* Content */}
                {m.content && (
                  <div className="prose prose-invert prose-xs max-w-none">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                )}

                {/* Tool calls */}
                {m.tool_calls && m.tool_calls.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {m.tool_calls.map((tc, idx) => (
                      <React.Fragment key={idx}>
                        {tc.name === 'execute_command' && (
                          <TerminalCard command={tc.command || tc.args?.command} output={tc.result} status={tc.status} />
                        )}
                        {tc.diff && <DiffCard diffText={tc.diff} filePath={tc.args?.path} />}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}

      {sessionStatus === 'running' && (
        <div className="flex items-center gap-2 text-xs text-gray-400 italic">
          <span className="h-2 w-2 rounded-full bg-[#58a6ff] animate-ping" />
          Agent đang phân tích và thực thi tác vụ trên máy...
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
