export type DeviceStatus = 'online' | 'offline';

export interface Device {
  id: string;
  name: string;
  status: DeviceStatus;
  working_directory?: string;
  last_heartbeat: string;
  created_at: string;
}

export type SessionStatus = 'idle' | 'running' | 'waiting_approval';

export interface Session {
  id: string;
  device_id: string;
  title: string;
  model: string;
  system_prompt?: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  status: 'pending' | 'waiting_approval' | 'approved' | 'running' | 'completed' | 'rejected' | 'failed';
  result?: string;
  diff?: string;
  command?: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  created_at: string;
}
