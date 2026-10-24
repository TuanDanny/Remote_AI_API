import sqlite3
import json
import os
import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')

def load_env():
    env = {}
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env

_env = load_env()
SUPABASE_URL = os.environ.get('SUPABASE_URL', _env.get('SUPABASE_URL', 'https://duvwmgrustephydbskao.supabase.co'))
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', _env.get('SUPABASE_KEY', ''))
DEVICE_ID = os.environ.get('DEVICE_ID', _env.get('DEVICE_ID', 'win11-main'))

def clean_title(raw_title, default="Untitled Session"):
    if not raw_title:
        return default
    t = raw_title.strip()

    if "## My request:" in t:
        parts = t.split("## My request:")
        t = parts[-1].strip()

    t = re.sub(r'^[#\s]+', '', t)
    t = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', t)
    t = re.sub(r'\[@[^\]]+\]', '', t)
    t = re.sub(r'plugin://[^\s\)]+', '', t)
    t = ' '.join(t.split())
    if len(t) > 65:
        t = t[:62] + '...'
    return t or default

def get_project_name(cwd):
    if not cwd:
        return "General"
    norm = cwd.replace('\\', '/').rstrip('/')
    base = os.path.basename(norm)
    if not base or base == 'Project' or ':' in base:
        return "General"
    return base

def supabase_request(endpoint, method="GET", body=None):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        },
        method=method
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode('utf-8'))

def extract_codex_sessions():
    state_db = os.path.expanduser('~/.codex/state_5.sqlite')
    hist_db = os.path.expanduser('~/.codex/thread_history_1.sqlite')
    if not os.path.exists(state_db) or not os.path.exists(hist_db):
        return []

    con_state = sqlite3.connect(state_db)
    cur_state = con_state.cursor()
    cur_state.execute('SELECT id, title, cwd, model FROM threads WHERE archived = 0 ORDER BY updated_at DESC;')
    threads = cur_state.fetchall()
    con_state.close()

    con_hist = sqlite3.connect(hist_db)
    cur_hist = con_hist.cursor()

    sessions = []
    for tid, raw_title, raw_cwd, model in threads:
        cwd = raw_cwd or 'D:\\Project'
        if cwd.startswith('\\\\?\\'):
            cwd = cwd[4:]
        cwd = cwd.rstrip('\\')

        cur_hist.execute('SELECT item_type, item_json FROM thread_items WHERE thread_id = ? ORDER BY rollout_ordinal ASC;', (tid,))
        items = cur_hist.fetchall()

        turns = []
        pending_tools = []

        for itype, ijson in items:
            try:
                data = json.loads(ijson)
                if itype == 'userMessage':
                    content = data.get('content', '')
                    if isinstance(content, list):
                        content = '\n'.join(c.get('text', '') for c in content if isinstance(c, dict))
                    content = content.strip()
                    if content and not content.startswith('<send_user_message_question_reply>'):
                        turns.append({'role': 'user', 'content': content, 'tool_calls': []})
                elif itype == 'agentMessage':
                    text = data.get('text', '').strip()
                    if text or pending_tools:
                        turns.append({
                            'role': 'assistant',
                            'content': text or 'Đã thực hiện các lệnh trên máy.',
                            'tool_calls': pending_tools
                        })
                        pending_tools = []
                elif itype == 'commandExecution':
                    cmd = data.get('command', '')
                    out = data.get('aggregatedOutput', '')
                    status = 'completed' if data.get('status') == 'completed' else 'failed'
                    pending_tools.append({
                        'name': 'execute_command',
                        'command': cmd,
                        'result': (out or '')[:500],
                        'status': status
                    })
            except:
                pass

        if pending_tools and turns and turns[-1]['role'] == 'assistant':
            turns[-1]['tool_calls'].extend(pending_tools)
        elif pending_tools:
            turns.append({
                'role': 'assistant',
                'content': 'Đã thực hiện các lệnh trên máy.',
                'tool_calls': pending_tools
            })

        # Skip completely empty threads
        if not turns:
            continue

        title = clean_title(raw_title, "Codex Session")
        sessions.append({
            'source_id': tid,
            'title': title,
            'cwd': cwd,
            'project': get_project_name(cwd),
            'source': 'codex',
            'model': model or 'cx/gpt-6.1-sol',
            'turns': turns
        })

    con_hist.close()
    return sessions

def extract_claude_sessions():
    claude_projects = os.path.expanduser('~/.claude/projects')
    if not os.path.exists(claude_projects):
        return []

    sessions = []
    for pdir in os.listdir(claude_projects):
        pdir_path = os.path.join(claude_projects, pdir)
        if not os.path.isdir(pdir_path):
            continue

        for fname in os.listdir(pdir_path):
            if not fname.endswith('.jsonl'):
                continue
            filePath = os.path.join(pdir_path, fname)
            try:
                raw_messages = []
                detected_cwd = ''
                first_prompt = ''
                current_assistant = None

                with open(filePath, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            obj = json.loads(line)
                            if obj.get('cwd') and not detected_cwd:
                                detected_cwd = obj['cwd']

                            if obj.get('type') == 'user' and obj.get('message', {}).get('content'):
                                if current_assistant:
                                    raw_messages.push(current_assistant)
                                    current_assistant = None
                                content = obj['message']['content']
                                text = ''
                                if isinstance(content, str):
                                    text = content
                                elif isinstance(content, list):
                                    text = '\n'.join(c.get('text', '') for c in content if isinstance(c, dict))
                                clean = re.sub(r'<system-reminder>[\s\S]*?</system-reminder>', '', text).strip()
                                # Skip internal prompt injection
                                if clean and not clean.startswith('Base directory for this skill:') and not clean.startswith('[SYSTEM NOTIFICATION'):
                                    if not first_prompt:
                                        first_prompt = clean[:50]
                                    raw_messages.append({'role': 'user', 'content': clean, 'tool_calls': []})

                            elif obj.get('type') == 'assistant' and obj.get('message', {}).get('content'):
                                if not current_assistant:
                                    current_assistant = {'role': 'assistant', 'content': '', 'tool_calls': []}
                                content = obj['message']['content']
                                if isinstance(content, list):
                                    for item in content:
                                        if item.get('type') == 'text':
                                            current_assistant['content'] += item.get('text', '')
                                        elif item.get('type') == 'tool_use':
                                            current_assistant['tool_calls'].append({
                                                'name': item.get('name'),
                                                'args': item.get('input', {})
                                            })
                                elif isinstance(content, str):
                                    current_assistant['content'] += content
                        except:
                            pass

                if current_assistant:
                    raw_messages.append(current_assistant)

                # Merge consecutive assistant messages
                turns = []
                for m in raw_messages:
                    if turns and turns[-1]['role'] == 'assistant' and m['role'] == 'assistant':
                        if m.get('content'):
                            turns[-1]['content'] += ('\n\n' if turns[-1]['content'] else '') + m['content']
                        if m.get('tool_calls'):
                            turns[-1]['tool_calls'].extend(m['tool_calls'])
                    else:
                        turns.append(m)

                if turns:
                    cwd = detected_cwd or 'D:\\Project\\RemoteAI'
                    title = clean_title(first_prompt, "Claude Session")
                    sessions.append({
                        'source_id': fname.replace('.jsonl', ''),
                        'title': title,
                        'cwd': cwd,
                        'project': get_project_name(cwd),
                        'source': 'claude',
                        'model': 'ag/claude-opus-4-6-thinking',
                        'turns': turns
                    })
            except Exception as e:
                print(f"Error parsing Claude session {filePath}: {e}")

    return sessions

def run_sync():
    print("1. Extracting Codex sessions...")
    codex_sessions = extract_codex_sessions()
    print(f"Found {len(codex_sessions)} Codex sessions with turns.")

    print("2. Extracting Claude sessions...")
    claude_sessions = extract_claude_sessions()
    print(f"Found {len(claude_sessions)} Claude sessions with turns.")

    all_sessions = codex_sessions + claude_sessions
    print(f"Total valid sessions to sync: {len(all_sessions)}")

    # Wipe existing database sessions & messages to start with clean state
    print("3. Resetting existing Supabase sessions & messages...")
    try:
        supabase_request("messages", method="DELETE")
        supabase_request("sessions", method="DELETE")
        print("Existing messages and sessions cleaned successfully.")
    except Exception as e:
        print("Reset error (safe to ignore if empty):", e)

    # Insert clean sessions and recent turns
    print("4. Inserting clean structured sessions and turns...")
    for idx, s in enumerate(all_sessions):
        meta = {
            "cwd": s["cwd"],
            "project": s["project"],
            "source": s["source"],
            "isExternal": True
        }

        # Create session row
        session_row = {
            "device_id": DEVICE_ID,
            "title": f"[{s['source'].capitalize()}] {s['title']}",
            "model": s["model"],
            "system_prompt": json.dumps(meta, ensure_ascii=False),
            "status": "idle"
        }

        try:
            inserted = supabase_request("sessions", method="POST", body=session_row)
            if not inserted:
                continue
            session_id = inserted[0]["id"]

            # Insert recent 20 turns as a single batch request
            recent_turns = s["turns"][-20:]
            batch_messages = [{
                "session_id": session_id,
                "role": t["role"],
                "content": t["content"],
                "tool_calls": t["tool_calls"]
            } for t in recent_turns]
            if batch_messages:
                supabase_request("messages", method="POST", body=batch_messages)

            if (idx + 1) % 5 == 0 or (idx + 1) == len(all_sessions):
                print(f"  Synced {idx + 1}/{len(all_sessions)}: {s['title'][:40]} (Project: {s['project']}, {len(recent_turns)} turns)")
        except Exception as e:
            print(f"Error syncing {s['title']}: {e}")

    print("\n✅ SYNC COMPLETE: All sessions structured and populated!")

if __name__ == "__main__":
    run_sync()
