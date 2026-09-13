'use strict';
// Deployment-specific settings. The suggestions box posts to a public ntfy.sh topic
// that a watcher on Konstantin's server polls every 10 minutes; a dev agent then
// implements the suggestions and emails a summary.
window.AR = window.AR || {};
AR.CONFIG = { suggestionsNtfyTopic: 'abyss-racer-ideas-mhgk6gy9go', suggestionsMaxLength: 600 };
