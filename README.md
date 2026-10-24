# RemoteAI: 24/7 Web Dashboard & Local Agent Daemon

Hệ thống điều khiển AI Agent từ xa chạy 24/7 trên Vercel dành cho người dùng dùng API Key / API Router (Claude, OpenAI, OpenRouter...).

RemoteAI cho phép bạn ra lệnh cho AI Agent thực thi lệnh terminal, đọc/ghi/chỉnh sửa file mã nguồn trực tiếp trên máy tính cá nhân (Windows 11) thông qua giao diện Web di động, bảo mật và đồng bộ thời gian thực qua Supabase.

---

## Kiến trúc hệ thống (Architecture)

```text
[Điện thoại / Laptop ở ngoài] (Vercel 24/7 Web UI + Passcode Gate)
              ▲
              │ Realtime & REST
              ▼
    [Supabase Database] (PostgreSQL + Realtime Channel)
              ▲
              │ Heartbeat & Task Sync
              ▼
   [Local Daemon trên Windows 11] (Tools Execution + AI Router)
```

---

## Hướng dẫn cài đặt và triển khai từng bước

### Bước 1: Khởi tạo Supabase Database (Miễn phí)

1. Đăng ký/Đăng nhập tài khoản miễn phí tại [supabase.com](https://supabase.com).
2. Tạo một project mới (ví dụ: `remote-ai`).
3. Trong dashboard của Supabase, điều hướng tới mục **SQL Editor**.
4. Mở file `supabase/schema.sql` trong dự án này, copy toàn bộ nội dung và dán vào SQL Editor, sau đó nhấn **Run**.
   - Thao tác này sẽ khởi tạo 3 bảng chính: `devices`, `sessions`, `messages` và bật tính năng **Realtime replication** cho các bảng.
5. Vào **Project Settings > API**, sao chép 2 thông số:
   - **Project URL** (dạng `https://xyzcompany.supabase.co`)
   - **anon / public key** (dùng cho Web Dashboard và Daemon)
   - *(Tùy chọn)* **service_role key** (nếu muốn toàn quyền truy cập từ Daemon).

---

### Bước 2: Triển khai Web Dashboard lên Vercel (24/7)

1. Đẩy mã nguồn dự án lên GitHub repository của bạn (Public hoặc Private).
2. Đăng nhập vào [vercel.com](https://vercel.com) và chọn **Add New > Project**, sau đó Import repository này.
3. Trong phần cấu hình dự án:
   - **Framework Preset**: Next.js
   - **Root Directory**: Nhấn Edit và chọn `apps/web`.
4. Mở rộng phần **Environment Variables** và cấu hình các biến sau:
   - `NEXT_PUBLIC_SUPABASE_URL`: Project URL từ Bước 1.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Anon public key từ Bước 1.
   - `NEXT_PUBLIC_DASHBOARD_PIN`: Mã PIN bảo vệ gồm 6 chữ số để khóa Dashboard (ví dụ: `123456`).
5. Nhấn **Deploy**. Sau khoảng 1 phút, bạn sẽ nhận được đường link truy cập dạng `https://remote-ai-xxx.vercel.app` hoạt động 24/7.

---

### Bước 3: Cấu hình và chạy Local Daemon trên máy tính Windows

1. Di chuyển vào thư mục `daemon`:
   ```bash
   cd daemon
   ```
2. Sao chép file cấu hình mẫu `.env.example` thành `.env`:
   ```bash
   cp .env.example .env
   ```
   *(hoặc trên CMD/PowerShell: `copy .env.example .env`)*
3. Mở file `daemon/.env` bằng trình soạn thảo và điền thông tin:
   ```env
   # Supabase Configuration
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-supabase-anon-or-service-key

   # Local Device Configuration
   DEVICE_ID=win11-main
   DEVICE_NAME="My Windows 11 PC"
   ALLOWED_WORKSPACE_ROOT=D:\Project

   # AI Router Configuration (OpenRouter, Claude API, OneAPI, OpenAI-compatible...)
   AI_ROUTER_BASE_URL=https://openrouter.ai/api/v1
   AI_ROUTER_API_KEY=sk-or-v1-your-key-here
   DEFAULT_MODEL=anthropic/claude-3.5-sonnet
   ```
4. Khởi chạy Daemon:
   - **Cách 1 (Khuyên dùng trên Windows)**: Nhấp đúp chuột vào file `daemon/start.bat`. Script sẽ tự động cài đặt `node_modules` nếu chưa có và khởi động `npm run dev`.
   - **Cách 2 (Bằng dòng lệnh)**:
     ```bash
     cd daemon
     npm install
     npm run dev
     ```
5. Khi màn hình console hiển thị:
   ```text
   [Daemon] Starting RemoteAI Local Daemon...
   [Heartbeat] Device registered: win11-main (online)
   🟢 RemoteAI Daemon is running and listening for commands.
   ```
   máy tính của bạn đã sẵn sàng nhận lệnh từ xa!

---

### Bước 4: Điều khiển máy tính từ xa qua Web

1. Mở trình duyệt trên điện thoại hoặc máy tính khác, truy cập vào link Vercel đã tạo ở Bước 2.
2. Nhập mã PIN bảo mật (`NEXT_PUBLIC_DASHBOARD_PIN`) để mở khóa Dashboard.
3. Kiểm tra trạng thái máy tính:
   - Chỉ báo góc trên Sidebar sẽ hiển thị **PC Online** (chấm xanh lá).
4. Sử dụng Dashboard:
   - **Tạo phiên mới**: Bấm **Tạo Phiên Mới** để bắt đầu một phiên làm việc độc lập.
   - **Chọn mô hình AI**: Lựa chọn giữa Claude 3.5 Sonnet, GPT-4o, DeepSeek V3...
   - **Gửi câu lệnh**: Nhập yêu cầu vào ô chat (ví dụ: *"Kiểm tra git status và tạo component Header"*).
   - **Xem kết quả Realtime**:
     - Xem phản hồi từng dòng qua stream.
     - Thẻ **TerminalCard**: Hiển thị lệnh shell đã chạy kèm trạng thái (đang chạy, hoàn thành, thất bại) và nút phê duyệt nếu cần.
     - Thẻ **DiffCard**: Hiển thị khác biệt mã nguồn (diff trực quan dạng split/unified) khi Agent chỉnh sửa file.
5. Khi tắt máy hoặc tắt Daemon, trạng thái trên Web sẽ tự động chuyển sang **PC Offline** sau 10 giây.
