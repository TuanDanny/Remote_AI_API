# Design Specification: RemoteAI - 24/7 Web Dashboard & Local Agent Daemon

**Date:** 2026-10-24  
**Author:** tuand & Claude Sonnet 4.5  
**Status:** Approved for Implementation  
**Path:** Architectural  

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem
Người dùng hiện đang sử dụng **API Key** thông qua các **API Router / Proxy** (như OpenRouter, OneAPI, NewAPI hoặc custom base URL của Anthropic/OpenAI) thay vì tài khoản có gói cước chính chủ (Claude Pro/Team, ChatGPT Plus). Do đó, các nền tảng chính thức không cung cấp tính năng **Remote Control** hoặc đồng bộ trực tiếp lên web di động.

### 1.2 Objective
Xây dựng một hệ thống **Remote AI** mã nguồn mở, tối giản và tự lưu trữ (self-hosted):
1. **Web Dashboard:** Triển khai trên **Vercel** hoạt động 24/7, giao diện tối giản (tương tự Claude Code / Codex web remote), mở được trên mọi thiết bị (Mobile/Tablet/PC), hiển thị lịch sử phiên làm việc, log streaming, diff code và trạng thái máy tính.
2. **Local Daemon:** Một tiến trình chạy nền nhẹ trên máy tính Windows cá nhân, kết nối ra ngoài (outbound) tới kênh Realtime Cloud, nhận lệnh từ Web và sử dụng API Router để tự động hóa: đọc/ghi file, chạy lệnh terminal và stream kết quả về Web.
3. **Chi phí hạ tầng:** Hoàn toàn **$0** (tận dụng gói Free của Vercel và Supabase).

---

## 2. High-Level Architecture & Data Flow

```
                      ┌──────────────────────────────────────┐
                      │   User on Mobile / Tablet / Browser  │
                      └──────────────────────────────────────┘
                                          │ HTTPS / WSS
                                          ▼
                      ┌──────────────────────────────────────┐
                      │        Vercel Web Dashboard          │
                      │   - Next.js 15 (App Router)          │
                      │   - Tailwind CSS + Lucide Icons      │
                      │   - Passcode Protected (PIN)         │
                      └──────────────────────────────────────┘
                                          │
                  Read/Write (REST)       │ Realtime Events (WSS)
                                          ▼
                      ┌──────────────────────────────────────┐
                      │         Supabase Cloud (Free)        │
                      │   - PostgreSQL Database              │
                      │   - Realtime Broadcast & CDC         │
                      └──────────────────────────────────────┘
                                          ▲
                                          │ Outbound WSS (No Port-forwarding)
                                          ▼
                      ┌──────────────────────────────────────┐
                      │     Local Daemon (Windows PC)        │
                      │   - Node.js / TypeScript Runtime     │
                      │   - Heartbeat Ping (10s)             │
                      │   - Agent Execution Loop             │
                      └──────────────────┬───────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
                 ▼                                               ▼
   ┌───────────────────────────┐                   ┌───────────────────────────┐
   │    AI API Router/Proxy    │                   │   Local Windows System    │
   │  (OpenRouter/Claude/etc)  │                   │ - File System Read/Write  │
   │  - Streaming completions  │                   │ - PowerShell / Shell Cmds │
   │  - Tool calling protocol  │                   │ - Git Diff Generation     │
   └───────────────────────────┘                   └───────────────────────────┘
```

---

## 3. Database Schema (Supabase PostgreSQL)

### 3.1 DDL Schema

```sql
-- 1. Bảng quản lý thiết bị Local
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline', -- 'online' | 'offline'
    working_directory TEXT,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Bảng quản lý các phiên làm việc (Sessions)
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

-- 3. Bảng lịch sử tin nhắn & hành động (Messages)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, -- 'user' | 'assistant' | 'tool' | 'system'
    content TEXT NOT NULL DEFAULT '',
    tool_calls JSONB DEFAULT '[]'::jsonb, 
    -- tool_calls format: [{ id, name, args, status: 'pending'|'approved'|'running'|'completed'|'rejected', result, diff }]
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Kích hoạt Supabase Realtime cho các bảng
ALTER PUBLICATION supabase_realtime ADD TABLE devices;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
```

---

## 4. Local Daemon Specification

### 4.1 Technologies & Dependencies
* **Runtime:** Node.js (>= 18.x) + TypeScript (`tsx` runner).
* **Libraries:**
  * `@supabase/supabase-js`: Kết nối Realtime & thao tác DB.
  * `dotenv`: Quản lý biến môi trường local.
  * `diff`: Sinh Git-style unified diff cho các chỉnh sửa code.
  * `cross-spawn`: Thực thi command an toàn trên Windows.

### 4.2 Configuration (`.env` trên Local)
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-or-anon-key
DEVICE_ID=win11-tuand-main
DEVICE_NAME="Tuan Windows 11"

# AI Router Config
AI_ROUTER_BASE_URL=https://openrouter.ai/api/v1
AI_ROUTER_API_KEY=sk-or-v1-...
DEFAULT_MODEL=anthropic/claude-3.5-sonnet

# Security
ALLOWED_WORKSPACE_ROOT=D:\Project
AUTO_APPROVE_SAFE_COMMANDS=true
```

### 4.3 Agent Tools Specification
1. **`read_file(path)`**: Đọc nội dung file với kiểm tra giới hạn kích thước, trả về danh sách dòng kèm số thứ tự dòng.
2. **`write_file(path, content)`**: Tạo file mới hoặc ghi đè file hiện có.
3. **`edit_file(path, old_content, new_content)`**: Tìm đoạn văn bản cụ thể và thay thế; đồng thời tạo ra bản patch unified diff để lưu vào `tool_calls.diff`.
4. **`list_directory(path)`**: Quét danh sách file/folder trong phạm vi workspace.
5. **`execute_command(command, cwd)`**:
   * Thực thi lệnh trong PowerShell/Bash.
   * Streaming output vào DB (cập nhật trường `tool_calls.result`).
   * Hỗ trợ cờ `requires_approval`: Khi gặp các lệnh có khả năng phá hủy (như `git reset --hard`, `rm -rf`, `format`), Daemon chuyển trạng thái sang `waiting_approval` và chờ sự kiện phê duyệt từ Web.
6. **`search_code(pattern, path)`**: Tìm kiếm chuỗi/regex trong mã nguồn.

### 4.4 Heartbeat Service
* Daemon phát nhịp `heartbeat` mỗi 10 giây một lần vào bảng `devices`.
* Cập nhật `last_heartbeat = NOW()` và `status = 'online'`.
* Tự động bắt tín hiệu tắt máy (`SIGINT`, `SIGTERM`) để đổi `status = 'offline'`.

---

## 5. Web Dashboard Specification (Vercel)

### 5.1 Tech Stack
* **Framework:** Next.js 15 (App Router, React Server Components + Client Components).
* **Styling:** Tailwind CSS + shadcn/ui components (Radix UI primitives).
* **Realtime Client:** `@supabase/supabase-js` realtime listeners.
* **Markdown & Syntax Highlighting:** `react-markdown`, `shiki` hoặc `prism-react-renderer`.
* **Deployment:** Vercel (Edge/Serverless runtime, 24/7).

### 5.2 UI Components & Pages
1. **`PasscodeGate`**:
   * Kiểm tra mã PIN bí mật lưu trong `localStorage` trước khi cho phép vào dashboard.
   * Xác thực với biến môi trường `NEXT_PUBLIC_DASHBOARD_PIN`.
2. **`Sidebar`**:
   * Header: Logo RemoteAI + Chấm trạng thái kết nối máy tính (Online/Offline) + Thư mục làm việc hiện tại.
   * Nút `+ New Session`: Tạo nhanh phiên làm việc mới.
   * Danh sách Session: Nhóm theo Ngày (Hôm nay, Hôm qua, Tuần trước). Hỗ trợ đổi tên và xóa session.
3. **`ChatFeed`**:
   * Tin nhắn User: Khối thoại bên phải, gọn gàng.
   * Tin nhắn Assistant: Hỗ trợ markdown đầy đủ, render bảng, code block có nút Copy.
   * Khối `TerminalCard`: Terminal nền đen, hiển thị command đang chạy và log thời gian thực.
   * Khối `DiffCard`: Giao diện xem sự khác biệt dòng mã (Diff viewer) trực quan với màu xanh/đỏ.
   * Khối `ApprovalBanner`: Xuất hiện nổi bật khi có lệnh cần phê duyệt (`[ ✅ Approve ]` và `[ ❌ Reject ]`).
4. **`InputBox`**:
   * Textarea tự động giãn nở (Auto-resize).
   * Dropdown chọn Model (Claude 3.5 Sonnet, GPT-4o, v.v.).
   * Nút Dừng (Stop) khi đang trong luồng streaming.

---

## 6. Security & Operational Reliability

### 6.1 Path Traversal Prevention
* Mọi thao tác file từ Local Daemon bắt buộc phải kiểm tra:
  `resolvedPath.startsWith(ALLOWED_WORKSPACE_ROOT)`.
* Nghiêm cấm truy cập ra ngoài thư mục dự án được cấp quyền (tránh can thiệp vào `C:\Windows` hoặc ổ đĩa hệ thống).

### 6.2 Disconnection & Offline Handling
* Khi máy local tắt hoặc mất mạng:
  * Web hiển thị huy hiệu `🔴 PC Offline`.
  * Người dùng vẫn có thể xem toàn bộ lịch sử các session cũ 24/7 trên Vercel.
  * Nếu người dùng gửi tin nhắn mới khi máy đang Offline, tin nhắn sẽ được lưu ở trạng thái `queued`. Khi máy bật lại và Daemon kết nối, Daemon sẽ tự động nhận và tiếp tục xử lý.

---

## 7. Project Structure & Monorepo Layout

```
RemoteAI/
├── apps/
│   └── web/                   # Vercel Next.js Web Application
│       ├── app/
│       │   ├── page.tsx       # Main Dashboard (Chat + Sessions)
│       │   ├── layout.tsx
│       │   └── globals.css
│       ├── components/
│       │   ├── Sidebar.tsx
│       │   ├── ChatFeed.tsx
│       │   ├── TerminalCard.tsx
│       │   ├── DiffCard.tsx
│       │   └── ApprovalBanner.tsx
│       ├── lib/
│       │   └── supabase.ts
│       └── package.json
├── daemon/                    # Local Windows Background Service
│   ├── src/
│   │   ├── index.ts           # Daemon Entry & Supabase Realtime Listener
│   │   ├── agent.ts           # Agent Loop & AI Router Integration
│   │   ├── tools.ts           # Local File & Terminal Tool Executors
│   │   └── heartbeat.ts       # Online/Offline Status Reporter
│   ├── .env.example
│   ├── tsconfig.json
│   └── package.json
├── supabase/
│   └── schema.sql             # SQL Script khởi tạo Database
├── package.json               # Root Workspace package.json
└── README.md                  # Hướng dẫn Setup & Triển khai Vercel
```
