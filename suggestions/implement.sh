#!/bin/bash
# Implement all 'new' suggestions with GPT-6 (codex), gate on the test suites, push, email Konstantin.
set -u
ROOT=/home/ubuntu/projects/abyss-racer; S=$ROOT/suggestions; cd $ROOT || exit 1
exec 9>$S/run.lock; flock -n 9 || { echo "already running"; exit 0; }
export PATH=/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin
KP=kons.f.pilz@gmail.com; TS=$(date +%Y%m%d-%H%M)
python3 - <<'PY' > $S/current.json
import json; rows=[json.loads(l) for l in open('/home/ubuntu/projects/abyss-racer/suggestions/inbox.jsonl')]
print(json.dumps([r for r in rows if r['status']=='new']))
PY
python3 - <<'PY' > $S/BRIEF_$TS.md
import json
rows=json.load(open('/home/ubuntu/projects/abyss-racer/suggestions/current.json'))
tpl=open('/home/ubuntu/projects/abyss-racer/suggestions/BRIEF_TEMPLATE.md').read()
items="\n".join(f"{i+1}. {r['text']}" + (f"  (from {r['title']})" if r.get('title') else '') for i,r in enumerate(rows))
print(tpl.replace('{{SUGGESTIONS}}', items))
PY
echo "$(date '+%F %T') run $TS: $(python3 -c "import json;print(len(json.load(open('$S/current.json'))))") suggestion(s)"
if [ -n "$(git status --porcelain)" ]; then echo "$(date '+%F %T') working tree is dirty (someone is editing); skipping this tick"; git status --short | head -5; exit 0; fi
timeout 6000 codex exec -m gpt-6-astra -s workspace-write --skip-git-repo-check \
  -c sandbox_workspace_write.network_access=false -C $ROOT "$(cat $S/BRIEF_$TS.md)" </dev/null 2>&1 | sed 's/\x1b\[[0-9;]*m//g' > $S/codex_$TS.log
SUMMARY="(no summary written)"; [ -f SUGGESTION_DONE.md ] && SUMMARY=$(cat SUGGESTION_DONE.md)
# Gate 1: only allowed paths changed
BAD=$(git status --porcelain | awk '{print $2}' | grep -vE '^(docs/|tests/|README.md|STATUS.md|SUGGESTION_DONE.md)' || true)
BAD2=$(git status --porcelain docs/config.js docs/index.html | grep -c 'config.js' || true)
# Gate 2: syntax + test suites (serial)
FAIL=""
for f in docs/*.js; do node --check "$f" 2>/dev/null || FAIL="$FAIL syntax:$f"; done
grep -q 'name="robots" content="noindex, nofollow"' docs/index.html || FAIL="$FAIL noindex-missing"
for t in docs/selftest.js tests/progression.test.js tests/*.test.cjs; do
  [ -f "$t" ] || continue
  if ! timeout 900 node "$t" > $S/test_$TS.log 2>&1; then FAIL="$FAIL $t"; fi
done
if [ -n "$BAD" ] || [ "$BAD2" != "0" ] || [ -n "$FAIL" ]; then
  echo "$(date '+%F %T') FAILED gates: bad-paths=[$BAD] config-touched=$BAD2 tests=[$FAIL]"
  git checkout -q -- . ; git clean -fdq docs tests; rm -f SUGGESTION_DONE.md
  python3 - "$S" "$TS" <<'PY'
import json,sys; S,TS=sys.argv[1],sys.argv[2]
rows=[json.loads(l) for l in open(S+'/inbox.jsonl')]
for r in rows:
    if r['status']=='new': r['status']='failed'; r['run']=TS
open(S+'/inbox.jsonl','w').write(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
PY
  printf "The dev agent tried to implement the latest suggestion(s) but the change did not pass the quality gates, so nothing was published.\n\nGate results: bad paths=[%s] config touched=%s failing tests=[%s]\n\nAgent summary:\n%s\n\nLogs: %s\n" "$BAD" "$BAD2" "$FAIL" "$SUMMARY" "$S/codex_$TS.log" | python3 $S/gmail_send.py $KP "Abyss Racer: suggestion attempt failed quality gates"
  exit 1
fi
rm -f SUGGESTION_DONE.md
git add -A docs tests README.md STATUS.md
git -c user.name="Konstantin Pilz" commit -q -m "Suggestion box: $(python3 -c "import json;print('; '.join(r['text'][:60] for r in json.load(open('$S/current.json'))))")

Co-Authored-By: GPT-6 Astra via codex <noreply@openai.com>" || { echo "nothing to commit"; }
git push -q origin main 2>&1 | tail -1
SHA=$(git rev-parse --short HEAD)
for i in $(seq 1 30); do sleep 10; curl -s "https://konstantinpilz.github.io/abyss-racer/data.js" | grep -q "$(grep -o "AR.VERSION = '[^']*'" docs/data.js | head -1 | cut -d"'" -f2)" && break; done
python3 - "$S" "$TS" <<'PY'
import json,sys; S,TS=sys.argv[1],sys.argv[2]
rows=[json.loads(l) for l in open(S+'/inbox.jsonl')]
for r in rows:
    if r['status']=='new': r['status']='done'; r['run']=TS
open(S+'/inbox.jsonl','w').write(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
PY
printf "Your suggestion(s) are live at https://konstantinpilz.github.io/abyss-racer/ (hard-refresh once).\n\nSuggestions handled:\n%s\n\nWhat the dev agent (GPT-6 via codex) changed:\n%s\n\nCommit %s. All test suites passed before publishing.\n" "$(python3 -c "import json;print('\n'.join('- '+r['text'] for r in json.load(open('$S/current.json'))))")" "$SUMMARY" "$SHA" | python3 $S/gmail_send.py $KP "Abyss Racer: suggestion(s) implemented and live"
echo "$(date '+%F %T') run $TS published $SHA"
