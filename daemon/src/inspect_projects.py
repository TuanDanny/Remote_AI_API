import sqlite3
import json
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

con_state = sqlite3.connect('C:/Users/tuand/.codex/state_5.sqlite')
cur_state = con_state.cursor()
cur_state.execute('SELECT id, title, cwd, model FROM threads WHERE archived = 0 ORDER BY updated_at DESC;')
threads = cur_state.fetchall()
con_state.close()

con_hist = sqlite3.connect('C:/Users/tuand/.codex/thread_history_1.sqlite')
cur_hist = con_hist.cursor()

print(f'Total active threads in Codex: {len(threads)}')
by_project = {}
for tid, title, raw_cwd, model in threads:
    cwd = raw_cwd or 'D:\\Project'
    if cwd.startswith('\\\\?\\'):
        cwd = cwd[4:]
    cwd = cwd.rstrip('\\')
    proj = os.path.basename(cwd) or cwd
    cur_hist.execute('SELECT count(*) FROM thread_items WHERE thread_id = ?;', (tid,))
    items_count = cur_hist.fetchone()[0]
    by_project.setdefault(proj, []).append({
        'id': tid,
        'title': (title or 'Untitled')[:40],
        'cwd': cwd,
        'items': items_count
    })

con_hist.close()

for p, list_t in sorted(by_project.items(), key=lambda x: -len(x[1])):
    print(f'📁 Project [{p}] ({len(list_t)} threads):')
    for t in list_t[:4]:
        print(f'   - {t["title"]} ({t["items"]} items, {t["cwd"]})')
