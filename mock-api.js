// In-browser stand-in for the CRM's affiliate API, following CONTRACT.md §4 exactly (v3: weekly manual counting).
// Only used when the page runs with ?mock=1. State persists in localStorage so added videos stick.
(function () {
  const DB_KEY = 'efa_mock_db_v6';
  const SESSION_TOKEN = 'mock-session';
  const LOGIN_TOKEN = 'mock-token';
  const DAY = 86400000;
  const WEEK = 7 * DAY;

  const iso = (ms) => new Date(ms).toISOString();
  const date = (ms) => iso(ms).slice(0, 10);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  function seed() {
    const t = Date.now();
    const creator = {
      id: 'creator-mock', name: 'Jordan Rivera', email: 'affiliate@test.test', phone: null,
      instagram: 'jordanrivera', tiktok: 'jordanrivera', youtube: null, country: 'US',
      payout_method: 'paypal', payout_details_last4: 'j•••@example.com', tax_form_received: true
    };
    const campaigns = [
      {
        id: 'camp-ulio', name: 'Ulio Summer Launch', status: 'active', start_date: date(t - 40 * DAY), end_date: date(t + 50 * DAY),
        platforms_allowed: ['tiktok', 'instagram'], default_cpm_rate_cents: 2500, currency: 'USD',
        max_payout_per_video_cents: 50000, max_payout_per_affiliate_cents: null, total_budget_cents: null,
        min_views_to_qualify: 1000, requires_video_approval: true,
        brief: 'Show how you use Ulio in your daily routine. Hook in the first 2 seconds, mention the summer launch, and tag @ulio in the caption. Keep it under 60 seconds.'
      },
      {
        id: 'camp-fit', name: 'Edgeform Fitness Drop', status: 'active', start_date: date(t - 12 * DAY), end_date: null,
        platforms_allowed: ['tiktok', 'instagram', 'youtube'], default_cpm_rate_cents: 1500, currency: 'USD',
        max_payout_per_video_cents: null, max_payout_per_affiliate_cents: 200000, total_budget_cents: null,
        min_views_to_qualify: null, requires_video_approval: false,
        brief: 'Film a workout featuring the new drop. Any format works: GRWM, gym vlog, or a quick try-on.'
      },
      {
        id: 'camp-spring', name: 'Spring Creator Push', status: 'ended', start_date: date(t - 120 * DAY), end_date: date(t - 60 * DAY),
        platforms_allowed: ['tiktok'], default_cpm_rate_cents: 2000, currency: 'USD',
        max_payout_per_video_cents: null, max_payout_per_affiliate_cents: null, total_budget_cents: null,
        min_views_to_qualify: null, requires_video_approval: true,
        brief: 'Spring collection unboxing.'
      }
    ];
    const assignments = [
      { campaign_id: 'camp-ulio', status: 'active', cpm_rate_override_cents: null },
      { campaign_id: 'camp-fit', status: 'active', cpm_rate_override_cents: 1800 },
      { campaign_id: 'camp-spring', status: 'active', cpm_rate_override_cents: null }
    ];

    // Each video is seeded with a run of weekly new-views entries (Sundays, oldest first).
    // `locked` videos got one extra final entry the week their campaign ended.
    const video = (campaign_id, platform, pid, caption, status, submittedDaysAgo, weeklyViews, extra = {}) => {
      const submitted = t - submittedDaysAgo * DAY;
      const v = {
        id: uid(), campaign_id, platform, platform_video_id: pid,
        submitted_url: canonical(platform, pid, 'jordanrivera'), canonical_url: canonical(platform, pid, 'jordanrivera'),
        thumbnail_url: null, caption, posted_at: iso(submitted - 3600000), status, rejection_reason: null,
        submitted_at: iso(submitted), locked_at: null,
        latest_view_count: 0, billable_views: 0, earned_cents: 0, last_fetched_at: null,
        ...extra
      };
      v._weeklyViews = weeklyViews; // consumed by seedSnapshots(), not part of the API shape
      return v;
    };
    const videos = [
      video('camp-ulio', 'tiktok', '7412345678901234567', 'my morning routine but make it ulio ☀️', 'approved', 40, [41200, 38700, 33100, 29800, 21400, 20100]),
      video('camp-ulio', 'instagram', 'C9xYz12AbCd', 'summer launch unboxing', 'approved', 12, [40200, 22550]),
      video('camp-ulio', 'tiktok', '7419876543210987654', 'ulio in 30 seconds', 'pending_review', 1, []),
      video('camp-ulio', 'tiktok', '7411111111111111111', 'reposted clip', 'rejected', 20, [], { rejection_reason: "Missing the @ulio tag in the caption." }),
      video('camp-fit', 'youtube', 'dQw4w9WgXcQ', 'Leg day in the new drop', 'approved', 6, [23980]),
      video('camp-fit', 'tiktok', '7422222222222222222', 'gym fit check', 'approved', 4, [8410]),
      video('camp-spring', 'tiktok', '7400000000000000001', 'spring haul', 'locked', 90, [51200, 31000, 15000])
    ];
    const view_snapshots = [];
    const springVideo = videos[videos.length - 1];
    springVideo.locked_at = iso(t - 60 * DAY);
    const payouts = [
      {
        id: uid(), period_start: date(t - 71 * DAY), period_end: date(t - 64 * DAY), amount_cents: 0, currency: 'USD',
        status: 'paid', payment_method: 'zelle', payment_reference: 'ZL-8H2K19XQ', paid_at: iso(t - 63 * DAY),
        video_ids: [springVideo.id]
      }
    ];
    return { creator, campaigns, assignments, videos, view_snapshots, payouts, screenshots: [], instagram: null, sessions: [] };
  }

  function canonical(platform, id, handle) {
    if (platform === 'tiktok') return `https://www.tiktok.com/@${handle || 'creator'}/video/${id}`;
    if (platform === 'instagram') return `https://www.instagram.com/reel/${id}/`;
    return `https://www.youtube.com/shorts/${id}`;
  }

  // Lays down one weekly view_snapshots row per entry in v._weeklyViews, spaced 7 days apart
  // starting the week after submission, and applies the earnings formula as it goes (CONTRACT.md §3).
  function seedSnapshots(db) {
    const t = Date.now();
    const lastCountAgoDays = 2; // most recent Sunday count, for a still-active video
    for (const v of db.videos) {
      const weeks = v._weeklyViews || [];
      delete v._weeklyViews;
      const campaign = db.campaigns.find(c => c.id === v.campaign_id);
      const rate = rateFor(db, campaign);
      // Anchor the most recent count at "now" (or at locked_at for a video whose campaign already
      // ended) and step backward by a week per entry, so counts always land in the past.
      const anchorAt = v.status === 'locked' && v.locked_at ? new Date(v.locked_at).getTime() : t - lastCountAgoDays * DAY;
      let cumulative = 0, earned = 0;
      weeks.forEach((newViews, i) => {
        const fetchedAt = iso(anchorAt - (weeks.length - 1 - i) * WEEK);
        cumulative += newViews;
        let cents = 0;
        if (!(campaign.min_views_to_qualify && cumulative < campaign.min_views_to_qualify)) {
          cents = Math.floor(newViews * rate / 1000);
          if (campaign.max_payout_per_video_cents != null) cents = Math.max(0, Math.min(cents, campaign.max_payout_per_video_cents - earned));
        }
        earned += cents;
        db.view_snapshots.push({
          id: uid(), video_id: v.id, view_count: cumulative, new_views: newViews, earned_cents: cents,
          source: 'manual', fetched_at: fetchedAt, entered_by: 'staff-demo', note: null
        });
      });
      v.latest_view_count = cumulative;
      v.billable_views = cumulative;
      v.earned_cents = earned;
      v.last_fetched_at = weeks.length ? db.view_snapshots.filter(s => s.video_id === v.id).slice(-1)[0].fetched_at : null;
    }
  }

  // A stand-in for a phone insights screen, drawn on a canvas so the demo has something to show.
  function sampleShot(views) {
    const canvas = document.createElement('canvas');
    canvas.width = 360; canvas.height = 640;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b1713'; ctx.fillRect(0, 0, 360, 640);
    ctx.fillStyle = '#f7f8f6'; ctx.font = '500 15px system-ui, sans-serif';
    ctx.fillText('Insights', 24, 64);
    ctx.font = '600 46px system-ui, sans-serif';
    ctx.fillText(new Intl.NumberFormat('en-US').format(views), 24, 132);
    ctx.fillStyle = '#a4c9b6'; ctx.font = '400 15px system-ui, sans-serif';
    ctx.fillText('Views', 24, 160);
    ctx.strokeStyle = '#43504b';
    for (let i = 0; i < 4; i++) {
      ctx.strokeRect(24, 210 + i * 78, 312, 58);
    }
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  // Two seeded screenshots: one on a video whose views were checked afterwards (so the API, and
  // the portal, refuse to delete it) and one on a video that hasn't been checked yet.
  function seedScreenshots(db) {
    const reel = db.videos.find(v => v.platform === 'instagram');
    const fresh = db.videos.find(v => v.status === 'pending_review');
    const shot = (video, views, uploadedAt, note) => db.screenshots.push({
      id: uid(), video_id: video.id, content_type: 'image/jpeg', size_bytes: 148230,
      reported_views: views, note: note || null, uploaded_at: uploadedAt, data_url: sampleShot(views)
    });
    if (reel) shot(reel, 40200, iso(Date.now() - 5 * DAY), 'Trial reel — insights screen');
    if (fresh) shot(fresh, 2140, iso(Date.now() - 2 * 3600000), null);
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
      if (saved) return saved;
    } catch {}
    const db = seed();
    seedSnapshots(db);
    seedScreenshots(db);
    for (const p of db.payouts) {
      p.amount_cents = p.video_ids.reduce((s, id) => s + (db.videos.find(v => v.id === id)?.earned_cents || 0), 0);
    }
    save(db);
    return db;
  }

  function save(db) { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {} }

  // --- Formulas (CONTRACT.md §3) ---
  function rateFor(db, campaign) {
    const a = db.assignments.find(x => x.campaign_id === campaign.id);
    return a && a.cpm_rate_override_cents != null ? a.cpm_rate_override_cents : campaign.default_cpm_rate_cents;
  }

  function totals(db, campaignId) {
    const vids = db.videos.filter(v => !campaignId || v.campaign_id === campaignId);
    const earned = vids.filter(v => v.status === 'locked' || v.status === 'approved').reduce((s, v) => s + v.earned_cents, 0);
    const pending = vids.filter(v => v.status === 'approved').reduce((s, v) => s + v.earned_cents, 0);
    const paid = db.payouts.filter(p => p.status === 'paid')
      .flatMap(p => p.video_ids.map(id => ({ id, payout: p })))
      .filter(({ id }) => db.videos.some(v => v.id === id && (!campaignId || v.campaign_id === campaignId)))
      .reduce((s, { id, payout }) => s + Math.round(payout.amount_cents / payout.video_ids.length), 0);
    return { earned_cents: earned, pending_cents: pending, paid_cents: paid, owed_cents: earned - paid };
  }

  // --- Shapes ---
  const videoShape = (v) => ({
    id: v.id, campaign_id: v.campaign_id, submitted_url: v.submitted_url, canonical_url: v.canonical_url, platform: v.platform,
    thumbnail_url: v.thumbnail_url, caption: v.caption, posted_at: v.posted_at, status: v.status, rejection_reason: v.rejection_reason,
    submitted_at: v.submitted_at, locked_at: v.locked_at, latest_view_count: v.latest_view_count,
    billable_views: v.billable_views, earned_cents: v.earned_cents, last_fetched_at: v.last_fetched_at,
    screenshot_count: 0, last_screenshot_at: null
  });

  // videoShape() can't see the db, so screenshot counts are stitched on here (CONTRACT.md §7).
  function videoWithShots(db, v) {
    const mine = db.screenshots.filter(s => s.video_id === v.id);
    return {
      ...videoShape(v),
      screenshot_count: mine.length,
      last_screenshot_at: mine.length ? mine.map(s => s.uploaded_at).sort().slice(-1)[0] : null
    };
  }

  const screenshotShape = (s) => ({
    id: s.id, video_id: s.video_id, content_type: s.content_type, size_bytes: s.size_bytes,
    reported_views: s.reported_views, note: s.note, uploaded_at: s.uploaded_at
  });

  // The real API stores the original in R2. localStorage can't hold a 9MB data URL, so the mock
  // keeps a smaller copy — enough to prove the gallery, the blob fetch and delete all work.
  const SHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const MAX_SHOT_BYTES = 10 * 1024 * 1024;
  const MAX_SHOTS_PER_VIDEO = 30;

  async function shrink(blob) {
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (bitmap.close) bitmap.close();
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch {
      return sampleShot(0);
    }
  }

  function dataUrlToBlob(dataUrl) {
    const [head, body] = String(dataUrl).split(',');
    const type = (head.match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  function summary(db, c) {
    const a = db.assignments.find(x => x.campaign_id === c.id);
    const vids = db.videos.filter(v => v.campaign_id === c.id);
    const t = totals(db, c.id);
    return {
      id: c.id, name: c.name, status: c.status, start_date: c.start_date, end_date: c.end_date,
      platforms_allowed: c.platforms_allowed, cpm_rate_cents: rateFor(db, c), currency: c.currency,
      assignment_status: a.status, video_count: vids.length,
      total_views: vids.filter(v => v.status === 'approved' || v.status === 'locked').reduce((s, v) => s + v.latest_view_count, 0),
      earned_cents: t.earned_cents, pending_cents: t.pending_cents
    };
  }

  const detail = (db, c) => ({
    ...summary(db, c), brief: c.brief,
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
      return ok({ data: db.videos.filter(v => v.campaign_id === id).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)).map(v => videoWithShots(db, v)) });
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
        submitted_at: iso(t), locked_at: null,
        latest_view_count: 0, billable_views: 0, earned_cents: 0, last_fetched_at: null
      };
      db.videos.push(v);
      return ok({ video: videoWithShots(db, v) }, 201);
    }],
    ['DELETE', /^\/videos\/([^/]+)$/, (db, body, [id]) => {
      const i = db.videos.findIndex(v => v.id === id);
      if (i < 0) return fail(404, 'not_found', 'Video not found.');
      if (db.videos[i].status !== 'pending_review') return fail(409, 'not_deletable', 'Only videos waiting for review can be removed.');
      db.screenshots = db.screenshots.filter(s => s.video_id !== id);
      db.videos.splice(i, 1);
      return ok();
    }],

    // --- View screenshots (CONTRACT.md §7) ---
    ['GET', /^\/videos\/([^/]+)\/screenshots$/, (db, body, [id]) => {
      if (!db.videos.some(v => v.id === id)) return fail(404, 'not_found', 'Video not found.');
      return ok({ data: db.screenshots.filter(s => s.video_id === id).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).map(screenshotShape) });
    }],
    ['POST', /^\/videos\/([^/]+)\/screenshots$/, async (db, blob, [id], params) => {
      const v = db.videos.find(x => x.id === id);
      if (!v) return fail(404, 'not_found', 'Video not found.');
      if (!['pending_review', 'approved'].includes(v.status)) return fail(409, 'video_not_tracking', 'Screenshots can only be added to videos that are still being tracked.');
      const type = String((blob && blob.type) || '').split(';')[0].toLowerCase();
      if (!SHOT_TYPES.includes(type)) return fail(415, 'unsupported_image', 'Upload a PNG, JPEG, or WebP image.');
      if (!blob.size) return fail(400, 'validation_error', 'The image is empty.');
      if (blob.size > MAX_SHOT_BYTES) return fail(413, 'image_too_large', 'Screenshots must be 10MB or smaller.');
      let views = null;
      const raw = params.get('views');
      if (raw !== null && raw !== '') {
        views = Number(String(raw).replace(/[,\s]/g, ''));
        if (!Number.isSafeInteger(views) || views < 0) return fail(400, 'validation_error', 'Views must be a whole number.');
      }
      if (db.screenshots.filter(s => s.video_id === id).length >= MAX_SHOTS_PER_VIDEO) {
        return fail(409, 'too_many_screenshots', 'This video already has the maximum number of screenshots.');
      }
      const row = {
        id: uid(), video_id: id, content_type: type, size_bytes: blob.size, reported_views: views,
        note: (params.get('note') || '').trim().slice(0, 500) || null, uploaded_at: iso(Date.now()),
        data_url: await shrink(blob)
      };
      db.screenshots.push(row);
      return ok({ screenshot: screenshotShape(row) }, 201);
    }],
    ['DELETE', /^\/screenshots\/([^/]+)$/, (db, body, [id]) => {
      const i = db.screenshots.findIndex(s => s.id === id);
      if (i < 0) return fail(404, 'not_found', 'Screenshot not found.');
      const shot = db.screenshots[i];
      const v = db.videos.find(x => x.id === shot.video_id);
      if (v && v.last_fetched_at && v.last_fetched_at >= shot.uploaded_at) {
        return fail(409, 'not_deletable', 'This screenshot was already used for a views check, so it can’t be deleted.');
      }
      db.screenshots.splice(i, 1);
      return ok();
    }],
    // --- Instagram connections (CONTRACT.md §8) ---
    ['GET', /^\/connections$/, (db) => ok({ available: true, instagram: db.instagram || {
      connected: false, username: null, connected_at: null, last_synced_at: null, expires_at: null, needs_reconnect: false, error: null
    } })],
    ['POST', /^\/connections\/instagram\/start$/, (db) => {
      // No real OAuth in demo mode: pretend the round trip already happened.
      db.instagram = {
        connected: true, username: db.creator.instagram || 'jordanrivera', connected_at: iso(Date.now()),
        last_synced_at: iso(Date.now()), expires_at: iso(Date.now() + 60 * DAY), needs_reconnect: false, error: null
      };
      return ok({ authorize_url: 'settings.html?instagram=connected' });
    }],
    ['DELETE', /^\/connections\/instagram$/, (db) => { db.instagram = null; return ok(); }],
    ['GET', /^\/earnings$/, (db) => ok({
      earnings: {
        currency: 'USD', ...totals(db),
        by_campaign: db.campaigns.map(c => ({ campaign_id: c.id, campaign_name: c.name, ...totals(db, c.id) }))
      }
    })],
    ['GET', /^\/payouts$/, (db) => ok({
      data: [...db.payouts].sort((a, b) => b.period_end.localeCompare(a.period_end)).map(p => ({
        id: p.id, period_start: p.period_start, period_end: p.period_end, amount_cents: p.amount_cents, currency: p.currency,
        status: p.status, payment_method: p.payment_method, payment_reference: p.payment_reference, paid_at: p.paid_at,
        line_items: p.video_ids.map(id => {
          const v = db.videos.find(x => x.id === id);
          const c = v && db.campaigns.find(x => x.id === v.campaign_id);
          return {
            video_id: id, campaign_id: v ? v.campaign_id : null, campaign_name: c ? c.name : null,
            canonical_url: v ? v.canonical_url : null, billable_views: v ? v.billable_views : 0,
            cpm_rate_cents: c ? rateFor(db, c) : 0, amount_cents: Math.round(p.amount_cents / p.video_ids.length)
          };
        })
      }))
    })]
  ];

  async function handle(method, path, body, token, onProgress) {
    await new Promise(r => setTimeout(r, 180));
    const [route, query] = String(path).split('?');
    const params = new URLSearchParams(query || '');
    const db = load();
    for (const [m, pattern, handler, isPublic] of routes) {
      const match = m === method && route.match(pattern);
      if (!match) continue;
      if (!isPublic && token !== SESSION_TOKEN) return fail(401, 'unauthorized', 'Please sign in again.');
      // Pretend the bytes go over the wire, so the progress bar is exercised in demo mode too.
      if (onProgress) for (const ratio of [0.25, 0.6, 1]) { onProgress(ratio); await new Promise(r => setTimeout(r, 120)); }
      const result = await handler(db, body || {}, match.slice(1).map(decodeURIComponent), params);
      save(db);
      return JSON.parse(JSON.stringify(result));
    }
    return fail(404, 'not_found', 'Not found.');
  }

  // Stands in for GET /screenshots/:id, which serves the image bytes behind the Bearer header.
  async function blob(path, token) {
    await new Promise(r => setTimeout(r, 120));
    const match = String(path).split('?')[0].match(/^\/screenshots\/([^/]+)$/);
    const shot = match && load().screenshots.find(s => s.id === decodeURIComponent(match[1]));
    if (token !== SESSION_TOKEN || !shot) throw new Error('Screenshot not found.');
    return dataUrlToBlob(shot.data_url);
  }

  function reset() { try { localStorage.removeItem(DB_KEY); } catch {} }

  window.MockApi = { handle, blob, reset, LOGIN_TOKEN };
})();
