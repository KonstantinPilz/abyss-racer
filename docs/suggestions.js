(function () {
  'use strict';
  const AR = window.AR;
  AR.initSuggestions = function ({ openDialog, context }) {
    const button = document.getElementById('title-suggestions');
    const c = AR.CONFIG, topic = c && c.suggestionsNtfyTopic, maxLength = (c && c.suggestionsMaxLength) || 600;
    if (!topic || !/^[A-Za-z0-9_-]{6,64}$/.test(topic)) return;
    const endpoint = new URL('https://ntfy.sh/' + topic);
    button.hidden = false;
    let last = -Infinity, sending = false;
    const remaining = () => Math.max(0, Math.ceil((last + 20000 - Date.now()) / 1000));
    button.addEventListener('click', () => {
      openDialog('<div class="eyebrow">HELP SHAPE THE NEXT DIVE</div><h2 id="dialog-heading">Suggestions</h2><form id="suggestions-form"><label for="suggestions-text">What should we add or fix?</label><textarea id="suggestions-text" name="suggestion" maxlength="600" required placeholder="Your idea, bug, or wish for the next dive…"></textarea><label for="suggestions-name">Name (optional)</label><input id="suggestions-name" maxlength="80" autocomplete="off" placeholder="How should we call you?"><button id="suggestions-submit" class="button primary" type="submit">Submit ↗</button><p id="suggestions-status" role="status"></p></form>');
      const form = document.getElementById('suggestions-form'), status = document.getElementById('suggestions-status'), submit = document.getElementById('suggestions-submit');
      form.onsubmit = async e => {
        e.preventDefault();
        if (sending || remaining()) { status.textContent = 'Please wait ' + (remaining() || 1) + ' seconds before sending another suggestion.'; return; }
        const text = document.getElementById('suggestions-text').value.trim(); if (!text) { document.getElementById('suggestions-text').focus(); return; }
        const name = document.getElementById('suggestions-name').value.trim().slice(0, 80);
        const ctx = 'mode=' + context() + '; version=' + AR.VERSION + '; viewport=' + innerWidth + 'x' + innerHeight + '; userAgent=' + navigator.userAgent;
        const body = text.slice(0, maxLength) + '\n\n[' + ctx + ']';
        const headers = { 'Title': name || 'Anonymous diver', 'Tags': 'bulb', 'Content-Type': 'text/plain' };
        sending = true; last = Date.now(); submit.disabled = true; status.textContent = 'Sending…';
        try {
          const res = await fetch(endpoint.href, { method: 'POST', headers, body }); if (!res.ok) throw new Error('ntfy ' + res.status);
          status.textContent = 'Thanks! Sent to the dev agent.'; form.reset();
        } catch (_) { status.textContent = 'Couldn’t send. Check your internet connection, then try again.'; }
        finally { sending = false; submit.disabled = false; }
      };
      if (remaining()) status.textContent = 'Please wait ' + remaining() + ' seconds before sending another suggestion.';
      document.getElementById('suggestions-text').focus();
    });
  };
})();
