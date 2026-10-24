-- Bảng quản lý thiết bị Local (Windows PC)
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline', -- 'online' | 'offline'
    working_directory TEXT,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng quản lý các phiên làm việc (Sessions)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'New Session',
    model TEXT NOT NULL DEFAULT 'anthropic/claude-3.5-sonnet',
    system_prompt TEXT,
    status TEXT NOT NULL DEFAULT 'idle', -- 'idle' | 'running' | 'waiting_approval'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng lịch sử tin nhắn & hành động (Messages)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, -- 'user' | 'assistant' | 'tool' | 'system'
    content TEXT NOT NULL DEFAULT '',
    tool_calls JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Supabase Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE devices;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
