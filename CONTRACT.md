# Edgeform Affiliate System — Shared Contract (v3)

Source of truth for BOTH builds. An identical copy lives in both repos:
- **CRM agent** → `edgeform-crm` (Cloudflare Worker `edgeform-crm-api` + D1 `edgeform-crm` + static admin UI at crm.edgeformmarketing.com). Owns the database, admin UI, weekly view counting, earnings, payouts, and the affiliate API.
- **Portal agent** → `affiliate.edgeformmarketing.com` (static HTML/CSS/vanilla JS, same style as the CRM). Affiliate-facing UI only. Talks to the CRM Worker through the API in §4 and never touches D1.

**Rule:** nobody renames or removes a table, column, enum value, endpoint, or JSON key in this file without updating this file in BOTH repos first and telling the user. Adding things is fine.

**v3 change (this revision):** view counting is no longer automated. Every Sunday 10pm ET, Edgeform staff manually record each video's **new views since last week**, on every platform, reading the number straight off the platform in its own rounded/compact form (e.g. `184.3K`) — that rounded number is what pay is calculated from. There's no more fixed per-video tracking window: a video keeps earning every week for as long as its campaign is `active`, and locks with one final count the week the campaign stops being active. Automated polling (YouTube API, TikTok/Instagram OAuth or scraper) and the "Connect account" flow are dropped, not deferred. Payouts now run weekly and are sent externally (Remitly, Zelle, etc.); the CRM just logs that it happened. Who funds a campaign's payouts (Edgeform itself vs. the operation's client) is fixed once, at campaign creation — this is CRM-internal accounting and is never sent to the portal. **`edgeform-crm` needs this same update.**

---

## 0. Conventions (matched to the existing CRM)
| Thing | Rule |
|---|---|
| IDs | opaque `TEXT`. New rows: `crypto.randomUUID()`. Existing tables keep what they have. Never parse IDs. |
| DB columns | `snake_case` |
| JSON keys (affiliate API) | `snake_case` (the affiliate API is separate from the admin API, which keeps its own camelCase) |
| Timestamps | ISO 8601 UTC `TEXT` via `now()` in `worker/lib.js`, e.g. `2026-09-18T14:00:00.000Z` |
| Dates | `TEXT` `YYYY-MM-DD` |
| Booleans | D1: `INTEGER` 0/1. JSON: `true`/`false` |
| Arrays | D1: JSON `TEXT` (like `creators.niches`). JSON: real arrays |
| Money | integer **cents** everywhere (`cpm_rate_cents: 2500` = $25.00 per 1,000 views). Never `REAL`. |
| Currency | `"USD"` |
| Nullable | send `null`, never omit the key |
| Success | `{ "ok": true, ...payload }` |
| Error | HTTP status + `{ "ok": false, "error": "Human message.", "code": "machine_code" }` |
| Lists | `{ "ok": true, "data": [ ... ] }` (no pagination in v1) |

---

## 1. Enums (exact strings; enforce with `CHECK` in D1)
```
campaign_status:    draft | active | paused | ended
channel_type:       email | affiliate
platform:           tiktok | instagram | youtube
assignment_status:  invited | active | removed
video_status:       pending_review | approved | rejected | removed | locked
view_source:        manual   (api | oauth | scraper retired in v3 — may still exist on old rows, never written going forward)
payout_status:      pending | approved | paid | failed
payout_method:      paypal | wise | bank | remitly | zelle | manual
funded_by:          edgeform | client    (campaigns only; CRM-internal accounting, never sent to the portal)
flag_type:          handle_mismatch | video_unavailable | suspicious_spike   (fetch_failed retired — nothing auto-fetches anymore)
```

---

## 2. D1 tables (CRM agent writes the migrations: `0019_affiliate_campaigns.sql`, …)

### operations (existing, no changes)
Campaigns hang off operations. The Campaigns section only appears on operations where `type = 'marketing'`.

### creators (existing, only ADD columns)
Keep and reuse: `id, name, email, phone, phone_e164, instagram, tiktok, youtube, location, roster_status, created_at, updated_at`.
`instagram` / `tiktok` / `youtube` stay free text (handle or URL). Normalize when comparing (strip `@`, URL prefix, lowercase).

ADD:
| column | type | notes |
|---|---|---|
| payout_method | TEXT NULL | payout_method enum |
| payout_details_encrypted | TEXT NULL | AES-GCM with a new secret `AFFILIATE_ENCRYPTION_KEY` (same pattern as the OpenAI key in ENVIRONMENT.md). Never returned. |
| payout_details_last4 | TEXT NULL | safe to show. Bank: last 4 digits (`4821`). PayPal/Wise email: masked email (`j•••@gmail.com`). Manual: NULL |
| tax_form_received | INTEGER NOT NULL DEFAULT 0 | |
| country | TEXT NULL | ISO-2 |
| portal_last_login_at | TEXT NULL | |

Portal login key = `creators.email`, matched case-insensitively. `email` isn't unique today, so the CRM agent checks for duplicates before adding
`CREATE UNIQUE INDEX idx_creators_email ON creators(email COLLATE NOCASE) WHERE email <> ''`.

"Assigned to: Campaign A, Campaign B" on the Creators list is derived from `campaign_affiliates`. Don't store it as a field.

### campaigns
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| operation_id | TEXT NOT NULL → operations.id ON DELETE CASCADE | |
| name | TEXT NOT NULL | |
| brief | TEXT NOT NULL DEFAULT '' | shown to affiliates |
| status | TEXT NOT NULL DEFAULT 'draft' | campaign_status |
| start_date | TEXT NULL | |
| end_date | TEXT NULL | |
| platforms_allowed | TEXT NOT NULL DEFAULT '["tiktok","instagram","youtube"]' | JSON array of platform |
| default_cpm_rate_cents | INTEGER NOT NULL DEFAULT 0 | |
| currency | TEXT NOT NULL DEFAULT 'USD' | |
| max_payout_per_video_cents | INTEGER NULL | |
| max_payout_per_affiliate_cents | INTEGER NULL | |
| total_budget_cents | INTEGER NULL | |
| funded_by | TEXT NOT NULL DEFAULT 'edgeform' | funded_by enum. Set once at creation. CRM-internal, never sent to the portal. |
| view_tracking_window_days | INTEGER NOT NULL DEFAULT 30 | **Retired in v3, ignore.** No more fixed window — a video counts every week for as long as the campaign is `active`. |
| min_views_to_qualify | INTEGER NULL | Checked against a video's cumulative views at each weekly count, not per-week views |
| requires_video_approval | INTEGER NOT NULL DEFAULT 1 | |
| created_by | TEXT NULL → users.id | |
| created_at / updated_at | TEXT NOT NULL | |

### campaign_channels
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| campaign_id | TEXT NOT NULL → campaigns.id CASCADE | |
| type | TEXT NOT NULL | channel_type. UNIQUE(campaign_id, type) |
| created_at | TEXT NOT NULL | |
New campaigns get both channels. `email` is a placeholder tab with no logic yet.

### campaign_affiliates
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| campaign_id | TEXT NOT NULL → campaigns.id CASCADE | |
| creator_id | TEXT NOT NULL → creators.id CASCADE | UNIQUE(campaign_id, creator_id) |
| cpm_rate_override_cents | INTEGER NULL | NULL = use the campaign default |
| status | TEXT NOT NULL DEFAULT 'invited' | assignment_status |
| invited_at | TEXT NULL | set when the invite email goes out |
| joined_at | TEXT NULL | set on the creator's first portal login after being invited |
| created_at / updated_at | TEXT NOT NULL | |

`effective_cpm_rate_cents = COALESCE(cpm_rate_override_cents, campaigns.default_cpm_rate_cents)`

### ~~creator_platform_connections~~ — retired in v3
Was planned for a future OAuth-based auto-read of TikTok/Instagram views. Dropped for good now that counting is manual every week on every platform — there's nothing for a connected account to feed. Don't build this table.

### videos
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| campaign_affiliate_id | TEXT NOT NULL → campaign_affiliates.id CASCADE | |
| campaign_id | TEXT NOT NULL | copied here to make queries simpler |
| creator_id | TEXT NOT NULL | copied here to make queries simpler |
| submitted_url | TEXT NOT NULL | exactly what the affiliate pasted |
| platform | TEXT NOT NULL | detected server-side |
| platform_video_id | TEXT NOT NULL | UNIQUE(platform, platform_video_id) across ALL campaigns |
| canonical_url | TEXT NOT NULL | |
| thumbnail_url | TEXT NULL | |
| caption | TEXT NULL | |
| posted_at | TEXT NULL | |
| status | TEXT NOT NULL | video_status. Starts as `pending_review` if the campaign requires approval, otherwise `approved`. Moves to `locked` on the one final weekly count taken the week its campaign leaves `active` |
| rejection_reason | TEXT NULL | |
| submitted_at | TEXT NOT NULL | |
| approved_at | TEXT NULL | |
| approved_by | TEXT NULL → users.id | |
| ~~tracking_ends_at~~ | — | **Retired in v3.** No fixed end — counts weekly for as long as the campaign is `active` |
| locked_at | TEXT NULL | set to the Sunday of the campaign's final count |
| latest_view_count | INTEGER NOT NULL DEFAULT 0 | running cumulative total, incremented by `new_views` at each weekly count |
| billable_views | INTEGER NOT NULL DEFAULT 0 | always equal to `latest_view_count` (kept as a separate field for API stability; nothing "freezes" separately from the cumulative total anymore) |
| earned_cents | INTEGER NOT NULL DEFAULT 0 | running cumulative total, increased by that week's payout (after caps) at each weekly count |
| last_fetched_at | TEXT NULL | timestamp of the most recent weekly count entry |
| ~~next_fetch_at~~ / ~~consecutive_fetch_failures~~ | — | **Retired in v3.** No scheduled job anymore — counting happens every Sunday for every non-locked video on an active campaign |

### view_snapshots (append-only, never update or delete — now the weekly counting ledger)
`id TEXT PK, video_id TEXT NOT NULL → videos.id CASCADE, view_count INTEGER NOT NULL, new_views INTEGER NOT NULL, earned_cents INTEGER NOT NULL, like_count INTEGER NULL, comment_count INTEGER NULL, source TEXT NOT NULL (view_source), fetched_at TEXT NOT NULL, raw_response TEXT NULL (JSON), entered_by TEXT NULL → users.id, note TEXT NULL`
One row per video per Sunday count. `view_count` = cumulative total after this entry (matches `videos.latest_view_count` at that point). `new_views` = the delta staff entered that week, already in the platform's rounded/compact form. `earned_cents` = this video's payout for that week specifically, after caps — sums to `videos.earned_cents`.

### video_flags
`id TEXT PK, video_id TEXT NOT NULL → videos.id CASCADE, type TEXT NOT NULL (flag_type), details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, resolved_at TEXT NULL, resolved_by TEXT NULL → users.id`

### payouts
`id TEXT PK, creator_id TEXT NOT NULL → creators.id, period_start TEXT, period_end TEXT, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'pending' (payout_status), payment_method TEXT NULL (payout_method), payment_reference TEXT NULL, paid_at TEXT NULL, created_by TEXT NULL → users.id, created_at TEXT NOT NULL, updated_at TEXT NOT NULL`

### payout_line_items
`id TEXT PK, payout_id TEXT NOT NULL → payouts.id CASCADE, video_id TEXT NOT NULL → videos.id, campaign_id TEXT NOT NULL, billable_views INTEGER NOT NULL, cpm_rate_cents INTEGER NOT NULL, amount_cents INTEGER NOT NULL`
A video is paid at most once: UNIQUE(video_id).

### affiliate_login_tokens
`token_hash TEXT PK (sha256), creator_id TEXT NOT NULL → creators.id CASCADE, expires_at TEXT NOT NULL (15 min), used_at TEXT NULL, created_at TEXT NOT NULL`

### affiliate_sessions (kept separate from the CRM staff `sessions` table)
`token_hash TEXT PK (sha256), creator_id TEXT NOT NULL → creators.id CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL (30 days)`

### affiliate_audit_log
`id TEXT PK, actor_type TEXT NOT NULL ('user' | 'creator' | 'system'), actor_id TEXT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT NULL, after_json TEXT NULL, created_at TEXT NOT NULL`
Log: rate changes, manual view entries, approvals and rejections, payout status changes, and changes to payout details.

---

## 3. Formulas (only the CRM computes these; the portal just displays them)
```
earning_statuses = approved, locked       (everything else earns 0)
views            = videos.latest_view_count   (running cumulative — billable_views always mirrors it)
earned_cents     = videos.earned_cents         (running cumulative, built up week by week — see Weekly counting below)

earned_cents   (per creator) = Σ earned_cents of videos with status ∈ {approved, locked}
pending_cents                = same Σ, but for status = approved only — "earned so far, still actively counting" (already being paid weekly, not just an estimate)
paid_cents                   = Σ payouts.amount_cents where status = paid
owed_cents                   = earned_cents − paid_cents
```

### Weekly counting (manual, replaces automated polling — v3)
- **Every Sunday 10pm ET**, Edgeform staff record **new views since last week** for every video with status `approved` on a campaign that's `active`, on whatever platform it's on. The number entered is read straight off the platform in its own rounded/compact display (e.g. Instagram's `184.3K`) — that rounded number is used for the pay calculation, not a more precise one.
- Per video, per week:
  1. `new_views` = the staff-entered delta for that week.
  2. If `min_views_to_qualify` is set and `latest_view_count + new_views < min_views_to_qualify`, this week earns `0` (still record the snapshot; the view count still accumulates).
  3. `raw_cents = floor(new_views * effective_cpm_rate_cents / 1000)`.
  4. Cap against what's left of `max_payout_per_video_cents` for this video (`cap − earned_cents so far`), if set.
  5. Then cap against what's left of `max_payout_per_affiliate_cents` for this creator in the campaign, then `total_budget_cents` for the campaign — same "oldest videos fill first" ordering as before, applied to that week's allocation across videos.
  6. `videos.latest_view_count += new_views`; `videos.billable_views = videos.latest_view_count`; `videos.earned_cents += video_cents`; `videos.last_fetched_at = now`.
  7. Append a `view_snapshots` row: `new_views`, `view_count` (the new cumulative total), `earned_cents` (this week's amount), `source = 'manual'`, `entered_by`.
- **`paused` is a hold, not an end.** While a campaign is `paused`, its videos just don't get a weekly count — no new count, no earnings that week, nothing locks. Money already earned in prior weeks is unaffected and still flows through the normal weekly payout cycle regardless of campaign status. If the campaign goes back to `active`, counting resumes the next Sunday as if nothing happened.
- **Campaign ends:** the first Sunday count that falls on or after a campaign becomes `ended` (not `paused`) is that video's **final** count — same steps as above, then `status = 'locked'`, `locked_at = now`. No further counts happen for it, even if the campaign somehow reactivates.
- If the video is confirmed deleted or private, status → `removed` and a `video_unavailable` flag; never zero out earnings automatically.
- A `suspicious_spike` flag is still available for staff to raise manually if a week's jump looks implausible — no automatic trigger now that there's no continuous polling to compare against.

### Weekly payouts
- Shortly after each Sunday's counting finishes, one `payouts` row is created per **(creator, week, campaign's `funded_by`)** — a creator earning from both an Edgeform-funded and a client-funded campaign in the same week gets two separate payout records, since the money comes from two different places and each needs its own external reference.
- Payment itself happens outside the CRM (Remitly, Zelle, etc.); staff mark the payout `paid` with `payment_method` and `payment_reference` once it's sent. Funding-source accounting (incoming from clients, outgoing to affiliates) lives in the CRM's own ledger — out of scope for this contract and never exposed to the portal.

---

## 4. Affiliate API (the CRM Worker serves it; the portal calls it)
Base: `${API_URL}/api/affiliate/v1`, which is currently `https://edgeform-crm-api.edgeformmedia.workers.dev/api/affiliate/v1`
Auth: `Authorization: Bearer <session_token>` on everything except `/auth/*`. The creator is always taken from the session. The portal never sends a `creator_id`.
CORS: add `https://affiliate.edgeformmarketing.com` and `http://localhost:5500` to `ALLOWED_ORIGINS`.
Error codes shared by every endpoint: `unauthorized` (401), `not_found` (404), `validation_error` (400), `rate_limited` (429).

### Auth
| method | path | body | returns |
|---|---|---|---|
| POST | /auth/magic-link | `{ "email" }` | `{ "ok": true }`, whether or not the email exists. Only emails creators that have at least one `campaign_affiliates` row with status ≠ removed. Max 5 per email per hour. |
| POST | /auth/verify | `{ "token" }` | `{ "ok": true, "session_token", "expires_at", "creator": Creator }`. Error code `invalid_token`. Sets `joined_at` and `status = active` on that creator's `invited` assignments. |
| POST | /auth/logout | — | `{ "ok": true }` |

The magic-link email is sent through the existing mail code, from `MAIL_FROM`, and links to `https://affiliate.edgeformmarketing.com/verify.html?token=<raw token>`.
The invite email (sent when an admin adds an affiliate to a campaign) links to `https://affiliate.edgeformmarketing.com/`.

### Me
| GET | /me | → `{ ok, creator: Creator }` |
| PATCH | /me | any of `{ name, phone, instagram, tiktok, youtube, country, payout_method, payout_details }` → `{ ok, creator: Creator }`. `payout_details` is write-only. The server encrypts it and sets `payout_details_last4`. |

### Campaigns
| GET | /campaigns | → `{ ok, data: CampaignSummary[] }`: campaigns this creator is assigned to, where the assignment isn't `removed` and the campaign isn't `draft` |
| GET | /campaigns/:id | → `{ ok, campaign: CampaignDetail }` |

### Videos
| GET | /campaigns/:id/videos | → `{ ok, data: Video[] }`, newest first |
| POST | /campaigns/:id/videos | `{ "url" }` → `201 { ok, video: Video }` |
| DELETE | /videos/:id | only while `pending_review` → `{ ok: true }`. Otherwise `409` with code `not_deletable` |

POST error codes: `invalid_url`, `unsupported_platform`, `platform_not_allowed`, `duplicate_video`, `campaign_not_active`, `not_assigned`.
The server follows short links (vm.tiktok.com, youtu.be, instagram share links) before it reads the ID.

### ~~Platform connections~~ — retired in v3
No OAuth, no `/connections/*` endpoints. Views are counted manually every week on every platform (§3). If the settings page still shows anything about connected accounts, it should be removed.

### Earnings and payouts
| GET | /earnings | → `{ ok, earnings: Earnings }` |
| GET | /payouts | → `{ ok, data: Payout[] }`, newest first |

### Response shapes (every key is always present; missing values are `null`)
```jsonc
// Creator
{ "id", "name", "email", "phone", "instagram", "tiktok", "youtube", "country",
  "payout_method", "payout_details_last4", "tax_form_received" }

// CampaignSummary
{ "id", "name", "status", "start_date", "end_date", "platforms_allowed",
  "cpm_rate_cents",            // effective rate for THIS creator
  "currency", "assignment_status",
  "video_count", "total_views", "earned_cents", "pending_cents" }

// CampaignDetail = CampaignSummary plus
{ "brief", "min_views_to_qualify",
  "max_payout_per_video_cents", "requires_video_approval" }

// Video
{ "id", "campaign_id", "submitted_url", "canonical_url", "platform", "thumbnail_url", "caption",
  "posted_at", "status", "rejection_reason", "submitted_at", "locked_at",
  "latest_view_count", "billable_views", "earned_cents", "last_fetched_at" }

// Earnings
{ "currency", "earned_cents", "pending_cents", "paid_cents", "owed_cents",
  "by_campaign": [ { "campaign_id", "campaign_name", "earned_cents", "pending_cents", "paid_cents", "owed_cents" } ] }

// Payout
{ "id", "period_start", "period_end", "amount_cents", "currency", "status", "payment_method",
  "payment_reference", "paid_at",
  "line_items": [ { "video_id", "campaign_id", "campaign_name", "canonical_url", "billable_views", "cpm_rate_cents", "amount_cents" } ] }
```
Never sent to the portal: creator notes, `roster_status`, `payout_details_encrypted`, `raw_response`, flags, audit log, `campaigns.funded_by`, other creators' data.

---

## 5. Who builds what
| CRM agent (`edgeform-crm`) | Portal agent (`affiliate.edgeformmarketing.com`) |
|---|---|
| Migrations for §2 | Static site: `index.html` (login), `verify.html`, `dashboard.html`, `campaign.html?id=`, `payouts.html`, `settings.html` |
| Campaigns section on marketing operations (Email tab placeholder, Affiliate tab), incl. `funded_by` at creation | Magic-link login and session in localStorage |
| Add affiliate: choose from Creators, or create one inline (which adds them to Creators) + invite email | Campaign list and detail pages |
| "Assigned to" column and campaign filter on the Creators list | Add Video flow, with a clear message for every error code |
| `worker/affiliate.js` serving all of §4 | Video table: status, cumulative views, earnings, "last counted / next Sunday" note |
| URL parsing, short-link resolving, duplicate check | Earnings dashboard and payout history |
| Weekly manual view-count entry screen (every Sunday), earnings calculation + caps + locking on campaign end, flags | Settings: profile, payout method (no account connections) |
| Weekly payout batch generation per (creator, week, `funded_by`), payment methods incl. Remitly/Zelle, incoming/outgoing accounting ledger, CSV export, audit log | `mock-api.js` that follows §4 exactly, turned on with `?mock=1`, so the portal can be built before the CRM API is live |

**Sync point:** once the CRM's `/api/affiliate/v1` is deployed, the portal's `API_BASE` in `config.js` points at it and nothing else changes.
