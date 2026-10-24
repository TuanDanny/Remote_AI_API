import sqlite3
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
con = sqlite3.connect('C:/Users/tuand/.codex/state_5.sqlite')
cur = con.cursor()
cur.execute('SELECT id, title, cwd, model, first_user_message FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT 50;')
rows = []
for r in cur.fetchall():
    raw_cwd = r[2] or 'D:\\Project'
    if raw_cwd.startswith('\\\\?\\'):
        clean_cwd = raw_cwd[4:]
    else:
        clean_cwd = raw_cwd
    rows.append({
        'id': r[0],
        'title': r[1],
        'cwd': clean_cwd,
        'model': r[3],
        'first_message': r[4]
    })
print(json.dumps(rows, ensure_ascii=False))
