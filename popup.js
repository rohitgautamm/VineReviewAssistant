(function () {
  'use strict';

  let detectedSeed = {};

  async function detectActiveAmazonTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;
      const u = new URL(tab.url);
      if (!/amazon\./i.test(u.hostname)) return;

      detectedSeed.origin = u.origin;
      const asinMatch =
        u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) ||
        u.search.match(/[?&]asin=([A-Z0-9]{10})/i);

      if (asinMatch) {
        detectedSeed.asin = asinMatch[1].toUpperCase();
        detectedSeed.title = (tab.title || '').replace(/^Amazon\.[a-z.]+\s*:\s*/i, '').trim();
        const box = document.getElementById('detected-product');
        if (box) {
          box.style.display = 'block';
          box.textContent = `🎯 Detected ASIN ${detectedSeed.asin} on current tab`;
        }
      }
    } catch { /* ignore */ }
  }

  function buildStudioUrl(extraParams = {}) {
    const url = new URL(chrome.runtime.getURL('studio.html'));
    if (detectedSeed.asin) url.searchParams.set('asin', detectedSeed.asin);
    if (detectedSeed.title) url.searchParams.set('title', detectedSeed.title);
    if (detectedSeed.origin) url.searchParams.set('origin', detectedSeed.origin);
    for (const [k, v] of Object.entries(extraParams)) {
      url.searchParams.set(k, v);
    }
    return url.toString();
  }

  document.getElementById('open-studio-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: buildStudioUrl() });
    window.close();
  });

  document.getElementById('open-sidepanel-btn')?.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (chrome.sidePanel?.open && tab?.id) {
        await chrome.sidePanel.open({ tabId: tab.id });
        window.close();
        return;
      }
    } catch { /* fallback */ }
    chrome.tabs.create({ url: buildStudioUrl({ mode: 'sidepanel' }) });
    window.close();
  });

  document.getElementById('open-phone-bridge-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: buildStudioUrl({ openPhoneQr: '1' }) });
    window.close();
  });

  document.getElementById('open-vine-reviews-btn')?.addEventListener('click', () => {
    const origin = detectedSeed.origin || 'https://www.amazon.com';
    chrome.tabs.create({ url: `${origin}/vine/vine-reviews` });
    window.close();
  });

  detectActiveAmazonTab();
})();
