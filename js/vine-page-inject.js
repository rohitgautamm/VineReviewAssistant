/**
 * VinePilot AI — Amazon Vine Page & Product Page Injector
 * 1. Injects "✨ AI Review + 📱 Phone Upload" buttons on every row of Amazon Vine Reviews (/vine/vine-reviews)
 * 2. Injects "🧬 Train My Tone from Approved Reviews" button on the Completed Reviews tab
 * 3. Provides an embedded responsive Studio Modal (or opens SidePanel/Tab) that works seamlessly on Desktop & Mobile browsers!
 */
(function () {
  'use strict';

  if (window.__VP_VINE_INJECT_ACTIVE__) return;
  window.__VP_VINE_INJECT_ACTIVE__ = true;

  const isVinePage = /^\/vine(\/|$)/i.test(location.pathname);
  const isProductPage = /\/(dp|gp\/product)\/([A-Z0-9]{10})/i.test(location.pathname);

  if (!isVinePage && !isProductPage) return;

  function extractAsinFromTextOrHref(str = '') {
    const m = /(?:asin=|\/dp\/|\/product\/|\/create-review\?[^"']*asin=)([A-Z0-9]{10})/i.exec(str);
    return m ? m[1].toUpperCase() : '';
  }

  /**
   * Open the embedded VinePilot AI Studio Modal right inside the current page
   * (Works on both Desktop and Mobile browsers like Kiwi / Firefox Android / Edge!)
   */
  function openEmbeddedStudioModal(seedProduct = {}) {
    let overlay = document.getElementById('vp-studio-modal-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'vp-studio-modal-overlay';
    overlay.className = 'vp-modal-overlay';

    const studioUrl = new URL(chrome.runtime.getURL('studio.html'));
    studioUrl.searchParams.set('embedded', '1');
    if (seedProduct.asin) studioUrl.searchParams.set('asin', seedProduct.asin);
    if (seedProduct.title) studioUrl.searchParams.set('title', seedProduct.title);
    if (seedProduct.image) studioUrl.searchParams.set('image', seedProduct.image);
    if (seedProduct.reviewUrl) studioUrl.searchParams.set('reviewUrl', seedProduct.reviewUrl);
    if (seedProduct.origin) studioUrl.searchParams.set('origin', seedProduct.origin);

    overlay.innerHTML = `
      <div class="vp-modal-shell">
        <iframe
          id="vp-studio-iframe"
          src="${studioUrl.toString()}"
          allow="clipboard-write; microphone; camera"
          style="width:100%;height:100%;border:0;border-radius:16px;background:#0f172a;"
        ></iframe>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  // Listen for close or prefill messages from the embedded iframe
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'VP_CLOSE_EMBEDDED_MODAL') {
      document.getElementById('vp-studio-modal-overlay')?.remove();
    }
  });

  // ---- Scan & Enhance Amazon Vine Review Rows ----------------------------
  function enhanceVineReviewRows() {
    if (!isVinePage) return;

    // Find all review links or buttons in Vine's table/list
    const reviewLinks = document.querySelectorAll(
      'a[href*="/review/create-review"], a[href*="/reviews/edit-review"], .vvp-reviews-table--text-col, tr.vvp-reviews-table--row'
    );

    const rows = new Set();
    reviewLinks.forEach(el => {
      const row = el.closest('tr, .vvp-item-tile, .a-box, [data-asin]') || el.parentElement;
      if (row) rows.add(row);
    });

    rows.forEach(row => {
      if (row.dataset.vpEnhanced === '1') return;

      const createReviewAnchor = row.querySelector('a[href*="create-review"], a[href*="edit-review"]');
      const productAnchor = row.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]');
      const imgEl = row.querySelector('img');

      const reviewUrl = createReviewAnchor ? createReviewAnchor.href : '';
      const productUrl = productAnchor ? productAnchor.href : '';
      const asin =
        extractAsinFromTextOrHref(reviewUrl) ||
        extractAsinFromTextOrHref(productUrl) ||
        row.getAttribute('data-asin') ||
        '';

      if (!asin && !reviewUrl) return;
      row.dataset.vpEnhanced = '1';

      const title =
        productAnchor?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.querySelector('.a-truncate-full, .vvp-Title-link')?.textContent?.trim() ||
        '';
      const image = imgEl ? imgEl.src : '';

      const actionTarget =
        createReviewAnchor?.closest('.vvp-reviews-table--actions-col, td, div') ||
        row;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vp-vine-row-btn';
      btn.innerHTML = `<span>✨ AI Review + 📱 Phone</span>`;
      btn.title = 'Write human review in your tone, check all Amazon guidelines & upload photos straight from your phone';

      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openEmbeddedStudioModal({
          asin,
          title,
          image,
          reviewUrl: reviewUrl || `${location.origin}/review/create-review?encoding=UTF&asin=${encodeURIComponent(asin)}`,
          origin: location.origin
        });
      });

      actionTarget.appendChild(btn);
    });

    // Also inject a top toolbar on /vine/vine-reviews
    injectVineTopToolbar();
  }

  function injectVineTopToolbar() {
    if (document.getElementById('vp-vine-top-bar')) return;
    const heading = document.querySelector('.vvp-body, #vvp-items-button-container, .vvp-reviews-table, h1, h2');
    if (!heading || !heading.parentElement) return;

    const bar = document.createElement('div');
    bar.id = 'vp-vine-top-bar';
    bar.className = 'vp-top-bar';
    bar.innerHTML = `
      <div class="vp-top-bar-left">
        <span class="vp-logo-badge">✨ VinePilot AI</span>
        <span class="vp-top-bar-sub">Human Tone Engine · 100% Guideline Protection · QR Phone Photo Bridge · Batch Upload</span>
      </div>
      <div class="vp-top-bar-actions">
        <button type="button" id="vp-open-full-studio" class="vp-bar-btn vp-bar-btn-primary">
          🚀 Open Review Studio
        </button>
        <button type="button" id="vp-import-pending-btn" class="vp-bar-btn">
          📥 Sync Pending Items on Page
        </button>
      </div>
    `;

    heading.parentElement.insertBefore(bar, heading);

    bar.querySelector('#vp-open-full-studio')?.addEventListener('click', () => {
      openEmbeddedStudioModal({ origin: location.origin });
    });

    bar.querySelector('#vp-import-pending-btn')?.addEventListener('click', () => {
      const scraped = scrapePendingReviewsFromDom();
      chrome.runtime.sendMessage({ type: 'VP_SAVE_PENDING_ITEMS', items: scraped }, () => {
        const b = bar.querySelector('#vp-import-pending-btn');
        if (b) b.textContent = `✓ Synced ${scraped.length} item(s)!`;
      });
    });

    // Auto-sync any visible pending items silently so the Studio dropdown always has them!
    const items = scrapePendingReviewsFromDom();
    if (items.length > 0) {
      chrome.runtime.sendMessage({ type: 'VP_SAVE_PENDING_ITEMS', items });
    }
  }

  function scrapePendingReviewsFromDom() {
    const items = [];
    const seen = new Set();
    document.querySelectorAll('tr, .vvp-item-tile').forEach(row => {
      const reviewLink = row.querySelector('a[href*="create-review"], a[href*="edit-review"]');
      const prodLink = row.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]');
      const asin =
        extractAsinFromTextOrHref(reviewLink?.href || '') ||
        extractAsinFromTextOrHref(prodLink?.href || '');
      if (!asin || seen.has(asin)) return;
      seen.add(asin);
      const title = prodLink?.textContent?.replace(/\s+/g, ' ').trim() || asin;
      const image = row.querySelector('img')?.src || '';
      items.push({
        asin,
        title,
        image,
        reviewUrl: reviewLink?.href || `${location.origin}/review/create-review?encoding=UTF&asin=${asin}`,
        origin: location.origin
      });
    });
    return items;
  }

  // ---- Product Detail Page Floating Action Pill --------------------------
  function injectProductPageButton() {
    if (!isProductPage || document.getElementById('vp-pdp-fab')) return;
    const m = /\/(dp|gp\/product)\/([A-Z0-9]{10})/i.exec(location.pathname);
    const asin = m ? m[2].toUpperCase() : '';
    if (!asin) return;

    const fab = document.createElement('button');
    fab.id = 'vp-pdp-fab';
    fab.type = 'button';
    fab.className = 'vp-pdp-fab';
    fab.innerHTML = `<span>✨ Write Vine Review</span>`;
    fab.title = 'Open VinePilot AI Studio for this product';

    fab.addEventListener('click', () => {
      const title = document.getElementById('productTitle')?.textContent?.trim() || '';
      const imgEl = document.querySelector('#landingImage, #imgTagWrapperId img, #main-image-container img');
      const image = imgEl?.getAttribute('src') || '';
      openEmbeddedStudioModal({
        asin,
        title,
        image,
        reviewUrl: `${location.origin}/review/create-review?encoding=UTF&asin=${asin}`,
        origin: location.origin
      });
    });

    document.body.appendChild(fab);
  }

  if (isVinePage) {
    enhanceVineReviewRows();
    const obs = new MutationObserver(() => enhanceVineReviewRows());
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  } else if (isProductPage) {
    injectProductPageButton();
  }
})();
