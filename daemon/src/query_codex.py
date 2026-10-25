import sqlite3
import json
import sys
import os
import re

sys.stdout.reconfigure(encoding='utf-8')

def clean_title(raw_title, default="Untitled Session"):
    if not raw_title:
        return default
    t = raw_title.strip()
    if '"title":"' in t:
        m = re.search(r'"title":"([^"]+)"', t)
        if m and m.group(1):
            t = m.group(1)
    if '## My request:' in t:
        parts = t.split('## My request:')
        t = parts[-1].strip()

    t = re.sub(r'^[#\s]+', '', t)
    t = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', t)
    t = re.sub(r'\[@[^\]]+\]', '', t)
    t = re.sub(r'plugin://[^\s\)]+', '', t)
    t = ' '.join(t.split())
    if len(t) > 65:
        t = t[:62] + '...'
    return t or default

state_db = os.path.expanduser('~/.codex/state_5.sqlite')
hist_db = os.path.expanduser('~/.codex/thread_history_1.sqlite')

if not os.path.exists(state_db) or not os.path.exists(hist_db):
    print('[]')
    sys.exit(0)

con_state = sqlite3.connect(state_db)
cur_state = con_state.cursor()
cur_state.execute('SELECT id, title, cwd, model FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT 60;')
threads = cur_state.fetchall()
con_state.close()

con_hist = sqlite3.connect(hist_db)
cur_hist = con_hist.cursor()

result = []
for tid, raw_title, raw_cwd, model in threads:
    cwd = raw_cwd or 'D:\\Project'
    if cwd.startswith('\\\\?\\'):
        cwd = cwd[4:]
    cwd = cwd.rstrip('\\')

    cur_hist.execute('SELECT item_type, item_json FROM thread_items WHERE thread_id = ? ORDER BY rollout_ordinal DESC LIMIT 50;', (tid,))
    items = cur_hist.fetchall()
    items.reverse()

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
                    turns.append({'role': 'user', 'content': content[:8000], 'tool_calls': []})
            elif itype == 'agentMessage':
                text = data.get('text', '').strip()
                if text or pending_tools:
                    turns.append({'role': 'assistant', 'content': (text or 'Đã thực hiện xong tác vụ.')[:12000], 'tool_calls': pending_tools})
                    pending_tools = []
            elif itype == 'commandExecution':
                cmd = data.get('command', '')
                out = data.get('aggregatedOutput', '')
                status = 'completed' if data.get('status') == 'completed' else 'failed'
                pending_tools.append({'name': 'execute_command', 'command': cmd, 'result': (out or '')[:400], 'status': status})
        except:
            pass

    if turns:
        title = clean_title(raw_title, "Codex Session")
        result.append({
            'sourceId': tid,
            'title': f'[Codex] {title}',
            'cwd': cwd,
            'model': model or 'cx/gpt-6.1-sol',
            'turns': turns[-25:]
        })

con_hist.close()
print(json.dumps(result, ensure_ascii=False))
