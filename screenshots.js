// Insights screenshots uploaded as proof of views (CONTRACT.md §7).
// Trial reels have no public view count, so the affiliate uploads their insights screen and staff
// read the number off it during the weekly check. Images go up as raw bytes, and come back down
// behind the Bearer header, so every thumbnail is fetched as a blob.
(function () {
  const esc = (value) => window.UI.esc(value);

  const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const MAX_BYTES = 10 * 1024 * 1024;   // the API's hard limit
  const TARGET_BYTES = 9 * 1024 * 1024; // what we aim for, so a re-encode never lands on the line
  const MAX_SIDE = 2400;                // plenty to read a view count off
  const UPLOADABLE = ['pending_review', 'approved'];

  const DELETE_ERRORS = { not_deletable: 'This screenshot was already used for a views check, so it can’t be deleted.' };

  const bytes = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  // --- Preparing the file ---------------------------------------------------
  // iPhones hand over HEIC (or a 12MP photo of a laptop screen). Either way the API would reject
  // it, so anything that isn't already a small PNG/JPEG/WebP is redrawn to a JPEG that fits.

  async function decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file); } catch {}
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode failed'));
        img.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

  async function redraw(image, side, quality) {
    const w = image.width, h = image.height;
    const scale = Math.min(1, side / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return toBlob(canvas, quality);
  }

  async function prepare(file) {
    const type = String(file.type || '').toLowerCase();
    if (TYPES.includes(type) && file.size <= TARGET_BYTES) return { blob: file, converted: false };

    let image;
    try { image = await decode(file); } catch {
      throw new Error("This image couldn't be opened here. Take a normal screenshot of your insights (or save the photo as a JPEG) and upload that.");
    }
    let out = null;
    for (const [side, quality] of [[MAX_SIDE, 0.9], [MAX_SIDE, 0.75], [1800, 0.7], [1400, 0.65], [1000, 0.6]]) {
      out = await redraw(image, side, quality);
      if (out && out.size <= TARGET_BYTES) break;
    }
    if (image.close) image.close();
    if (!out) throw new Error("This image couldn't be resized here. Try uploading a screenshot instead.");
    if (out.size > MAX_BYTES) throw new Error('That image is too big to upload, even after resizing.');
    return { blob: out, converted: true };
  }

  // --- Markup ---------------------------------------------------------------

  function countLabel(video) {
    const n = video.screenshot_count || 0;
    return n === 1 ? '1 screenshot' : `${n} screenshots`;
  }

  // The block that sits under a video's title in the table.
  function cellHtml(video) {
    const canUpload = UPLOADABLE.includes(video.status);
    const count = video.screenshot_count || 0;
    if (!canUpload && !count) return '';
    return `<div class="shots" data-shots="${esc(video.id)}">
      <div class="shots-bar">
        ${canUpload ? `<button type="button" class="btn btn-ghost btn-sm" data-shot-pick="${esc(video.id)}">Upload views screenshot</button>` : ''}
        <button type="button" class="btn-link small shots-count" data-shot-toggle="${esc(video.id)}"${count ? '' : ' hidden'}>${countLabel(video)}</button>
      </div>
      ${canUpload && video.platform === 'instagram' ? `<div class="shots-hint">Trial reel? Its views aren’t public — open the reel → <strong>View insights</strong>, screenshot it, and upload it here each week before the weekly check.</div>` : ''}
      <div class="shots-form" hidden></div>
      <div class="shots-gallery" hidden></div>
    </div>`;
  }

  const formHtml = (file, previewUrl, converted) => `
    <img class="shots-preview" src="${previewUrl}" alt="">
    <div class="shots-fields">
      <div class="small muted">${esc(file.name || 'Screenshot')} · ${bytes(file.size)}${converted ? ' · resized to fit' : ''}</div>
      <input class="input" type="text" inputmode="numeric" data-shot-views placeholder="Views shown (optional)" aria-label="Views shown in the screenshot">
      <input class="input" type="text" maxlength="500" data-shot-note placeholder="Note (optional)" aria-label="Note">
      <div class="shots-actions">
        <button type="button" class="btn btn-sm" data-shot-send>Upload</button>
        <button type="button" class="btn btn-ghost btn-sm" data-shot-cancel>Cancel</button>
      </div>
      <div class="progress" hidden><span></span></div>
      <div class="form-error" role="alert" hidden></div>
    </div>`;

  // Staff can't have checked views off a screenshot that went up after the last check, so that's
  // exactly when deleting is still allowed (the API enforces the same rule).
  const deletable = (video, shot) => !video.last_fetched_at || video.last_fetched_at < shot.uploaded_at;

  const shotHtml = (video, shot) => `
    <figure class="shot" data-shot="${esc(shot.id)}">
      <a class="shot-img" data-shot-open target="_blank" rel="noopener"><span class="spinner"></span></a>
      <figcaption>
        <div class="small">${shot.reported_views == null ? '<span class="muted">No count given</span>' : window.UI.number(shot.reported_views) + ' views'}</div>
        <div class="small muted">${window.UI.date(shot.uploaded_at)}</div>
        ${shot.note ? `<div class="small dim shot-note">${esc(shot.note)}</div>` : ''}
        ${deletable(video, shot) ? `<button type="button" class="btn-link small shot-del" data-shot-delete="${esc(shot.id)}">Delete</button>`
          : `<span class="small muted" title="Staff have already read views off this screenshot.">Kept for the views check</span>`}
      </figcaption>
    </figure>`;

  // --- Wiring ---------------------------------------------------------------
  // One file input and one delegated click listener for the whole table.

  function attach(root, { getVideo, onChanged }) {
    const picker = document.createElement('input');
    picker.type = 'file';
    // HEIC is listed too: iPhones often hand over a .heic from the photo library, and prepare()
    // converts it. Deliberately no `capture` attribute — that would force the camera and block
    // picking the screenshot they already took.
    picker.accept = 'image/png,image/jpeg,image/webp,image/heic,image/heif';
    picker.hidden = true;
    // On the body, not in `root` — the video table replaces its own innerHTML on every reload.
    document.body.appendChild(picker);

    const pending = new Map();   // video id -> { blob, previewUrl }
    const urls = new Map();      // video id -> object URLs held by its open gallery

    const box = (id) => root.querySelector(`[data-shots="${CSS.escape(id)}"]`);

    function releaseGallery(id) {
      (urls.get(id) || []).forEach(url => URL.revokeObjectURL(url));
      urls.delete(id);
    }

    function closeForm(id) {
      const held = pending.get(id);
      if (held) URL.revokeObjectURL(held.previewUrl);
      pending.delete(id);
      const el = box(id);
      if (!el) return;
      el.querySelector('.shots-form').hidden = true;
      el.querySelector('.shots-form').innerHTML = '';
    }

    function refreshCount(id) {
      const el = box(id), video = getVideo(id);
      if (!el || !video) return;
      const btn = el.querySelector('.shots-count');
      btn.textContent = countLabel(video);
      btn.hidden = !(video.screenshot_count || 0);
    }

    async function openGallery(id) {
      const el = box(id);
      const gallery = el.querySelector('.shots-gallery');
      gallery.hidden = false;
      gallery.innerHTML = window.UI.loading('Loading screenshots…');
      releaseGallery(id);
      let data;
      try {
        ({ data } = await window.Api.get(`/videos/${encodeURIComponent(id)}/screenshots`));
      } catch (error) {
        gallery.innerHTML = window.UI.failed(error);
        return;
      }
      if (gallery.hidden) return;
      const video = getVideo(id) || {};
      gallery.innerHTML = data.length
        ? data.map(shot => shotHtml(video, shot)).join('')
        : '<div class="small muted">No screenshots yet.</div>';
      const held = [];
      urls.set(id, held);
      // Thumbnails need the Bearer header, so each one is fetched and turned into a blob URL.
      for (const shot of data) {
        const link = gallery.querySelector(`[data-shot="${CSS.escape(shot.id)}"] [data-shot-open]`);
        if (!link) continue;
        try {
          const url = URL.createObjectURL(await window.Api.blob(`/screenshots/${encodeURIComponent(shot.id)}`));
          if (!urls.has(id) || urls.get(id) !== held) { URL.revokeObjectURL(url); return; }
          held.push(url);
          link.href = url;
          link.innerHTML = `<img src="${url}" alt="Insights screenshot from ${esc(window.UI.date(shot.uploaded_at))}" loading="lazy">`;
        } catch {
          link.innerHTML = '<span class="small muted">Preview unavailable</span>';
        }
      }
    }

    function closeGallery(id) {
      const el = box(id);
      releaseGallery(id);
      if (!el) return;
      const gallery = el.querySelector('.shots-gallery');
      gallery.hidden = true;
      gallery.innerHTML = '';
    }

    picker.addEventListener('change', async () => {
      const file = picker.files && picker.files[0];
      const id = picker.dataset.videoId;
      picker.value = '';
      if (!file || !id) return;
      const el = box(id);
      if (!el) return;
      const form = el.querySelector('.shots-form');
      closeForm(id);
      form.hidden = false;
      form.innerHTML = window.UI.loading('Getting the image ready…');
      let prepared;
      try {
        prepared = await prepare(file);
      } catch (error) {
        form.innerHTML = `<div class="form-error" role="alert">${esc(error.message)}</div>`;
        return;
      }
      const previewUrl = URL.createObjectURL(prepared.blob);
      pending.set(id, { blob: prepared.blob, previewUrl });
      form.innerHTML = formHtml(prepared.blob.size < file.size ? { name: file.name, size: prepared.blob.size } : file, previewUrl, prepared.converted);
      const views = form.querySelector('[data-shot-views]');
      if (views) views.focus();
    });

    async function send(id) {
      const el = box(id), held = pending.get(id);
      if (!el || !held) return;
      const form = el.querySelector('.shots-form');
      const errorEl = form.querySelector('.form-error');
      const bar = form.querySelector('.progress');
      const fill = bar.querySelector('span');
      const raw = form.querySelector('[data-shot-views]').value.replace(/[,\s]/g, '');
      const note = form.querySelector('[data-shot-note]').value.trim();
      errorEl.hidden = true;
      if (raw && !/^\d+$/.test(raw)) {
        errorEl.textContent = 'Views must be a whole number, e.g. 12400.';
        errorEl.hidden = false;
        return;
      }
      form.querySelectorAll('button, input').forEach(node => { node.disabled = true; });
      bar.hidden = false;
      fill.style.width = '2%';

      const query = [];
      if (raw) query.push('views=' + encodeURIComponent(raw));
      if (note) query.push('note=' + encodeURIComponent(note));
      const path = `/videos/${encodeURIComponent(id)}/screenshots${query.length ? '?' + query.join('&') : ''}`;
      try {
        const { screenshot } = await window.Api.upload(path, held.blob, (ratio) => {
          fill.style.width = Math.max(2, Math.round(ratio * 100)) + '%';
        });
        const video = getVideo(id);
        if (video) {
          video.screenshot_count = (video.screenshot_count || 0) + 1;
          video.last_screenshot_at = screenshot.uploaded_at;
        }
        closeForm(id);
        refreshCount(id);
        window.UI.toast('Screenshot uploaded.');
        await openGallery(id);
        if (onChanged) onChanged(id);
      } catch (error) {
        bar.hidden = true;
        form.querySelectorAll('button, input').forEach(node => { node.disabled = false; });
        errorEl.textContent = window.UI.errorMessage(error);
        errorEl.hidden = false;
      }
    }

    async function remove(id, shotId, btn) {
      if (!confirm('Delete this screenshot?')) return;
      btn.disabled = true;
      try {
        await window.Api.del(`/screenshots/${encodeURIComponent(shotId)}`);
        const video = getVideo(id);
        if (video) video.screenshot_count = Math.max(0, (video.screenshot_count || 1) - 1);
        window.UI.toast('Screenshot deleted.');
        refreshCount(id);
        if (video && video.screenshot_count) await openGallery(id); else closeGallery(id);
        if (onChanged) onChanged(id);
      } catch (error) {
        window.UI.toast(window.UI.errorMessage(error, DELETE_ERRORS), 'error');
        btn.disabled = false;
      }
    }

    root.addEventListener('click', (event) => {
      const target = event.target;
      const pick = target.closest('[data-shot-pick]');
      if (pick) {
        picker.dataset.videoId = pick.dataset.shotPick;
        picker.click();
        return;
      }
      const toggle = target.closest('[data-shot-toggle]');
      if (toggle) {
        const id = toggle.dataset.shotToggle;
        const gallery = box(id).querySelector('.shots-gallery');
        if (gallery.hidden) openGallery(id); else closeGallery(id);
        return;
      }
      const shots = target.closest('[data-shots]');
      if (!shots) return;
      const id = shots.dataset.shots;
      if (target.closest('[data-shot-cancel]')) return closeForm(id);
      if (target.closest('[data-shot-send]')) return send(id);
      const del = target.closest('[data-shot-delete]');
      if (del) return remove(id, del.dataset.shotDelete, del);
    });

    // The video table re-renders on its own; drop every object URL we were holding for it.
    return {
      reset() {
        [...urls.keys()].forEach(releaseGallery);
        [...pending.keys()].forEach(closeForm);
      }
    };
  }

  window.Screenshots = { cellHtml, attach, prepare, MAX_BYTES };
})();
