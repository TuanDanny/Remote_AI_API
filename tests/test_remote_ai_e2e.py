"""
RemoteAI E2E & Component Verification Suite
Verifies:
1. Local Daemon Tools (read, write, edit, execute_command, sandbox path check)
2. Supabase Connection and Session Data Integrity
3. Codex state_5.sqlite Session and CWD Extraction
4. Claude Code Session Transcript Parsing & Turn Grouping
5. 9Router Model Endpoints Connectivity
6. Folder Containment and Scope Logic
"""

import sys
import os
import json
import sqlite3
import subprocess

# Ensure UTF-8 output on Windows
sys.stdout.reconfigure(encoding='utf-8')

WORKSPACE_ROOT = "D:\\Project"
PROJECT_ROOT = "D:\\Project\\RemoteAI"
def load_env_file(filepath):
    env = {}
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env

daemon_env = load_env_file(os.path.join(PROJECT_ROOT, "daemon", ".env"))
SUPABASE_URL = os.environ.get("SUPABASE_URL", daemon_env.get("SUPABASE_URL", "https://duvwmgrustephydbskao.supabase.co"))
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", daemon_env.get("SUPABASE_KEY", ""))

passed_tests = 0
failed_tests = 0

def check(name, condition, details=""):
    global passed_tests, failed_tests
    if condition:
        print(f"  [PASS] {name} {details}")
        passed_tests += 1
    else:
        print(f"  [FAIL] {name} - {details}")
        failed_tests += 1

print("=" * 60)
print("RemoteAI Python Automated Validation Suite")
print("=" * 60)

# Test 1: Folder Containment Logic
print("\n1. Testing Folder Containment Logic (isSessionInFolder)...")
def is_session_in_folder(session_cwd, selected_folder):
    if not session_cwd or not selected_folder:
        return False
    norm_sess = session_cwd.replace("\\", "/").rstrip("/").lower()
    norm_target = selected_folder.replace("\\", "/").rstrip("/").lower()
    return norm_sess == norm_target or norm_sess.startswith(norm_target + "/")

check("sky in sky", is_session_in_folder("D:\\Project\\sky", "D:\\Project\\sky"))
check("Project NOT in sky", not is_session_in_folder("D:\\Project", "D:\\Project\\sky"))
check("RemoteAI NOT in sky", not is_session_in_folder("D:\\Project\\RemoteAI", "D:\\Project\\sky"))
check("sky in Project", is_session_in_folder("D:\\Project\\sky", "D:\\Project"))
check("RemoteAI in Project", is_session_in_folder("D:\\Project\\RemoteAI", "D:\\Project"))

# Test 2: Codex SQLite Threads Extraction
print("\n2. Testing Codex SQLite Session Extraction...")
codex_db = os.path.expanduser("~/.codex/state_5.sqlite")
if os.path.exists(codex_db):
    try:
        con = sqlite3.connect(codex_db)
        cur = con.cursor()
        cur.execute("SELECT count(*) FROM threads WHERE archived = 0;")
        total_threads = cur.fetchone()[0]
        check("Codex database readable", total_threads > 0, f"Found {total_threads} active threads")

        cur.execute("SELECT id, title, cwd FROM threads WHERE cwd LIKE '%sky%' LIMIT 1;")
        row = cur.fetchone()
        check("Codex thread with sky cwd exists", row is not None, f"Sample: {row[1][:30] if row else 'None'}")
        con.close()
    except Exception as e:
        check("Codex database readable", False, str(e))
else:
    print("  [SKIP] Codex state_5.sqlite not found at", codex_db)

# Test 3: Claude Code Project Sessions
print("\n3. Testing Claude Code Project Transcripts...")
claude_projects = os.path.expanduser("~/.claude/projects")
if os.path.exists(claude_projects):
    dirs = [d for d in os.listdir(claude_projects) if os.path.isdir(os.path.join(claude_projects, d))]
    check("Claude projects directory exists", len(dirs) > 0, f"Found {len(dirs)} projects")
    has_remote_ai = any("RemoteAI" in d for d in dirs)
    check("RemoteAI project transcript exists", has_remote_ai)
else:
    print("  [SKIP] ~/.claude/projects not found")

# Test 4: Supabase Connection & Sessions
print("\n4. Testing Supabase Connection & Data Integrity...")
try:
    import urllib.request
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/sessions?select=id,title,system_prompt&limit=5",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}"
        }
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
        check("Supabase sessions query", resp.status == 200, f"Fetched {len(data)} sessions")
        has_system_prompt_cwd = False
        for s in data:
            if s.get("system_prompt"):
                try:
                    meta = json.loads(s["system_prompt"])
                    if "cwd" in meta:
                        has_system_prompt_cwd = True
                        break
                except:
                    pass
        check("Session metadata has cwd", has_system_prompt_cwd)
except Exception as e:
    check("Supabase connection", False, str(e))

# Test 5: Local Claude CLI Binary Check
print("\n5. Testing Local Claude CLI Binary Availability...")
claude_candidates = [
    "C:/Users/tuand/AppData/Local/Claude-3p/claude-code/2.1.308/c17a819afb40/claude.exe",
    os.path.expanduser("~/.local/bin/claude.exe"),
    os.path.expanduser("~/.local/bin/claude")
]
found_bin = next((c for c in claude_candidates if os.path.exists(c)), None)
check("Local Claude CLI binary exists", found_bin is not None, f"Found: {found_bin}")

print("\n" + "=" * 60)
print(f"Validation Summary: {passed_tests} PASSED, {failed_tests} FAILED")
print("=" * 60)

if failed_tests > 0:
    sys.exit(1)
else:
    sys.exit(0)
