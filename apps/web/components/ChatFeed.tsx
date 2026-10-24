'use client';
import React, { useRef, useEffect } from 'react';
import { Message } from '../../../types';
import { TerminalCard } from './TerminalCard';
import { DiffCard } from './DiffCard';
import CallChip from './CallChip';
import ThoughtLine from './ThoughtLine';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatFeedProps {
  messages: Message[];
  sessionStatus: string;
  sessionTitle?: string;
  sessionFolder?: string;
  sessionModel?: string;
}

export function ChatFeed({
  messages,
  sessionStatus,
  sessionTitle,
  sessionFolder,
  sessionModel
}: ChatFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sessionStatus]);

  const parseReasoningSteps = (reasoningText?: string): string[] => {
    if (!reasoningText) return [];
    return reasoningText
      .split('\n')
      .map(line => line.trim().replace(/^[-*•#\d.]+\s*/, ''))
      .filter(line => line.length > 5)
      .slice(0, 5);
  };

  const formatMarkdownContent = (text: string): string => {
    if (!text) return '';
    let formatted = text.replace(/\|\s*\|(?=[-\w\s])/g, '|\n|');
    formatted = formatted.replace(/([^\n])\n(\|.+?\|\n\|[-:\s|]+?\|)/g, '$1\n\n$2');
    return formatted;
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-4xl mx-auto w-full">
      {/* Session Resume / Context Header Banner */}
      {sessionTitle && (
        <div className="p-3 bg-[#161b22] border border-[#30363d] rounded-2xl flex items-center justify-between text-xs shadow-sm mb-2">
          <div className="flex items-center gap-2.5 truncate flex-1 pr-2">
            <div className="h-8 w-8 rounded-xl bg-[#58a6ff]/15 flex items-center justify-center text-sm flex-shrink-0 text-[#58a6ff]">
              🚀
            </div>
            <div className="truncate">
              <div className="font-semibold text-white text-xs truncate">{sessionTitle}</div>
              <div className="text-[11px] text-gray-400 font-mono truncate mt-0.5">
                📁 {sessionFolder || 'D:\\Project'} • 🤖 {sessionModel?.split('/').pop() || 'AI Model'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Tiếp tục phiên này</span>
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 py-20">
          <p className="text-base font-medium text-gray-300">Phiên làm việc mới</p>
          <p className="text-xs text-gray-400 mt-1">Gửi yêu cầu bên dưới để bắt đầu điều khiển Agent trên máy local</p>
        </div>
      ) : (
        messages.map((m) => {
          const isUser = m.role === 'user';
          const steps = parseReasoningSteps(m.reasoning);

          return (
            <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                  isUser
                    ? 'bg-[#1f6feb] text-white rounded-br-none'
                    : 'bg-[#161b22] border border-[#30363d] text-gray-200 rounded-bl-none shadow-sm'
                }`}
              >
                {/* Reasoning / Thought process if available */}
                {m.reasoning && (
                  <div className="mb-3 pb-2 border-b border-[#30363d]/60">
                    <ThoughtLine
                      label="Thinking process"
                      doneLabel="Thought process"
                      working={false}
                      fontSize={13}
                      steps={steps.length > 0 ? steps : [m.reasoning.slice(0, 100) + '...']}
                      color="#8b949e"
                      glyphColor="#58a6ff"
                    />
                  </div>
                )}

                {/* Tool calls as CallChips */}
                {m.tool_calls && m.tool_calls.length > 0 && (
                  <div className="mb-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {m.tool_calls.map((tc, idx) => {
                        const iconType =
                          tc.name === 'execute_command'
                            ? 'terminal'
                            : tc.name === 'search_code'
                            ? 'search'
                            : tc.name === 'edit_file'
                            ? 'edit'
                            : 'file';

                        const chipStatus =
                          tc.status === 'completed'
                            ? 'done'
                            : tc.status === 'failed' || tc.status === 'rejected'
                            ? 'error'
                            : 'running';

                        const argDisplay = tc.command || tc.args?.path || tc.args?.command || tc.name;

                        return (
                          <CallChip
                            key={idx}
                            name={tc.name}
                            icon={iconType}
                            argument={argDisplay}
                            status={chipStatus}
                            surfaceColor="#0d1117"
                            color="#c9d1d9"
                          />
                        );
                      })}
                    </div>

                    {/* Detailed cards if command or diff exists */}
                    {m.tool_calls.map((tc, idx) => (
                      <React.Fragment key={`detail-${idx}`}>
                        {tc.name === 'execute_command' && (
                          <TerminalCard command={tc.command || tc.args?.command} output={tc.result} status={tc.status} />
                        )}
                        {tc.diff && <DiffCard diffText={tc.diff} filePath={tc.args?.path} />}
                      </React.Fragment>
                    ))}
                  </div>
                )}

                {/* Main Content with GFM & Table support */}
                {m.content && (
                  <div className="prose prose-invert prose-xs max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({ node, ...props }) => (
                          <div className="overflow-x-auto my-3 rounded-xl border border-[#30363d] bg-[#0d1117]/80">
                            <table className="w-full text-left text-xs border-collapse" {...props} />
                          </div>
                        ),
                        th: ({ node, ...props }) => (
                          <th className="bg-[#1c2128] text-white font-semibold p-2.5 border-b border-[#30363d]" {...props} />
                        ),
                        td: ({ node, ...props }) => (
                          <td className="p-2.5 border-b border-[#30363d]/50 text-gray-300" {...props} />
                        )
                      }}
                    >
                      {formatMarkdownContent(m.content)}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}

      {sessionStatus === 'running' && (
        <div className="p-3 rounded-xl bg-[#161b22] border border-[#30363d]/70 max-w-[85%]">
          <ThoughtLine
            label="Agent đang phân tích và thực thi trên máy local..."
            working={true}
            fontSize={13}
            color="#58a6ff"
            glyphColor="#58a6ff"
          />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
