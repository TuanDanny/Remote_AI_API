'use client';
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Message } from '../../../types';
import { TerminalCard } from './TerminalCard';
import { DiffCard } from './DiffCard';
import CallChip from './CallChip';
import ThoughtLine from './ThoughtLine';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Terminal, ChevronDown, Send, Sparkles, CornerDownLeft } from 'lucide-react';

interface ChatFeedProps {
  messages: Message[];
  sessionStatus: string;
  sessionTitle?: string;
  sessionFolder?: string;
  sessionModel?: string;
  onSendPrompt?: (text: string) => void;
}

const QUICK_SUGGESTIONS = [
  '📁 Liệt kê các file trong thư mục hiện tại',
  '🔍 Kiểm tra git status & branch',
  '⚙️ Chạy test kiểm thử tự động',
  '📝 Tóm tắt tiến độ phiên làm việc này'
];

function ToolCallsCollapsible({ toolCalls }: { toolCalls: any[] }) {
  const [open, setOpen] = useState(false);
  if (!toolCalls || toolCalls.length === 0) return null;

  const names = Array.from(new Set(toolCalls.map(t => t.name))).join(', ');

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[11px] text-gray-400 hover:text-gray-200 transition cursor-pointer select-none"
      >
        <Terminal className="h-3 w-3 text-[#58a6ff]" />
        <span>Đã dùng {toolCalls.length} công cụ ({names})</span>
        <ChevronDown className={`h-3 w-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 space-y-2 p-2.5 rounded-xl bg-[#0d1117]/90 border border-[#30363d]">
          <div className="flex flex-wrap gap-2">
            {toolCalls.map((tc, idx) => {
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
                  surfaceColor="#161b22"
                  color="#c9d1d9"
                />
              );
            })}
          </div>

          {toolCalls.map((tc, idx) => (
            <React.Fragment key={`detail-${idx}`}>
              {tc.name === 'execute_command' && (
                <TerminalCard command={tc.command || tc.args?.command} output={tc.result} status={tc.status} />
              )}
              {tc.diff && <DiffCard diffText={tc.diff} filePath={tc.args?.path} />}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatFeed({
  messages,
  sessionStatus,
  sessionTitle,
  sessionFolder,
  sessionModel,
  onSendPrompt
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
    // Fix collapsed markdown table rows where pipes were collapsed onto single lines
    let formatted = text.replace(/\|\s*\|(?=[-\w\s])/g, '|\n|');
    formatted = formatted.replace(/([^\n])\n(\|.+?\|\n\|[-:\s|]+?\|)/g, '$1\n\n$2');
    return formatted;
  };

  // Deduplicate consecutive identical messages & filter empty narration
  const displayMessages = useMemo(() => {
    const list: Message[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const prev = list[list.length - 1];
      if (prev && prev.role === m.role && prev.content.trim() === m.content.trim() && !m.tool_calls?.length) {
        continue;
      }
      list.push(m);
    }
    return list;
  }, [messages]);

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

      {displayMessages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 py-20">
          <p className="text-base font-medium text-gray-300">Phiên làm việc mới</p>
          <p className="text-xs text-gray-400 mt-1">Gửi yêu cầu bên dưới để bắt đầu điều khiển Agent trên máy local</p>
        </div>
      ) : (
        displayMessages.map((m) => {
          const isUser = m.role === 'user';
          const steps = parseReasoningSteps(m.reasoning);

          // If assistant message has NO content but has tool calls, render as clean inline trace
          if (!isUser && !m.content?.trim() && m.tool_calls && m.tool_calls.length > 0) {
            return (
              <div key={m.id} className="flex justify-start my-1 pl-2">
                <ToolCallsCollapsible toolCalls={m.tool_calls} />
              </div>
            );
          }

          return (
            <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                  isUser
                    ? 'bg-[#1f6feb] text-white rounded-br-none shadow-sm'
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

                {/* Collapsible Tool Calls above content */}
                {m.tool_calls && m.tool_calls.length > 0 && (
                  <ToolCallsCollapsible toolCalls={m.tool_calls} />
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

                {/* Clickable Action button for suggestion / action messages */}
                {!isUser && onSendPrompt && m.content && m.content.length < 150 && (m.content.startsWith('Để tôi') || m.content.startsWith('Tôi sẽ') || m.content.startsWith('Hãy') || m.content.startsWith('Bạn muốn')) && (
                  <div className="mt-2.5 pt-2 border-t border-[#30363d]/40 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onSendPrompt(m.content)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-[11px] text-[#58a6ff] hover:text-white border border-[#30363d] hover:border-[#58a6ff]/40 transition cursor-pointer active:scale-95 shadow-sm"
                      title="Bấm để gửi yêu cầu này"
                    >
                      <CornerDownLeft className="h-3 w-3" />
                      <span>Thực hiện ngay</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Quick Suggestions Row */}
      {sessionStatus !== 'running' && onSendPrompt && (
        <div className="pt-2 pb-1">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            <span className="text-[11px] text-gray-500 flex items-center gap-1 flex-shrink-0">
              <Sparkles className="h-3 w-3 text-amber-400" />
              <span>Gợi ý:</span>
            </span>
            {QUICK_SUGGESTIONS.map((sug, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onSendPrompt(sug)}
                className="flex-shrink-0 text-xs text-gray-300 hover:text-white bg-[#161b22] hover:bg-[#21262d] border border-[#30363d] hover:border-[#58a6ff]/60 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 shadow-sm active:scale-95 group"
                title="Bấm để gửi yêu cầu này"
              >
                <span>{sug}</span>
                <Send className="h-2.5 w-2.5 text-gray-500 group-hover:text-[#58a6ff] transition" />
              </button>
            ))}
          </div>
        </div>
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
