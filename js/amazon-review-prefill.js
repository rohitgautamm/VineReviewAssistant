/**
 * VinePilot AI — Amazon Review Page Prefill, Batch Photo Uploader & Live Guideline Guard
 * Runs on Amazon review creation pages (/review/create-review, /reviews/edit-review,
 * /review/review-your-purchases, #in-context-ryp-form).
 */
(function () {
  'use strict';

  const REVIEW_PAGE_RE = /\/(review\/create-review|reviews?\/edit-review|review\/review-your-purchases|vine\/[^?]*review)/i;
  let hasFreshLocalDraft = false;
  try {
    const raw = localStorage.getItem('vp_review_prefill');
    if (raw) {
      const parsed = JSON.parse(raw);
      hasFreshLocalDraft = !!(parsed && Date.now() - (parsed.ts || 0) < 25 * 60 * 1000);
    }
  } catch { /* ignore */ }

  const isReviewUrl = REVIEW_PAGE_RE.test(location.pathname + location.search) || REVIEW_PAGE_RE.test(location.href);
  if (!isReviewUrl && !hasFreshLocalDraft) return;
  if (window.__VP_REVIEW_PREFILL_ACTIVE__) return;
  window.__VP_REVIEW_PREFILL_ACTIVE__ = true;

  const META_KEY = 'vp_review_prefill';
  const DB_NAME = 'vp_review_handoff';
  const STORE_NAME = 'images';
  const MAX_AGE_MS = 25 * 60 * 1000;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const log = (...args) => console.log('[VinePilot Prefill]', ...args);

  function urlAsin() {
    const m = /[?&]asin=([A-Z0-9]{8,14})/i.exec(location.href);
    return m ? m[1].toUpperCase() : '';
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  async function waitFor(fn, { timeout = 20000, interval = 250 } = {}) {
    const start = Date.now();
    for (;;) {
      try {
        const v = fn();
        if (v) return v;
      } catch { /* keep polling */ }
      if (Date.now() - start > timeout) return null;
      await sleep(interval);
    }
  }

  /**
   * Sets a React-controlled input or textarea value and fires the exact synthetic
   * event sequence React 17/18 forms require to mark the field valid & enable Submit.
   */
  function setReactValue(el, value, { blurAfter = true } = {}) {
    if (!el) return;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    el.focus?.({ preventScroll: true });
    el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    // Set value via native prototype setter so React's valueTracker sees the change
    if (setter) setter.call(el, value);
    else el.value = value;

    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: String(value)
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // Nudge React's internal value tracker with a space + backspace so Amazon's
    // form validator and "Ideas" checker always register the field as user-dirty
    if (setter) {
      setter.call(el, value + ' ');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ' ' }));
      setter.call(el, value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward', data: null }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (blurAfter) {
      el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
  }

  function labelOf(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('name') ||
      ''
    ).toLowerCase();
  }

  // ---- Star Rating Fill --------------------------------------------------
  function fillRating(rating) {
    if (!rating) return false;
    let ryp = Array.from(document.querySelectorAll(
      '.in-context-ryp__form-field--starRating [role="radio"], ' +
      '[data-testid="in-context-ryp__form-field--starRating-single"]'
    )).filter(visible);

    if (!ryp.length) {
      const group = Array.from(document.querySelectorAll('[role="radiogroup"]'))
        .find(g => /rating|stars?/i.test(g.getAttribute('aria-label') || ''));
      if (group) ryp = Array.from(group.querySelectorAll('[role="radio"]')).filter(visible);
    }

    if (ryp.length >= rating) {
      const el = ryp[rating - 1];
      el.focus?.({ preventScroll: true });
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.click();
      return true;
    }

    const rx = new RegExp(`(^|[^0-9])${rating}\\s*(out of\\s*5\\s*)?stars?`, 'i');
    const candidates = Array.from(document.querySelectorAll(
      'input[type="radio"],[role="radio"],button,a,[aria-label],[title]'
    )).filter(el => rx.test(el.getAttribute('aria-label') || el.getAttribute('title') || ''));

    const inWidget = candidates.find(el => el.closest(
      '[class*="rating" i],[class*="star" i],[data-hook*="rating" i],[id*="star" i],[id*="rating" i]'
    )) || candidates[0];

    if (inWidget && visible(inWidget)) {
      inWidget.click();
      return true;
    }

    const stars = Array.from(document.querySelectorAll(
      '[class*="star" i] i, i[class*="star" i], [data-hook*="star" i], [class*="star" i] [role="button"], [class*="star" i] svg'
    )).filter(visible);
    if (stars.length >= rating) {
      stars[rating - 1].click();
      return true;
    }
    return false;
  }

  // ---- Headline & Body Fill ----------------------------------------------
  function findTitleElement() {
    let el = document.getElementById('reviewTitle');
    if (!el || !visible(el)) {
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter(visible);
      el = inputs.find(i => /headline|title|summary|sum it up|one[- ]liner/.test(labelOf(i)))
        || inputs.find(i => labelOf(i) === '' && i.maxLength && i.maxLength <= 200)
        || null;
    }
    return el;
  }

  function findBodyElement() {
    let el = document.getElementById('reviewText');
    if (!el || el.tagName !== 'TEXTAREA' || !visible(el)) {
      const areas = Array.from(document.querySelectorAll('textarea')).filter(visible);
      el = areas.find(a => /review|write|think|tell|experience|what did you/.test(labelOf(a)))
        || areas[0]
        || null;
    }
    return el;
  }

  let heldTitle = null;
  function fillTitle(title) {
    if (!title) return false;
    const el = findTitleElement();
    if (el) {
      if (heldTitle !== null) heldTitle = title;
      setReactValue(el, title, { blurAfter: true });
      return true;
    }
    return false;
  }

  /**
   * Protects our headline if Amazon's async "Generating AI title..." finishes a couple
   * seconds later and tries to overwrite #reviewTitle, while stopping immediately
   * if the user clicks or types in #reviewTitle.
   */
  function keepTitle(title, ms = 7000) {
    const el = findTitleElement();
    if (!el || !title) return;
    heldTitle = title;
    let userEdited = false;
    const onUserEdit = () => { userEdited = true; };
    const events = ['keydown', 'beforeinput', 'paste', 'drop', 'cut', 'mousedown'];
    events.forEach(t => el.addEventListener(t, onUserEdit, true));
    const until = Date.now() + ms;
    const timer = setInterval(() => {
      if (userEdited || !el.isConnected || Date.now() > until) {
        clearInterval(timer);
        heldTitle = null;
        events.forEach(t => el.removeEventListener(t, onUserEdit, true));
        return;
      }
      if (el.value !== heldTitle) {
        setReactValue(el, heldTitle, { blurAfter: true });
      }
    }, 400);
  }

  function fillBody(body, { blurAfter = true } = {}) {
    if (!body) return false;
    const el = findBodyElement();
    if (el) {
      setReactValue(el, body, { blurAfter });
      return true;
    }

    const ce = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(visible)[0];
    if (ce) {
      ce.focus({ preventScroll: true });
      ce.textContent = body;
      ce.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  }

  // ---- Batch All-Files-Together Photo Attachment -------------------------
  function b64ToFile(b64, name, mime) {
    const clean = b64.includes(',') ? b64.split(',')[1] : b64;
    const bin = atob(clean);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name || 'photo.jpg', { type: mime || 'image/jpeg', lastModified: Date.now() });
  }

  function getGalleryThumbnails() {
    return [...document.querySelectorAll(
      '#in-context-ryp-form img, [data-hook*="media"] img, [class*="media"] img, [class*="upload"] img, [class*="thumbnail"] img'
    )].filter(el => visible(el) && (el.currentSrc || el.src));
  }

  function findPhotoFileInput() {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    return (
      document.getElementById('media') ||
      inputs.find(i => /image/i.test(i.accept || '') && i.multiple) ||
      inputs.find(i => /image/i.test(i.accept || '')) ||
      inputs[0] ||
      null
    );
  }

  async function attachAllPhotosTogether(images) {
    if (!Array.isArray(images) || !images.length) return { status: 'none', count: 0 };

    const validFiles = [];
    for (let i = 0; i < Math.min(images.length, 12); i++) {
      const im = images[i];
      if (!im?.data) continue;
      try {
        const file = b64ToFile(im.data, im.name || `vine-photo-${i + 1}.jpg`, im.mime || 'image/jpeg');
        if (file.size <= 10 * 1024 * 1024) validFiles.push(file);
      } catch (e) {
        log('Could not decode photo', e);
      }
    }
    if (!validFiles.length) return { status: 'manual', count: 0 };

    const beforeThumbs = new Set(getGalleryThumbnails().map(el => el.currentSrc || el.src));
    const input = findPhotoFileInput();

    // 1. Try Batch Upload (all files together in one DataTransfer)
    if (input && validFiles.length > 1) {
      try {
        const batchDt = new DataTransfer();
        validFiles.forEach(f => batchDt.items.add(f));
        input.files = batchDt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        await waitFor(() => {
          const current = getGalleryThumbnails().filter(el => !beforeThumbs.has(el.currentSrc || el.src));
          return current.length >= validFiles.length;
        }, { timeout: 2200, interval: 200 });
      } catch (e) {
        log('Batch upload fallback to sequential:', e);
      }
    }

    // 2. Check how many thumbnails appeared; attach any remaining sequentially
    const currentNewThumbs = getGalleryThumbnails().filter(el => !beforeThumbs.has(el.currentSrc || el.src));
    if (currentNewThumbs.length >= validFiles.length) {
      return { status: 'attached', count: currentNewThumbs.length };
    }

    let attachedCount = currentNewThumbs.length;
    for (let i = attachedCount; i < validFiles.length; i++) {
      const file = validFiles[i];
      const known = new Set(getGalleryThumbnails().map(el => el.currentSrc || el.src));
      const singleDt = new DataTransfer();
      singleDt.items.add(file);

      const fileInput = findPhotoFileInput();
      if (fileInput) {
        fileInput.files = singleDt.files;
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const zone = document.querySelector('[class*="dropzone" i],[data-hook*="media" i],[aria-label*="photo" i]');
        if (!zone) continue;
        for (const type of ['dragenter', 'dragover', 'drop']) {
          zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: singleDt }));
        }
      }

      const ok = await waitFor(
        () => getGalleryThumbnails().some(el => !known.has(el.currentSrc || el.src)),
        { timeout: 3500, interval: 200 }
      );
      if (ok) attachedCount++;
    }

    const status = attachedCount === validFiles.length
      ? 'attached'
      : attachedCount > 0
        ? 'partial'
        : 'manual';
    return { status, count: attachedCount };
  }

  // ---- Storage / IndexedDB Readers ---------------------------------------
  function readLocalMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return null;
      const meta = JSON.parse(raw);
      if (!meta || meta.consumed || (Date.now() - (meta.ts || 0)) > MAX_AGE_MS) return null;
      return meta;
    } catch {
      return null;
    }
  }

  function readStorageHandoff() {
    return new Promise(resolve => {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return resolve(null);
        chrome.storage.local.get(['vp_review_prefill', 'vp_review_prefill_images'], (res) => {
          const meta = res?.vp_review_prefill;
          if (!meta || meta.consumed || (Date.now() - (meta.ts || 0)) > MAX_AGE_MS) return resolve(null);
          resolve({
            meta,
            images: Array.isArray(res?.vp_review_prefill_images) ? res.vp_review_prefill_images : []
          });
        });
      } catch {
        resolve(null);
      }
    });
  }

  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function readIdbImages(key) {
    try {
      const db = await openIdb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => {
          db.close();
          resolve(req.result?.images || req.result || null);
        };
        req.onerror = () => {
          db.close();
          resolve(null);
        };
      });
    } catch {
      return null;
    }
  }

  // ---- Amazon "Ideas" (Aspects) Parser -----------------------------------
  const GALLERY_SELECTOR = '[data-hook="ryp-aspects-gallery-wrapper"]';
  function parseAmazonIdeas() {
    const wrap = document.querySelector(GALLERY_SELECTOR);
    if (!wrap) return [];
    const out = [];
    for (const cell of wrap.querySelectorAll('.ryp__aspects-gallery__aspect-list__aspect-icon-wrapper')) {
      const span = cell.querySelector('[data-hook="ryp-aspects-gallery-single-aspect"]');
      if (!span) continue;
      const name = (span.textContent || '').replace(/\|/g, '').trim();
      if (!name) continue;
      const checked = !!cell.querySelector('[data-hook="ryp-aspects-gallery-icon-wrapper"]');
      out.push({ name, checked });
    }
    return out.slice(0, 20);
  }

  // ---- Floating VinePilot In-Page Assistant Banner -----------------------
  let cachedImagesForReattach = [];
  let currentPrefilledState = null;
  let weavingIdeas = false;
  let lastRenderedSignature = '';
  let bannerDismissed = false;

  function renderFloatingAssistant(statusInfo = {}, force = false) {
    if (bannerDismissed && !force) return;

    const bodyEl = findBodyElement();
    const titleEl = findTitleElement();
    const liveBody = bodyEl ? bodyEl.value : (statusInfo.body || '');
    const liveTitle = titleEl ? titleEl.value : (statusInfo.title || '');
    const ideas = parseAmazonIdeas();

    // Deduplicate renders so we NEVER cause a DOM mutation loop
    const signature = JSON.stringify({
      liveTitle,
      liveBody,
      ideas,
      weavingIdeas,
      headlineMsg: statusInfo.headlineMsg || '',
      photoMsg: statusInfo.photoMsg || '',
      imgCount: cachedImagesForReattach.length
    });
    if (!force && signature === lastRenderedSignature && document.getElementById('vp-inpage-assistant')) {
      return;
    }
    lastRenderedSignature = signature;

    let container = document.getElementById('vp-inpage-assistant');
    if (!container) {
      container = document.createElement('div');
      container.id = 'vp-inpage-assistant';
      container.style.cssText = [
        'position:fixed',
        'z-index:2147483646',
        'top:14px',
        'right:14px',
        'width:min(360px, calc(100vw - 28px))',
        'background:linear-gradient(145deg, #0f172a, #1e1b4b)',
        'color:#f8fafc',
        'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        'padding:14px 16px',
        'border-radius:14px',
        'box-shadow:0 14px 34px rgba(0,0,0,0.42)',
        'border:1px solid rgba(129,140,248,0.35)'
      ].join(';');
      document.body.appendChild(container);
    }

    const audit = window.VinePilotGuidelines
      ? window.VinePilotGuidelines.evaluateReviewDraft({ title: liveTitle, body: liveBody, rating: statusInfo.rating || 5 })
      : null;

    const tickedIdeas = ideas.filter(a => a.checked).map(a => a.name);
    const missingIdeas = ideas.filter(a => !a.checked).map(a => a.name);

    const safetyBadgeColor = !audit || audit.isSafeToSubmit ? '#10b981' : '#f43f5e';
    const safetyBadgeText = !audit
      ? 'Ready'
      : audit.isSafeToSubmit
        ? `✓ Guidelines Safe (${audit.guidelineScore}%) · Human ${audit.humanScore}%`
        : `⚠️ ${audit.violations.length} Guideline Risk(s) Detected!`;

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:7px;font-weight:700;font-size:13.5px;color:#e0e7ff;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#4f46e5;color:#fff;font-size:12px;">✨</span>
          <span>VinePilot AI Review Guard</span>
        </div>
        <button id="vp-assistant-close" type="button" style="background:none;border:0;color:#94a3b8;cursor:pointer;font-size:18px;line-height:1;">×</button>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
        <span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,0.08);color:${safetyBadgeColor};border:1px solid ${safetyBadgeColor}55;">
          ${safetyBadgeText}
        </span>
        ${audit && audit.wordCount > 0 ? `
          <span style="font-size:11px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,0.08);color:#cbd5e1;">
            Insightfulness: <strong style="color:#a5b4fc;">${audit.insightfulnessLabel}</strong> (${audit.wordCount}w)
          </span>
        ` : ''}
      </div>

      ${statusInfo.headlineMsg ? `<div style="font-size:12px;color:#cbd5e1;margin-bottom:6px;">${statusInfo.headlineMsg}</div>` : ''}
      ${statusInfo.photoMsg ? `<div style="font-size:12px;color:#fde68a;margin-bottom:6px;">${statusInfo.photoMsg}</div>` : ''}

      ${audit && audit.violations.length > 0 ? `
        <div style="background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.4);border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:11.5px;">
          <div style="font-weight:700;color:#fda4af;margin-bottom:4px;">Rejection Prevention Alert:</div>
          ${audit.violations.slice(0, 2).map(v => `
            <div style="margin-bottom:3px;color:#fecdd3;">• <strong>"${v.matchedText}"</strong>: ${v.issue}</div>
          `).join('')}
          <button id="vp-autofix-btn" type="button" style="margin-top:5px;padding:4px 9px;border-radius:6px;border:0;background:#e11d48;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">
            🛡️ 1-Click Auto-Fix Guideline Risks
          </button>
        </div>
      ` : ''}

      ${ideas.length > 0 ? `
        <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:11.5px;">
          ${tickedIdeas.length ? `<div style="color:#6ee7b7;margin-bottom:3px;">✓ <strong>Amazon Ideas Ticked:</strong> ${tickedIdeas.join(', ')}</div>` : ''}
          ${missingIdeas.length ? `<div style="color:#fcd34d;">○ <strong>Unticked Ideas:</strong> ${missingIdeas.join(', ')}</div>` : '<div style="color:#6ee7b7;">🎉 All Amazon Ideas topics covered!</div>'}
        </div>
      ` : ''}

      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
        ${missingIdeas.length > 0 ? `
          <button id="vp-weave-ideas-btn" type="button" ${weavingIdeas ? 'disabled' : ''} style="padding:6px 10px;border-radius:7px;border:1px solid #818cf8;background:#4338ca;color:#fff;font-size:11.5px;font-weight:600;cursor:pointer;">
            ${weavingIdeas ? 'Weaving Ideas…' : '✨ Weave Missing Ideas'}
          </button>
        ` : ''}
        ${cachedImagesForReattach.length > 0 ? `
          <button id="vp-reattach-photos-btn" type="button" style="padding:6px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:#fff;font-size:11.5px;font-weight:600;cursor:pointer;">
            📷 Attach All ${cachedImagesForReattach.length} Photo(s)
          </button>
        ` : ''}
        <button id="vp-open-studio-btn" type="button" style="padding:6px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#e2e8f0;font-size:11.5px;cursor:pointer;">
          🎙️ Studio / 📱 Phone Upload
        </button>
      </div>
    `;

    container.querySelector('#vp-assistant-close')?.addEventListener('click', () => {
      bannerDismissed = true;
      container.remove();
    });

    container.querySelector('#vp-autofix-btn')?.addEventListener('click', () => {
      if (!window.VinePilotGuidelines) return;
      if (bodyEl && bodyEl.value) fillBody(window.VinePilotGuidelines.autoFixText(bodyEl.value));
      if (titleEl && titleEl.value) fillTitle(window.VinePilotGuidelines.autoFixText(titleEl.value));
      renderFloatingAssistant({ ...statusInfo, headlineMsg: '✓ Auto-fixed guideline & AI cliché phrases!' }, true);
    });

    container.querySelector('#vp-reattach-photos-btn')?.addEventListener('click', async () => {
      const btn = container.querySelector('#vp-reattach-photos-btn');
      if (btn) btn.textContent = 'Attaching photos…';
      const res = await attachAllPhotosTogether(cachedImagesForReattach);
      renderFloatingAssistant({
        ...statusInfo,
        photoMsg: res.status === 'attached'
          ? `📷 All ${res.count} photo(s) attached together!`
          : `📷 Attached ${res.count}/${cachedImagesForReattach.length} photo(s).`
      }, true);
    });

    container.querySelector('#vp-weave-ideas-btn')?.addEventListener('click', async () => {
      if (weavingIdeas || !missingIdeas.length) return;
      weavingIdeas = true;
      renderFloatingAssistant(statusInfo, true);
      try {
        const curBody = bodyEl ? bodyEl.value : '';
        const curTitle = titleEl ? titleEl.value : '';
        chrome.runtime.sendMessage({
          type: 'VP_WEAVE_MISSING_IDEAS',
          asin: urlAsin(),
          title: curTitle,
          body: curBody,
          rating: currentPrefilledState?.rating || 5,
          missingIdeas
        }, (res) => {
          weavingIdeas = false;
          if (res?.ok && res.body) {
            fillBody(res.body);
            if (res.title) fillTitle(res.title);
            renderFloatingAssistant({ ...statusInfo, headlineMsg: `✓ Wove missing Ideas (${missingIdeas.join(', ')}) into your review!` }, true);
          } else {
            renderFloatingAssistant({ ...statusInfo, headlineMsg: '⚠️ Could not weave ideas automatically.' }, true);
          }
        });
      } catch {
        weavingIdeas = false;
        renderFloatingAssistant(statusInfo, true);
      }
    });

    container.querySelector('#vp-open-studio-btn')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'VP_OPEN_STUDIO',
        seed: {
          asin: urlAsin(),
          title: document.querySelector('[data-hook="product-link"], .ryp__product-title, h1, h2')?.textContent?.trim() || '',
          reviewUrl: location.href
        }
      });
    });
  }

  // ---- Main Prefill Runner -----------------------------------------------
  (async function runPrefill() {
    // Wait for page load to finish so we never block Amazon's own page scripts or spinners
    if (document.readyState !== 'complete') {
      await new Promise(resolve => {
        window.addEventListener('load', resolve, { once: true });
        setTimeout(resolve, 4000);
      });
    }

    const pageAsin = urlAsin();
    const localMeta = readLocalMeta();
    const storageData = await readStorageHandoff();
    const meta = storageData?.meta || localMeta;

    // Wait for Amazon's review form fields to exist in DOM
    const formReady = await waitFor(() =>
      document.getElementById('reviewText') ||
      document.getElementById('in-context-ryp-form') ||
      document.querySelector('.in-context-ryp__form-field--starRating [role="radio"]') ||
      document.querySelector('textarea')
    );

    if (!formReady) return;

    // Give Amazon's React hydration a moment to settle
    await sleep(800);

    // Attach lightweight input listener to #reviewText and #reviewTitle
    const attachLiveEditorWatcher = () => {
      const bodyEl = findBodyElement();
      const titleEl = findTitleElement();
      if (bodyEl && !bodyEl.__vpWatched) {
        bodyEl.__vpWatched = true;
        let debounceTimer;
        const onEdit = () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            if (document.getElementById('vp-inpage-assistant') || (bodyEl.value && bodyEl.value.length > 20)) {
              renderFloatingAssistant(currentPrefilledState || { headlineMsg: 'Monitoring Community Guidelines in real time.' });
            }
          }, 600);
        };
        bodyEl.addEventListener('input', onEdit);
        titleEl?.addEventListener('input', onEdit);
      }
    };
    attachLiveEditorWatcher();

    if (!meta || (pageAsin && meta.asin && pageAsin !== meta.asin.toUpperCase())) {
      if (isReviewUrl) {
        renderFloatingAssistant({
          headlineMsg: 'Write or paste your review below — live Community Guideline protection is active.'
        });
      }
      return;
    }

    // Mark handoff as consumed so reloading doesn't overwrite user edits
    try { localStorage.removeItem(META_KEY); } catch { /* ignore */ }
    try { chrome.runtime.sendMessage({ type: 'VP_CONSUME_HANDOFF', id: meta.id }); } catch { /* ignore */ }

    // IMPORTANT ORDER TO PREVENT AMAZON'S "Generating AI title..." LOCKING SUBMIT:
    // 1. Set Star Rating
    const okRating = fillRating(meta.rating);
    await sleep(150);

    // 2. Fill Headline FIRST (before #reviewText blurs!) so Amazon sees #reviewTitle is already
    // populated and does NOT kick off its blocking "Generating AI title..." state!
    let okTitle = fillTitle(meta.title);
    await sleep(150);

    // 3. Fill Review Body
    let okBody = fillBody(meta.body, { blurAfter: true });
    await sleep(450);

    const bodyEl = findBodyElement();
    if (meta.body && bodyEl && bodyEl.value !== meta.body) {
      okBody = fillBody(meta.body, { blurAfter: true });
    }

    // 4. Re-confirm Headline & start keepTitle guard so all 3 required fields are valid & Submit enables immediately!
    if (meta.title) {
      okTitle = fillTitle(meta.title);
      keepTitle(meta.title, 7000);
    }

    // 5. Load & Attach All Photos Together
    let images = storageData?.images || [];
    if (!images.length && meta.imageCount > 0) {
      const idbImgs = await readIdbImages('imgs:' + (meta.id || meta.asin || 'NOASIN'));
      if (Array.isArray(idbImgs)) images = idbImgs;
    }
    cachedImagesForReattach = images;

    let photoResult = { status: 'none', count: 0 };
    if (images.length > 0) {
      photoResult = await attachAllPhotosTogether(images);
    }

    const filledParts = [okRating && 'rating', okTitle && 'headline', okBody && 'review'].filter(Boolean);
    let photoMsg = '';
    if (images.length > 0) {
      photoMsg = photoResult.status === 'attached'
        ? `📷 Attached all ${photoResult.count} photo(s) together! Confirm thumbnails below.`
        : photoResult.status === 'partial'
          ? `📷 Attached ${photoResult.count}/${images.length} photo(s). Click "Attach All" below if any missed.`
          : `📷 Click "Attach All ${images.length} Photo(s)" below to insert your photos.`;
    }

    currentPrefilledState = {
      asin: meta.asin || pageAsin,
      rating: meta.rating,
      title: meta.title,
      body: meta.body,
      headlineMsg: `✓ Prefilled: ${filledParts.join(', ')}. Review and click Amazon's Submit.`,
      photoMsg
    };

    renderFloatingAssistant(currentPrefilledState);

    // Watch ONLY Amazon's Ideas gallery (never our own banner!) with a 1200ms debounce
    let ideasTimer = null;
    const ideasObserver = new MutationObserver((records) => {
      const touchedIdeas = records.some(r => {
        const el = r.target?.nodeType === 1 ? r.target : r.target?.parentElement;
        if (!el || el.closest('#vp-inpage-assistant')) return false;
        return !!el.closest(GALLERY_SELECTOR) ||
          Array.from(r.addedNodes || []).some(n => n.nodeType === 1 && (n.matches?.(GALLERY_SELECTOR) || n.querySelector?.(GALLERY_SELECTOR)));
      });
      if (!touchedIdeas) return;
      clearTimeout(ideasTimer);
      ideasTimer = setTimeout(() => {
        if (document.getElementById('vp-inpage-assistant')) {
          renderFloatingAssistant(currentPrefilledState || {});
        }
      }, 1200);
    });

    if (document.body) {
      ideasObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'data-hook']
      });
    }
  })();

  // Listen for direct live-push of photos or review from the Studio
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'VP_LIVE_FILL_ON_PAGE') {
      (async () => {
        if (msg.rating) fillRating(msg.rating);
        if (msg.title) fillTitle(msg.title);
        if (msg.body) fillBody(msg.body, { blurAfter: true });
        if (Array.isArray(msg.images) && msg.images.length) {
          cachedImagesForReattach = msg.images;
          await attachAllPhotosTogether(msg.images);
        }
        if (msg.title) {
          fillTitle(msg.title);
          keepTitle(msg.title);
        }
        currentPrefilledState = {
          rating: msg.rating,
          title: msg.title,
          body: msg.body,
          headlineMsg: '✓ Live-synced from VinePilot Studio!',
          photoMsg: msg.images?.length ? `📷 Attached ${msg.images.length} photo(s)!` : ''
        };
        renderFloatingAssistant(currentPrefilledState, true);
        sendResponse({ ok: true });
      })();
      return true;
    }
  });
})();
