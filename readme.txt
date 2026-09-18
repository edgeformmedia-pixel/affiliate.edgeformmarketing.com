Edgeform Affiliates portal (affiliate.edgeformmarketing.com)

Static site: plain HTML/CSS/JS, no build step. Talks to the CRM Worker's /api/affiliate/v1 (see CONTRACT.md).
- config.js      API_BASE, the only thing to change when the CRM API goes live
- api.js         fetch client + session (localStorage)
- mock-api.js    sample-data stand-in for the API; add ?mock=1 to any URL (?mock=0 to turn off)
- ui.js          formatting, header, error copy
- Pages: index (login), verify (magic link), dashboard, campaign, payouts, settings

Run locally: npx http-server -p 5500 -c-1  → http://localhost:5500/?mock=1
