#!/usr/bin/env python3
"""Poll the ntfy.sh suggestions topic, log new suggestions, email a receipt, and
kick off implement.sh when there is new work and no run is in progress.
Runs from cron every 10 minutes. State lives in suggestions/state.json and inbox.jsonl."""
import json, os, subprocess, sys, time, urllib.request, fcntl
ROOT = os.path.dirname(os.path.abspath(__file__))
TOPIC = open(os.path.join(ROOT, 'topic')).read().strip()
STATE = os.path.join(ROOT, 'state.json'); INBOX = os.path.join(ROOT, 'inbox.jsonl'); LOCK = os.path.join(ROOT, 'run.lock')
KP = 'kons.f.pilz@gmail.com'
state = json.load(open(STATE)) if os.path.exists(STATE) else {'since': 'all', 'seen': []}
url = f"https://ntfy.sh/{TOPIC}/json?poll=1&since={state['since']}"
try:
    raw = urllib.request.urlopen(url, timeout=30).read().decode()
except Exception as e:
    print(time.strftime('%F %T'), 'poll failed', e); sys.exit(0)
new = []
for line in raw.splitlines():
    if not line.strip(): continue
    m = json.loads(line)
    if m.get('event') != 'message' or m['id'] in state['seen']: continue
    text = (m.get('message') or '').strip()[:600]
    if not text: continue
    entry = {'id': m['id'], 'time': m['time'], 'title': (m.get('title') or '')[:120], 'text': text, 'status': 'new'}
    new.append(entry); state['seen'].append(m['id']); state['since'] = m['id']
if new:
    with open(INBOX, 'a') as f:
        for e in new: f.write(json.dumps(e, ensure_ascii=False) + '\n')
    body = "New suggestion(s) for Abyss Racer arrived. The dev agent will start on them within ~10 minutes and email you when they are live.\n\n" + "\n\n".join(f"- {e['text']}" + (f"\n  (from: {e['title']})" if e['title'] else '') for e in new)
    try: subprocess.run([sys.executable, os.path.join(ROOT, 'gmail_send.py'), KP, f"Abyss Racer: {len(new)} new suggestion(s) received"], input=body.encode(), check=True, timeout=60)
    except Exception as ex: print('receipt email failed', ex)
    print(time.strftime('%F %T'), 'logged', len(new), 'new suggestion(s)')
state['seen'] = state['seen'][-500:]
json.dump(state, open(STATE, 'w'))
# Launch implementation if there is pending work and nothing is running.
pending = [json.loads(l) for l in open(INBOX)] if os.path.exists(INBOX) else []
pending = [e for e in pending if e['status'] == 'new']
def run_in_progress():
    """implement.sh holds an flock on run.lock while running; the file itself persists."""
    if not os.path.exists(LOCK): return False
    try:
        fh = open(LOCK, 'a'); fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB); fcntl.flock(fh, fcntl.LOCK_UN); fh.close(); return False
    except OSError:
        return True
if pending and not run_in_progress():
    print(time.strftime('%F %T'), 'starting implement.sh for', len(pending), 'suggestion(s)')
    subprocess.Popen(['/bin/bash', os.path.join(ROOT, 'implement.sh')], stdout=open(os.path.join(ROOT, 'implement.log'), 'a'), stderr=subprocess.STDOUT, start_new_session=True)
elif pending:
    print(time.strftime('%F %T'), 'run in progress; waiting')
