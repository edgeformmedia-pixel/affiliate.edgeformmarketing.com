// In-browser stand-in for the CRM's affiliate API, following CONTRACT.md §4 exactly.
// Only used when the page runs with ?mock=1. State persists in localStorage so added videos stick.
(function () {
  const DB_KEY = 'efa_mock_db_v2';
  const SESSION_TOKEN = 'mock-session';
  const LOGIN_TOKEN = 'mock-token';
  const DAY = 86400000;

  const iso = (ms) => new Date(ms).toISOString();
  const date = (ms) => iso(ms).slice(0, 10);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  function seed() {
    const t = Date.now();
    const creator = {
      id: 'creator-mock', name: 'Jordan Rivera', email: 'jordan@example.com', phone: null,
      instagram: 'jordanrivera', tiktok: 'jordanrivera', youtube: null, country: 'US',
      payout_method: 'paypal', payout_details_last4: 'j•••@example.com', tax_form_received: true
    };
    const campaigns = [
      {
        id: 'camp-ulio', name: 'Ulio Summer Launch', status: 'active', start_date: date(t - 40 * DAY), end_date: date(t + 50 * DAY),
        platforms_allowed: ['tiktok', 'instagram'], default_cpm_rate_cents: 2500, currency: 'USD',
        max_payout_per_video_cents: 50000, max_payout_per_affiliate_cents: null, total_budget_cents: null,
        view_tracking_window_days: 30, min_views_to_qualify: 1000, requires_video_approval: true,
        brief: 'Show how you use Ulio in your daily routine. Hook in the first 2 seconds, mention the summer launch, and tag @ulio in the caption. Keep it under 60 seconds.'
      },
      {
        id: 'camp-fit', name: 'Edgeform Fitness Drop', status: 'active', start_date: date(t - 12 * DAY), end_date: null,
        platforms_allowed: ['tiktok', 'instagram', 'youtube'], default_cpm_rate_cents: 1500, currency: 'USD',
        max_payout_per_video_cents: null, max_payout_per_affiliate_cents: 200000, total_budget_cents: null,
        view_tracking_window_days: 30, min_views_to_qualify: null, requires_video_approval: false,
        brief: 'Film a workout featuring the new drop. Any format works: GRWM, gym vlog, or a quick try-on.'
      },
      {
        id: 'camp-spring', name: 'Spring Creator Push', status: 'ended', start_date: date(t - 120 * DAY), end_date: date(t - 60 * DAY),
        platforms_allowed: ['tiktok'], default_cpm_rate_cents: 2000, currency: 'USD',
        max_payout_per_video_cents: null, max_payout_per_affiliate_cents: null, total_budget_cents: null,
        view_tracking_window_days: 30, min_views_to_qualify: null, requires_video_approval: true,
        brief: 'Spring collection unboxing.'
      }
    ];
    const assignments = [
      { campaign_id: 'camp-ulio', status: 'active', cpm_rate_override_cents: null },
      { campaign_id: 'camp-fit', status: 'active', cpm_rate_override_cents: 1800 },
      { campaign_id: 'camp-spring', status: 'active', cpm_rate_override_cents: null }
    ];
    const video = (campaign_id, platform, pid, caption, status, submittedDaysAgo, views, extra = {}) => {
      const submitted = t - submittedDaysAgo * DAY;
      const trackingEnds = submitted + 30 * DAY;
      const locked = status === 'locked';
      return {
        id: uid(), campaign_id, platform, platform_video_id: pid,
        submitted_url: canonical(platform, pid, 'jordanrivera'), canonical_url: canonical(platform, pid, 'jordanrivera'),
        thumbnail_url: null, caption, posted_at: iso(submitted - 3600000), status, rejection_reason: null,
        submitted_at: iso(submitted), tracking_ends_at: iso(trackingEnds), locked_at: locked ? iso(trackingEnds) : null,
        latest_view_count: views, billable_views: locked ? views : 0, earned_cents: 0,
        last_fetched_at: status === 'approved' || locked ? iso(Math.min(t - 2 * 3600000, trackingEnds)) : null,
        ...extra
      };
    };
    const videos = [
      video('camp-ulio', 'tiktok', '7412345678901234567', 'my morning routine but make it ulio ☀️', 'locked', 38, 184300),
      video('camp-ulio', 'instagram', 'C9xYz12AbCd', 'summer launch unboxing', 'approved', 9, 62750),
      video('camp-ulio', 'tiktok', '7419876543210987654', 'ulio in 30 seconds', 'pending_review', 1, 0),
      video('camp-ulio', 'tiktok', '7411111111111111111', 'reposted clip', 'rejected', 20, 0, { rejection_reason: "Missing the @ulio tag in the caption." }),
      video('camp-fit', 'youtube', 'dQw4w9WgXcQ', 'Leg day in the new drop', 'approved', 5, 23980),
      video('camp-fit', 'tiktok', '7422222222222222222', 'gym fit check', 'approved', 2, 8410),
      video('camp-spring', 'tiktok', '7400000000000000001', 'spring haul', 'locked', 90, 97200)
    ];
    const springVideo = videos[videos.length - 1];
    const payouts = [
      {
        id: uid(), period_start: date(t - 70 * DAY), period_end: date(t - 40 * DAY), amount_cents: 0, currency: 'USD',
        status: 'paid', payment_method: 'paypal', payment_reference: 'PP-8H2K19XQ', paid_at: iso(t - 35 * DAY),
        line_items: [{ video_id: springVideo.id, campaign_id: 'camp-spring' }]
      }
    ];
    return { creator, campaigns, assignments, videos, payouts, sessions: [] };
  }

  function canonical(platform, id, handle) {
    if (platform === 'tiktok') return `https://www.tiktok.com/@${handle || 'creator'}/video/${id}`;
    if (platform === 'instagram') return `https://www.instagram.com/reel/${id}/`;
    return `https://www.youtube.com/shorts/${id}`;
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
      if (saved) return saved;
    } catch {}
    const db = seed();
    save(db);
    return db;
  }

  function save(db) { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {} }

  // --- Formulas (CONTRACT.md §3) ---
  function rateFor(db, campaign) {
    const a = db.assignments.find(x => x.campaign_id === campaign.id);
    return a && a.cpm_rate_override_cents != null ? a.cpm_rate_override_cents : campaign.default_cpm_rate_cents;
  }

  function recompute(db) {
    for (const campaign of db.campaigns) {
      const rate = rateFor(db, campaign);
      let creatorTotal = 0;
      const vids = db.videos.filter(v => v.campaign_id === campaign.id).sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
      for (const v of vids) {
        if (v.status !== 'approved' && v.status !== 'locked') { v.earned_cents = 0; continue; }
        const views = v.status === 'locked' ? v.billable_views : v.latest_view_count;
        if (campaign.min_views_to_qualify && views < campaign.min_views_to_qualify) { v.earned_cents = 0; continue; }
        let cents = Math.floor(views * rate / 1000);
        if (campaign.max_payout_per_video_cents != null) cents = Math.min(cents, campaign.max_payout_per_video_cents);
        if (campaign.max_payout_per_affiliate_cents != null) cents = Math.max(0, Math.min(cents, campaign.max_payout_per_affiliate_cents - creatorTotal));
        creatorTotal += cents;
        v.earned_cents = cents;
      }
    }
    for (const p of db.payouts) {
      p.line_items = p.line_items.map(li => {
        const v = db.videos.find(x => x.id === li.video_id);
        const c = db.campaigns.find(x => x.id === li.campaign_id);
        return {
          video_id: li.video_id, campaign_id: li.campaign_id, campaign_name: c ? c.name : null,
          canonical_url: v ? v.canonical_url : null, billable_views: v ? v.billable_views : 0,
          cpm_rate_cents: c ? rateFor(db, c) : 0, amount_cents: v ? v.earned_cents : 0
        };
      });
      p.amount_cents = p.line_items.reduce((s, li) => s + li.amount_cents, 0);
    }
  }

  function totals(db, campaignId) {
    const vids = db.videos.filter(v => !campaignId || v.campaign_id === campaignId);
    const earned = vids.filter(v => v.status === 'locked').reduce((s, v) => s + v.earned_cents, 0);
    const pending = vids.filter(v => v.status === 'approved').reduce((s, v) => s + v.earned_cents, 0);
    const paid = db.payouts.filter(p => p.status === 'paid')
      .flatMap(p => p.line_items).filter(li => !campaignId || li.campaign_id === campaignId)
      .reduce((s, li) => s + li.amount_cents, 0);
    return { earned_cents: earned, pending_cents: pending, paid_cents: paid, owed_cents: earned - paid };
  }

  // --- Shapes ---
  const videoShape = (v) => ({
    id: v.id, campaign_id: v.campaign_id, submitted_url: v.submitted_url, canonical_url: v.canonical_url, platform: v.platform,
    thumbnail_url: v.thumbnail_url, caption: v.caption, posted_at: v.posted_at, status: v.status, rejection_reason: v.rejection_reason,
    submitted_at: v.submitted_at, tracking_ends_at: v.tracking_ends_at, locked_at: v.locked_at, latest_view_count: v.latest_view_count,
    billable_views: v.billable_views, earned_cents: v.earned_cents, last_fetched_at: v.last_fetched_at
  });

  function summary(db, c) {
    const a = db.assignments.find(x => x.campaign_id === c.id);
    const vids = db.videos.filter(v => v.campaign_id === c.id);
    const t = totals(db, c.id);
    return {
      id: c.id, name: c.name, status: c.status, start_date: c.start_date, end_date: c.end_date,
      platforms_allowed: c.platforms_allowed, cpm_rate_cents: rateFor(db, c), currency: c.currency,
      assignment_status: a.status, video_count: vids.length,
      total_views: vids.filter(v => v.status === 'approved' || v.status === 'locked').reduce((s, v) => s + (v.status === 'locked' ? v.billable_views : v.latest_view_count), 0),
      earned_cents: t.earned_cents, pending_cents: t.pending_cents
    };
  }

  const detail = (db, c) => ({
    ...summary(db, c), brief: c.brief, view_tracking_window_days: c.view_tracking_window_days,
    min_views_to_qualify: c.min_views_to_qualify, max_payout_per_video_cents: c.max_payout_per_video_cents,
    requires_video_approval: c.requires_video_approval
  });

  // --- URL parsing (the real server also follows short links) ---
  function parseVideoUrl(raw) {
    let url;
    try { url = new URL(String(raw || '').trim()); } catch { return { error: 'invalid_url' }; }
    const host = url.hostname.replace(/^www\.|^m\./, '');
    const path = url.pathname;
    let m;
    if (host.endsWith('tiktok.com')) {
      if ((m = path.match(/\/video\/(\d+)/))) return { platform: 'tiktok', id: m[1] };
      if (host.startsWith('vm.') || host.startsWith('vt.') || path.startsWith('/t/')) return { platform: 'tiktok', id: 'short-' + path.replace(/\W/g, '') };
      return { error: 'invalid_url' };
    }
    if (host === 'instagram.com') {
      if ((m = path.match(/\/(?:reel|reels|p|tv)\/([\w-]+)/))) return { platform: 'instagram', id: m[1] };
      return { error: 'invalid_url' };
    }
    if (host === 'youtu.be') {
      if ((m = path.match(/^\/([\w-]{6,})/))) return { platform: 'youtube', id: m[1] };
      return { error: 'invalid_url' };
    }
    if (host.endsWith('youtube.com')) {
      if ((m = path.match(/\/shorts\/([\w-]+)/))) return { platform: 'youtube', id: m[1] };
      if (url.searchParams.get('v')) return { platform: 'youtube', id: url.searchParams.get('v') };
      return { error: 'invalid_url' };
    }
    if (!/^https?:$/.test(url.protocol)) return { error: 'invalid_url' };
    return { error: 'unsupported_platform' };
  }

  // --- Router ---
  const ok = (body = {}, status = 200) => ({ status, body: { ok: true, ...body } });
  const fail = (status, code, error) => ({ status, body: { ok: false, error, code } });

  const routes = [
    ['POST', /^\/auth\/magic-link$/, (db, body) => {
      if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return fail(400, 'validation_error', 'Enter a valid email address.');
      return ok();
    }, true],
    ['POST', /^\/auth\/verify$/, (db, body) => {
      if (body.token !== LOGIN_TOKEN) return fail(400, 'invalid_token', 'This sign-in link is invalid or has expired.');
      return ok({ session_token: SESSION_TOKEN, expires_at: iso(Date.now() + 30 * DAY), creator: db.creator });
    }, true],
    ['POST', /^\/auth\/logout$/, () => ok(), true],
    ['GET', /^\/me$/, (db) => ok({ creator: db.creator })],
    ['PATCH', /^\/me$/, (db, body) => {
      for (const key of ['name', 'phone', 'instagram', 'tiktok', 'youtube', 'country', 'payout_method']) {
        if (key in body) db.creator[key] = body[key] === '' ? null : body[key];
      }
      if (body.payout_details) {
        const d = String(body.payout_details).trim();
        const at = d.indexOf('@');
        db.creator.payout_details_last4 = at > 0 ? d[0] + '•••' + d.slice(at) : d.replace(/\s/g, '').slice(-4);
      }
      return ok({ creator: db.creator });
    }],
    ['GET', /^\/campaigns$/, (db) => ok({
      data: db.campaigns.filter(c => c.status !== 'draft' && db.assignments.some(a => a.campaign_id === c.id && a.status !== 'removed')).map(c => summary(db, c))
    })],
    ['GET', /^\/campaigns\/([^/]+)$/, (db, body, [id]) => {
      const c = db.campaigns.find(x => x.id === id);
      return c ? ok({ campaign: detail(db, c) }) : fail(404, 'not_found', 'Campaign not found.');
    }],
    ['GET', /^\/campaigns\/([^/]+)\/videos$/, (db, body, [id]) => {
      if (!db.campaigns.some(x => x.id === id)) return fail(404, 'not_found', 'Campaign not found.');
      return ok({ data: db.videos.filter(v => v.campaign_id === id).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)).map(videoShape) });
    }],
    ['POST', /^\/campaigns\/([^/]+)\/videos$/, (db, body, [id]) => {
      const c = db.campaigns.find(x => x.id === id);
      if (!c) return fail(404, 'not_found', 'Campaign not found.');
      if (!db.assignments.some(a => a.campaign_id === id && a.status !== 'removed')) return fail(403, 'not_assigned', "You're not part of this campaign.");
      if (c.status !== 'active') return fail(409, 'campaign_not_active', "This campaign isn't accepting videos right now.");
      const parsed = parseVideoUrl(body.url);
      if (parsed.error === 'invalid_url') return fail(400, 'invalid_url', "That doesn't look like a video link.");
      if (parsed.error) return fail(400, 'unsupported_platform', 'Only TikTok, Instagram and YouTube videos can be tracked.');
      if (!c.platforms_allowed.includes(parsed.platform)) return fail(400, 'platform_not_allowed', 'This campaign does not accept videos from that platform.');
      if (db.videos.some(v => v.platform === parsed.platform && v.platform_video_id === parsed.id)) return fail(409, 'duplicate_video', 'This video has already been submitted.');
      const t = Date.now();
      const v = {
        id: uid(), campaign_id: id, platform: parsed.platform, platform_video_id: parsed.id,
        submitted_url: String(body.url).trim(), canonical_url: canonical(parsed.platform, parsed.id, db.creator[parsed.platform]),
        thumbnail_url: null, caption: null, posted_at: null,
        status: c.requires_video_approval ? 'pending_review' : 'approved', rejection_reason: null,
        submitted_at: iso(t), tracking_ends_at: iso(t + c.view_tracking_window_days * DAY), locked_at: null,
        latest_view_count: 0, billable_views: 0, earned_cents: 0, last_fetched_at: null
      };
      db.videos.push(v);
      recompute(db);
      return ok({ video: videoShape(v) }, 201);
    }],
    ['DELETE', /^\/videos\/([^/]+)$/, (db, body, [id]) => {
      const i = db.videos.findIndex(v => v.id === id);
      if (i < 0) return fail(404, 'not_found', 'Video not found.');
      if (db.videos[i].status !== 'pending_review') return fail(409, 'not_deletable', 'Only videos waiting for review can be removed.');
      db.videos.splice(i, 1);
      return ok();
    }],
    ['GET', /^\/connections$/, () => ok({ data: [] })],
    ['POST', /^\/connections\/([^/]+)\/start$/, () => fail(501, 'not_available', 'Connecting accounts is coming soon.')],
    ['DELETE', /^\/connections\/([^/]+)$/, () => ok()],
    ['GET', /^\/earnings$/, (db) => ok({
      earnings: {
        currency: 'USD', ...totals(db),
        by_campaign: db.campaigns.map(c => ({ campaign_id: c.id, campaign_name: c.name, ...totals(db, c.id) }))
      }
    })],
    ['GET', /^\/payouts$/, (db) => ok({
      data: [...db.payouts].sort((a, b) => b.period_end.localeCompare(a.period_end)).map(({ id, period_start, period_end, amount_cents, currency, status, payment_method, payment_reference, paid_at, line_items }) =>
        ({ id, period_start, period_end, amount_cents, currency, status, payment_method, payment_reference, paid_at, line_items }))
    })]
  ];

  async function handle(method, path, body, token) {
    await new Promise(r => setTimeout(r, 180));
    const db = load();
    recompute(db);
    for (const [m, pattern, handler, isPublic] of routes) {
      const match = m === method && path.match(pattern);
      if (!match) continue;
      if (!isPublic && token !== SESSION_TOKEN) return fail(401, 'unauthorized', 'Please sign in again.');
      const result = handler(db, body || {}, match.slice(1).map(decodeURIComponent));
      save(db);
      return JSON.parse(JSON.stringify(result));
    }
    return fail(404, 'not_found', 'Not found.');
  }

  function reset() { try { localStorage.removeItem(DB_KEY); } catch {} }

  window.MockApi = { handle, reset, LOGIN_TOKEN };
})();
