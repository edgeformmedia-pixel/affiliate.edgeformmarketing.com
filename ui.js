// Formatting, page chrome, and the plain-language copy for every API error code.
(function () {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const money = (cents, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);

  const number = (n) => new Intl.NumberFormat('en-US').format(n || 0);

  const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);

  const date = (value) => value
    ? new Date(value.length === 10 ? value + 'T12:00:00Z' : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  function relative(value) {
    if (!value) return '—';
    const diff = new Date(value) - Date.now();
    const abs = Math.abs(diff);
    const units = [['day', 86400000], ['hour', 3600000], ['minute', 60000]];
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    for (const [unit, ms] of units) if (abs >= ms || unit === 'minute') return rtf.format(Math.round(diff / ms), unit);
  }

  const PLATFORM = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' };

  const VIDEO_STATUS = {
    pending_review: ['In review', 'amber'],
    approved: ['Counting views', 'green'],
    locked: ['Final', 'dark'],
    rejected: ['Rejected', 'red'],
    removed: ['Unavailable', 'red']
  };

  const CAMPAIGN_STATUS = { active: ['Active', 'green'], paused: ['Paused', 'amber'], ended: ['Ended', 'muted'], draft: ['Draft', 'muted'] };
  const PAYOUT_STATUS = { pending: ['Pending', 'amber'], approved: ['Approved', 'blue'], paid: ['Paid', 'green'], failed: ['Failed', 'red'] };
  const PAYOUT_METHOD = { paypal: 'PayPal', wise: 'Wise', bank: 'Bank transfer', manual: 'Other' };

  const pill = (map, key) => {
    const [label, tone] = map[key] || [key, 'muted'];
    return `<span class="pill pill-${tone}">${esc(label)}</span>`;
  };

  const ERRORS = {
    invalid_url: "That doesn't look like a video link. In the app, tap Share → Copy link, then paste it here.",
    unsupported_platform: 'We can only track TikTok, Instagram and YouTube videos.',
    platform_not_allowed: "This campaign doesn't accept videos from that platform.",
    duplicate_video: 'This video has already been submitted.',
    campaign_not_active: "This campaign isn't accepting new videos right now.",
    not_assigned: "You're not part of this campaign. Contact your Edgeform manager.",
    not_deletable: 'Only videos that are still in review can be removed.',
    not_available: "Connecting accounts isn't available yet. We'll let you know when it's ready.",
    invalid_token: 'This sign-in link is invalid or has expired. Request a new one below.',
    rate_limited: 'Too many attempts. Wait a few minutes and try again.',
    network_error: "Couldn't reach Edgeform. Check your connection and try again."
  };

  const errorMessage = (error) => (error && ERRORS[error.code]) || (error && error.message) || 'Something went wrong. Please try again.';

  // Header + nav for signed-in pages.
  function shell(active) {
    const session = window.Api.requireSession();
    const name = (session.creator && session.creator.name) || '';
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '•';
    const link = (href, key, label) => `<a href="${href}" class="nav-link${active === key ? ' active' : ''}">${label}</a>`;
    document.getElementById('app-header').innerHTML = `
      <div class="header-inner">
        <a class="brand" href="dashboard.html"><span class="brand-mark">E</span><span>Edgeform <em>Affiliates</em></span></a>
        <nav class="nav">
          ${link('dashboard.html', 'dashboard', 'Campaigns')}
          ${link('payouts.html', 'payouts', 'Payouts')}
          ${link('settings.html', 'settings', 'Settings')}
        </nav>
        <div class="header-right">
          ${window.Api.isMock ? '<span class="mock-badge" title="Sample data. Sign out to leave demo mode.">Demo data</span>' : ''}
          <span class="avatar" title="${esc(name)}">${esc(initials)}</span>
          <button class="btn-link" id="signout">Sign out</button>
        </div>
      </div>`;
    document.getElementById('signout').addEventListener('click', () => window.Api.logout());
    return session;
  }

  function toast(message, tone = 'ok') {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.className = 'toast toast-' + tone + ' show';
    el.textContent = message;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  const loading = (label = 'Loading…') => `<div class="state"><span class="spinner"></span>${esc(label)}</div>`;
  const failed = (error) => `<div class="state state-error">${esc(errorMessage(error))}</div>`;

  window.UI = { esc, money, number, compact, date, relative, PLATFORM, VIDEO_STATUS, CAMPAIGN_STATUS, PAYOUT_STATUS, PAYOUT_METHOD, pill, errorMessage, shell, toast, loading, failed };
})();
