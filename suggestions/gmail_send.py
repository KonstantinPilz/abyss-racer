#!/usr/bin/env python3
"""Send an email from konstantinsclaude@gmail.com via the Gmail API (direct OAuth)."""
import json, sys, base64, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
CRED = "/home/ubuntu/.google_workspace_mcp/credentials/konstantinsclaude@gmail.com.json"

def token():
    cred = json.load(open(CRED))
    exp = cred.get('expiry')
    try:
        e = datetime.fromisoformat(exp.replace('Z', '+00:00'))
        if e.tzinfo is None: e = e.replace(tzinfo=timezone.utc)
        if e - datetime.now(timezone.utc) > timedelta(minutes=3): return cred['token']
    except Exception: pass
    data = urllib.parse.urlencode({'client_id': cred['client_id'], 'client_secret': cred['client_secret'], 'refresh_token': cred['refresh_token'], 'grant_type': 'refresh_token'}).encode()
    r = json.load(urllib.request.urlopen(urllib.request.Request('https://oauth2.googleapis.com/token', data=data)))
    cred['token'] = r['access_token']
    cred['expiry'] = (datetime.now(timezone.utc) + timedelta(seconds=r.get('expires_in', 3600))).strftime('%Y-%m-%dT%H:%M:%SZ')
    json.dump(cred, open(CRED, 'w'))
    return cred['token']

def send(to, subject, body):
    msg = MIMEText(body, 'plain', 'utf-8'); msg['To'] = to; msg['From'] = 'konstantinsclaude@gmail.com'; msg['Subject'] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    req = urllib.request.Request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', data=json.dumps({'raw': raw}).encode(), headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))

if __name__ == '__main__':
    to, subject = sys.argv[1], sys.argv[2]; body = sys.stdin.read()
    print(send(to, subject, body)['id'])
