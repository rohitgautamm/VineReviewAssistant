/**
 * VinePilot AI — Review Studio Controller
 * Orchestrates Product Context, Voice Dictation, Personal Voice DNA,
 * Photo Processing + QR Phone Bridge, Multi-AI Review Generation,
 * Live Community Guideline Shield, and 1-Click Amazon Batch Prefill.
 */
(function () {
  'use strict';

  const urlParams = new URLSearchParams(location.search);
  const isEmbedded = urlParams.get('embedded') === '1';

  // Default marketplace origin: prefer URL param, else India (amazon.in) if IST timezone, else amazon.com
  const defaultOrigin = (() => {
    const paramOrigin = urlParams.get('origin');
    if (paramOrigin && /^https?:\/\/[^/]*amazon\./i.test(paramOrigin)) return new URL(paramOrigin).origin;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (/Calcutta|Kolkata|Asia\/Colombo/i.test(tz)) return 'https://www.amazon.in';
    } catch { /* ignore */ }
    return 'https://www.amazon.in';
  })();

  // Persistent cloud room ID so phone stays paired across reviews
  const persistentCloudRoom = (() => {
    try {
      let id = localStorage.getItem('vp_cloud_room');
      if (!id) {
        id = 'vp_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('vp_cloud_room', id);
      }
      return id;
    } catch {
      return 'vp_default';
    }
  })();

  // State
  const state = {
    asin: (urlParams.get('asin') || '').toUpperCase().trim(),
    title: urlParams.get('title') || '',
    description: '',
    image: urlParams.get('image') || '',
    reviewUrl: urlParams.get('reviewUrl') || '',
    origin: defaultOrigin,
    rating: 5,
    recommend: true,
    photos: [], // [{ id, name, mime, data, dataUrl, width, height }]
    pendingItems: [],
    bridgeRoom: 'default',
    cloudRoom: persistentCloudRoom,
    bridgeMode: 'lan', // 'lan' | 'cloud'
    sseSource: null,
    pollTimer: null,
    lastPollTs: Date.now() - 2000,
    seenPacketIds: new Set()
  };

  // DOM Elements
  const el = (id) => document.getElementById(id);

  // Initialize UI
  async function init() {
    if (isEmbedded) {
      el('close-embedded-btn')?.classList.remove('hidden');
      el('close-embedded-btn')?.addEventListener('click', () => {
        window.parent?.postMessage({ type: 'VP_CLOSE_EMBEDDED_MODAL' }, '*');
      });
    }

    // Seed product inputs if passed in URL
    if (state.asin) el('product-asin').value = state.asin;
    if (state.title) el('product-title').value = state.title;
    if (state.image) showProductThumbnail(state.image);

    await loadSettingsAndVoiceDna();
    await loadPendingItems();
    setupPanelToggles();
    setupProductControls();
    setupExperienceControls();
    setupVoiceDictation();
    setupPhotoGridAndDropzone();
    setupPhoneBridge();
    setupAiGenerationAndExternalHandoff();
    setupDraftEditorAndPrefill();

    updateStarsUI(state.rating);
    runLiveGuidelineAudit();

    if (urlParams.get('openPhoneQr') === '1') {
      el('phone-qr-drawer')?.classList.remove('hidden');
    }

    // Always connect to Phone Bridge automatically on load so 2nd/3rd reviews
    // receive phone photos immediately without needing to re-open the QR drawer!
    connectPhoneBridge();
    notifyPhoneBridgeActiveProduct();

    // Auto-fetch product description/bullets if ASIN is provided
    if (state.asin && !state.description) {
      triggerFetchPdp(state.asin, true);
    }
  }

  function showProductThumbnail(src) {
    const img = el('product-thumb');
    if (!img) return;
    if (src) {
      img.src = src;
      img.classList.remove('hidden');
      img.onerror = () => img.classList.add('hidden');
    } else {
      img.classList.add('hidden');
    }
  }

  // ---- 1. Settings & Voice DNA Persistence -------------------------------
  async function loadSettingsAndVoiceDna() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    const data = await chrome.storage.local.get(['vp_settings', 'vp_voice_profile', `vp_draft_${state.asin}`]);

    const settings = data?.vp_settings || {};
    if (settings.aiProvider) el('setting-provider').value = settings.aiProvider;
    if (settings.geminiModel) el('setting-gemini-model').value = settings.geminiModel;
    if (settings.geminiApiKey) el('setting-gemini-key').value = settings.geminiApiKey;
    if (settings.openaiApiKey) el('setting-openai-key').value = settings.openaiApiKey;
    if (settings.anthropicApiKey) el('setting-anthropic-key').value = settings.anthropicApiKey;

    const voice = data?.vp_voice_profile || {};
    if (voice.personaBio) el('voice-persona-bio').value = voice.personaBio;
    if (voice.customInstructions) el('voice-custom-rules').value = voice.customInstructions;
    if (Array.isArray(voice.samples) && voice.samples.length) {
      el('voice-samples-input').value = voice.samples.join('\n---\n');
    }
    if (voice.useProfile !== undefined) {
      el('use-voice-profile').checked = !!voice.useProfile;
    }
    refreshVoiceDnaSummary();

    // Restore saved draft for this ASIN if present
    const savedDraft = state.asin ? data?.[`vp_draft_${state.asin}`] : null;
    if (savedDraft) {
      if (savedDraft.title) el('draft-title').value = savedDraft.title;
      if (savedDraft.body) el('draft-body').value = savedDraft.body;
      if (savedDraft.rating) {
        state.rating = savedDraft.rating;
        updateStarsUI(state.rating);
      }
    }
  }

  function refreshVoiceDnaSummary() {
    const rawSamples = el('voice-samples-input').value
      .split(/\n---\n|\n\n+/)
      .map(s => s.trim())
      .filter(Boolean);
    const dna = window.VinePilotVoice.analyzeVoiceSamples(rawSamples);
    const box = el('voice-dna-summary');
    if (box) {
      box.innerHTML = `<strong>Analyzed Voice DNA (${dna.sampleCount} sample${dna.sampleCount === 1 ? '' : 's'}):</strong> ${dna.styleSummary}`;
    }
  }

  function getActiveVoiceProfileFromUI() {
    const rawSamples = el('voice-samples-input').value
      .split(/\n---\n|\n\n+/)
      .map(s => s.trim())
      .filter(Boolean);
    return {
      useProfile: el('use-voice-profile').checked,
      personaBio: el('voice-persona-bio').value.trim(),
      customInstructions: el('voice-custom-rules').value.trim(),
      samples: rawSamples
    };
  }

  function resetForNewReview(keepProduct = false) {
    if (!keepProduct) {
      state.asin = '';
      state.title = '';
      state.description = '';
      state.image = '';
      state.reviewUrl = '';
      if (el('product-asin')) el('product-asin').value = '';
      if (el('product-title')) el('product-title').value = '';
      if (el('product-description')) el('product-description').value = '';
      showProductThumbnail('');
    }
    state.photos = [];
    renderPhotoGrid();
    if (el('exp-liked')) el('exp-liked').value = '';
    if (el('exp-disliked')) el('exp-disliked').value = '';
    if (el('exp-usage')) el('exp-usage').value = '';
    if (el('exp-notes')) el('exp-notes').value = '';
    if (el('draft-title')) el('draft-title').value = '';
    if (el('draft-body')) el('draft-body').value = '';
    updateStarsUI(5);
    runLiveGuidelineAudit();
    notifyPhoneBridgeActiveProduct();
  }

  function notifyPhoneBridgeActiveProduct() {
    const asin = (el('product-asin')?.value || state.asin || '').trim();
    const title = (el('product-title')?.value || state.title || '').trim();
    if (!asin && !title) return;
    fetch('http://127.0.0.1:3847/api/active-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asin, title })
    }).catch(() => {});
  }

  function setupPanelToggles() {
    const toggle = (panelId) => {
      const target = el(panelId);
      if (!target) return;
      target.classList.toggle('hidden');
    };

    el('clear-all-review-btn')?.addEventListener('click', () => {
      resetForNewReview(false);
    });

    el('toggle-settings-btn')?.addEventListener('click', () => toggle('settings-panel'));
    el('toggle-voice-dna-btn')?.addEventListener('click', () => toggle('voice-dna-panel'));
    el('toggle-guidelines-btn')?.addEventListener('click', () => toggle('guidelines-ref-panel'));

    document.querySelectorAll('.btn-close-panel').forEach(btn => {
      btn.addEventListener('click', () => el(btn.dataset.target)?.classList.add('hidden'));
    });

    el('voice-samples-input')?.addEventListener('input', refreshVoiceDnaSummary);

    el('save-settings-btn')?.addEventListener('click', async () => {
      const vp_settings = {
        aiProvider: el('setting-provider').value,
        geminiModel: el('setting-gemini-model').value,
        geminiApiKey: el('setting-gemini-key').value.trim(),
        openaiApiKey: el('setting-openai-key').value.trim(),
        anthropicApiKey: el('setting-anthropic-key').value.trim()
      };
      await chrome.storage.local.set({ vp_settings });
      const badge = el('settings-saved-msg');
      badge.classList.remove('hidden');
      setTimeout(() => badge.classList.add('hidden'), 2000);
    });

    el('save-voice-dna-btn')?.addEventListener('click', async () => {
      const vp_voice_profile = getActiveVoiceProfileFromUI();
      await chrome.storage.local.set({ vp_voice_profile });
      refreshVoiceDnaSummary();
      const badge = el('voice-saved-msg');
      badge.classList.remove('hidden');
      setTimeout(() => badge.classList.add('hidden'), 2000);
    });
  }

  // ---- 2. Product Details & Pending Picker -------------------------------
  async function loadPendingItems() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    const res = await chrome.storage.local.get('vp_pending_items');
    state.pendingItems = Array.isArray(res?.vp_pending_items) ? res.vp_pending_items : [];
    el('pending-count').textContent = String(state.pendingItems.length);
    renderPendingList('');
  }

  function renderPendingList(query = '') {
    const ul = el('pending-list');
    if (!ul) return;
    const q = query.trim().toLowerCase();
    const filtered = state.pendingItems.filter(it =>
      !q || `${it.title || ''} ${it.asin || ''}`.toLowerCase().includes(q)
    );

    if (!filtered.length) {
      ul.innerHTML = `<li style="padding:10px;color:#94a3b8;font-size:12px;">No synced pending items yet. Open your Amazon Vine Reviews page and click "Sync Pending Items on Page" or enter an ASIN below.</li>`;
      return;
    }

    ul.innerHTML = filtered.slice(0, 80).map(item => `
      <li>
        <button type="button" data-asin="${item.asin}">
          ${item.image ? `<img src="${item.image}" alt="" />` : ''}
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${escapeHtml(item.title || item.asin)}</span>
          <span style="font-size:11px;color:#94a3b8;">${item.asin}</span>
        </button>
      </li>
    `).join('');

    ul.querySelectorAll('button[data-asin]').forEach(btn => {
      btn.addEventListener('click', () => {
        const picked = state.pendingItems.find(x => x.asin === btn.dataset.asin);
        if (!picked) return;
        const isDifferentProduct = state.asin && state.asin !== picked.asin;
        state.asin = picked.asin;
        state.title = picked.title || '';
        state.image = picked.image || '';
        state.reviewUrl = picked.reviewUrl || '';
        state.origin = picked.origin || state.origin;
        state.description = '';

        if (isDifferentProduct) {
          resetForNewReview(true);
        }

        el('product-asin').value = state.asin;
        el('product-title').value = state.title;
        el('product-description').value = '';
        showProductThumbnail(state.image);
        el('pending-picker-box').classList.add('hidden');
        el('tab-product-manual').classList.add('active');
        el('tab-product-pending').classList.remove('active');
        notifyPhoneBridgeActiveProduct();
        triggerFetchPdp(state.asin, true);
      });
    });
  }

  function parsePdpHtmlWithDomParser(html = '') {
    if (!html) return null;
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

      const title = clean(
        doc.querySelector('#productTitle, #title, h1#title span')?.textContent
      );

      const bulletNodes = doc.querySelectorAll(
        '#feature-bullets ul li span.a-list-item, ' +
        '#feature-bullets ul li, ' +
        '#featurebullets_feature_div li span.a-list-item, ' +
        '#productFactsDesktopExpander li span.a-list-item, ' +
        '#productFactsDesktopExpander li, ' +
        '#aboutThisItem li'
      );
      const seen = new Set();
      const bullets = [];
      for (const node of bulletNodes) {
        const txt = clean(node.textContent);
        if (txt && txt.length > 2 && !/^make sure this fits/i.test(txt) && !seen.has(txt)) {
          seen.add(txt);
          bullets.push(txt);
        }
      }

      const overviewRows = doc.querySelectorAll('#productOverview_feature_div tr, #prodDetails tr');
      for (const row of overviewRows) {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const k = clean(cells[0].textContent);
          const v = clean(cells[1].textContent);
          if (k && v && k.length < 40 && v.length < 120) {
            const pair = `${k}: ${v}`;
            if (!seen.has(pair)) {
              seen.add(pair);
              bullets.push(pair);
            }
          }
        }
      }

      const desc = clean(
        doc.querySelector('#productDescription, #aplus_feature_div, #aplus')?.textContent
      ).slice(0, 2000);

      let image = '';
      const imgEl = doc.querySelector('#landingImage, #imgTagWrapperId img, #main-image-container img, #imageBlock img');
      if (imgEl) {
        image = imgEl.getAttribute('data-old-hires') || imgEl.getAttribute('src') || '';
        if (!image) {
          try {
            const dyn = JSON.parse(imgEl.getAttribute('data-a-dynamic-image') || '{}');
            image = Object.keys(dyn)[0] || '';
          } catch { /* ignore */ }
        }
      }
      if (!image) {
        image = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
      }

      const description = [
        bullets.length ? bullets.map(b => `• ${b}`).join('\n') : '',
        desc
      ].filter(Boolean).join('\n\n').slice(0, 4000);

      return { title, description, bullets, image };
    } catch {
      return null;
    }
  }

  function setupProductControls() {
    const mkpSelect = el('product-marketplace');
    if (mkpSelect) {
      mkpSelect.value = state.origin;
      if (!mkpSelect.value) mkpSelect.value = 'https://www.amazon.in';
      mkpSelect.addEventListener('change', () => {
        state.origin = mkpSelect.value;
      });
    }

    // If user pastes a full Amazon URL into ASIN input, extract ASIN + marketplace automatically
    el('product-asin')?.addEventListener('change', () => {
      const val = el('product-asin').value.trim();
      if (/^https?:\/\/[^/]*amazon\./i.test(val)) {
        try {
          const u = new URL(val);
          state.origin = u.origin;
          if (mkpSelect) mkpSelect.value = state.origin;
          const m = u.pathname.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i) ||
                    u.search.match(/[?&]asin=([A-Z0-9]{10})/i);
          if (m) {
            el('product-asin').value = m[1].toUpperCase();
            state.asin = m[1].toUpperCase();
          }
        } catch { /* ignore */ }
      }
    });

    el('tab-product-manual')?.addEventListener('click', () => {
      el('tab-product-manual').classList.add('active');
      el('tab-product-pending').classList.remove('active');
      el('pending-picker-box').classList.add('hidden');
    });

    el('tab-product-pending')?.addEventListener('click', () => {
      el('tab-product-pending').classList.add('active');
      el('tab-product-manual').classList.remove('active');
      el('pending-picker-box').classList.remove('hidden');
      loadPendingItems();
    });

    el('pending-search-input')?.addEventListener('input', (e) => {
      renderPendingList(e.target.value);
    });

    el('fetch-pdp-btn')?.addEventListener('click', () => {
      const asinInput = el('product-asin').value.trim();
      triggerFetchPdp(asinInput, false);
    });

    el('open-amazon-form-btn')?.addEventListener('click', () => {
      const url = getAmazonReviewUrl();
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  async function triggerFetchPdp(asinOrUrl, silent = false) {
    if (!asinOrUrl) {
      if (!silent) showError('Please enter a 10-character Amazon ASIN (e.g. B0...) or paste an Amazon product URL first.');
      return;
    }
    hideError();
    const btn = el('fetch-pdp-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Fetching Listing…';
    }
    try {
      const selectedOrigin = el('product-marketplace')?.value || state.origin;
      chrome.runtime.sendMessage({
        type: 'VP_FETCH_PRODUCT_PDP',
        asin: asinOrUrl,
        origin: selectedOrigin
      }, (res) => {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🔍 Auto-Fetch Listing';
        }
        if (!res?.ok) {
          if (!silent) showError(res?.error || 'Could not auto-fetch listing details.');
          return;
        }

        // Parse HTML with DOMParser if raw html was returned, else use res.product directly
        const parsed = res.html ? parsePdpHtmlWithDomParser(res.html) : null;
        const prod = {
          ...(res.product || {}),
          ...(parsed || {})
        };

        if (prod.asin) {
          state.asin = prod.asin;
          el('product-asin').value = prod.asin;
        }
        if (prod.origin) {
          state.origin = prod.origin;
          if (el('product-marketplace')) el('product-marketplace').value = prod.origin;
        }
        if (prod.title) {
          state.title = prod.title;
          el('product-title').value = prod.title;
        }
        if (prod.description) {
          state.description = prod.description;
          el('product-description').value = prod.description;
        }
        if (prod.image) {
          state.image = prod.image;
          showProductThumbnail(prod.image);
        }

        notifyPhoneBridgeActiveProduct();

        if (!prod.title && !prod.description && !silent) {
          showError('Connected to Amazon, but no listing details were found for this ASIN on the selected marketplace.');
        }
      });
    } catch {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔍 Auto-Fetch Listing';
      }
    }
  }

  function getAmazonReviewUrl() {
    if (state.reviewUrl && /^https?:\/\/[^/]*amazon\./i.test(state.reviewUrl)) {
      return state.reviewUrl;
    }
    const asin = el('product-asin').value.trim().toUpperCase();
    if (!asin) return '';
    return `${state.origin}/review/create-review?encoding=UTF&asin=${encodeURIComponent(asin)}`;
  }

  // ---- 3. Experience Controls & Voice Dictation --------------------------
  function updateStarsUI(rating) {
    state.rating = rating;
    document.querySelectorAll('.star-icon-btn').forEach(btn => {
      const r = Number(btn.dataset.rating);
      btn.classList.toggle('active', r <= rating);
    });
    el('rating-text').textContent = `${rating} of 5 stars`;
  }

  function setupExperienceControls() {
    document.querySelectorAll('.star-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        updateStarsUI(Number(btn.dataset.rating));
        runLiveGuidelineAudit();
      });
    });

    document.querySelectorAll('.chip-btn').forEach(chip => {
      chip.addEventListener('click', () => {
        const targetEl = el(chip.dataset.target);
        if (!targetEl) return;
        const text = chip.dataset.text;
        const cur = targetEl.value.trim();
        if (targetEl.tagName === 'TEXTAREA') {
          targetEl.value = cur ? `${cur}\n• ${text}` : `• ${text}`;
        } else {
          targetEl.value = cur ? `${cur}; ${text}` : text;
        }
        targetEl.focus();
      });
    });

    document.querySelectorAll('.rec-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rec-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const val = btn.dataset.rec;
        state.recommend = val === 'true' ? true : val === 'false' ? false : null;
      });
    });
  }

  function setupVoiceDictation() {
    const btn = el('voice-dictate-btn');
    const label = el('voice-dictate-label');
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRec) {
      btn?.addEventListener('click', () => {
        showError('Browser speech recognition is not supported in this context. You can also dictate from your phone via the QR Phone Bridge!');
      });
      return;
    }

    let recognition = null;
    let isRecording = false;
    let wantRecording = false;
    let silenceTimer = null;
    const SILENCE_LIMIT_MS = 15000;
    const langBtn = el('voice-lang-btn');
    let dictLang = localStorage.getItem('vpDictLang') || 'en-IN';
    const refreshLangBtn = () => { if (langBtn) langBtn.value = dictLang; };
    refreshLangBtn();
    langBtn?.addEventListener('change', () => {
      dictLang = langBtn.value || 'en-IN';
      localStorage.setItem('vpDictLang', dictLang);
      refreshLangBtn();
      if (wantRecording && recognition) { try { recognition.stop(); } catch (e) {} } // restarts with new language
    });

    const resetSilenceTimer = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => stopDictation(), SILENCE_LIMIT_MS);
    };
    const stopDictation = () => {
      wantRecording = false;
      clearTimeout(silenceTimer);
      try { recognition?.stop(); } catch (e) {}
    };
    const uiIdle = () => {
      isRecording = false;
      btn.classList.remove('recording');
      label.textContent = 'Dictate Experience';
    };

    // Mobile browsers (Yandex/Chrome Android) re-emit cumulative text as repeated results
    // when continuous=true. So: one short session per utterance, commit once on end, restart.
    const startRecognition = () => {
      recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = dictLang;
      let buffer = '';

      recognition.onstart = () => {
        isRecording = true;
        btn.classList.add('recording');
        label.textContent = 'Listening… (Click to Stop)';
      };
      recognition.onspeechstart = resetSilenceTimer;

      recognition.onresult = (event) => {
        resetSilenceTimer();
        let acc = '';
        for (let i = 0; i < event.results.length; i++) {
          const piece = (event.results[i][0].transcript || '').trim();
          if (!piece) continue;
          if (!acc || piece.toLowerCase().startsWith(acc.toLowerCase())) acc = piece; // cumulative repeat: replace
          else if (!acc.toLowerCase().endsWith(piece.toLowerCase())) acc += ' ' + piece;
        }
        buffer = acc;
      };

      recognition.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return; // onend will handle
        wantRecording = false;
        clearTimeout(silenceTimer);
      };

      recognition.onend = () => {
        const text = buffer.trim();
        buffer = '';
        if (text) {
          const likedEl = el('exp-liked');
          const cur = likedEl.value.trim();
          const isSpeechCleanup = !el('exp-tone') || el('exp-tone').value === 'speech_cleanup';
          likedEl.value = isSpeechCleanup
            ? (cur ? `${cur} ${text}` : text)
            : (cur ? `${cur}\n• ${text}` : `• ${text}`);
        }
        if (wantRecording) {
          setTimeout(() => { if (wantRecording) { try { startRecognition(); } catch (err) { stopDictation(); uiIdle(); } } }, 250);
          return;
        }
        uiIdle();
      };

      recognition.start();
    };
    btn?.addEventListener('click', () => {
      if (wantRecording) { stopDictation(); return; }
      wantRecording = true;
      resetSilenceTimer();
      startRecognition();
    });
  }
  // ---- 4. Photo Processing, Reordering & Batch Management ----------------
  function setupPhotoGridAndDropzone() {
    const dropzone = el('photo-dropzone');
    const fileInput = el('photo-file-input');

    dropzone?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer?.files?.length) {
        ingestFileList(e.dataTransfer.files);
      }
    });

    const camInput = el('photo-camera-input');
    el('photo-camera-btn')?.addEventListener('click', (e) => { e.stopPropagation(); camInput?.click(); });
    camInput?.addEventListener('change', (e) => {
      if (e.target.files?.length) ingestFileList(e.target.files);
      camInput.value = '';
    });

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files?.length) ingestFileList(e.target.files);
      fileInput.value = '';
    });

    // Global paste support for images!
    window.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) ingestFileList(files);
    });

    el('download-all-photos-btn')?.addEventListener('click', () => {
      state.photos.forEach((p, idx) => {
        window.VinePilotMedia.downloadBase64File(p.name || `vine-photo-${idx + 1}.jpg`, p.data, p.mime);
      });
    });

    el('clear-all-photos-btn')?.addEventListener('click', () => {
      state.photos = [];
      renderPhotoGrid();
    });
  }

  async function ingestFileList(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      if (state.photos.length >= 10) break;
      try {
        const converted = await window.VinePilotMedia.convertImageToJpeg(file);
        state.photos.push({
          id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          ...converted
        });
      } catch (e) {
        console.error('Failed to process photo:', e);
      }
    }
    renderPhotoGrid();
  }

  function addRemoteConvertedImages(images = []) {
    for (const im of images) {
      if (!im?.data) continue;
      // Avoid duplicate base64 photo in current grid
      if (state.photos.some(existing => existing.data === im.data)) continue;
      // If 10 photos were already sitting in grid from an earlier review, shift the oldest out
      if (state.photos.length >= 10) {
        state.photos.shift();
      }
      state.photos.push({
        id: 'phone_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: im.name || 'phone-photo.jpg',
        mime: im.mime || 'image/jpeg',
        data: im.data,
        dataUrl: `data:${im.mime || 'image/jpeg'};base64,${im.data}`,
        width: im.width || 0,
        height: im.height || 0,
        fromPhone: true
      });
    }
    renderPhotoGrid();
  }

  let dragSrcIdx = -1;
  function renderPhotoGrid() {
    const grid = el('photo-grid');
    const countBadge = el('photo-count-badge');
    const dlAllBtn = el('download-all-photos-btn');
    const copySheetBtn = el('copy-contact-sheet-btn');
    const clearBtn = el('clear-all-photos-btn');

    countBadge.textContent = `${state.photos.length}/10`;
    dlAllBtn?.classList.toggle('hidden', state.photos.length === 0);
    copySheetBtn?.classList.toggle('hidden', state.photos.length === 0);
    clearBtn?.classList.toggle('hidden', state.photos.length === 0);

    if (!state.photos.length) {
      grid.classList.add('hidden');
      grid.innerHTML = '';
      return;
    }

    grid.classList.remove('hidden');
    grid.innerHTML = state.photos.map((p, idx) => `
      <div class="photo-tile" draggable="true" data-idx="${idx}">
        <img src="${p.dataUrl}" alt="${escapeHtml(p.name)}" />
        <span class="tile-badge-jpeg">${p.fromPhone ? '📱 Phone JPEG' : 'JPEG ✓'}</span>
        <span class="tile-badge-index">${idx + 1}</span>
        <div class="tile-actions">
          <button type="button" class="tile-btn" data-action="rotate" data-idx="${idx}" title="Rotate 90°">↻</button>
          <button type="button" class="tile-btn" data-action="flip" data-idx="${idx}" title="Flip Horizontally">⇄</button>
          <button type="button" class="tile-btn" data-action="remove" data-idx="${idx}" title="Remove">✕</button>
        </div>
      </div>
    `).join('');

    // Wire up tile actions & drag-to-reorder
    grid.querySelectorAll('.photo-tile').forEach(tile => {
      const idx = Number(tile.dataset.idx);
      tile.addEventListener('dragstart', () => { dragSrcIdx = idx; });
      tile.addEventListener('dragover', (e) => e.preventDefault());
      tile.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragSrcIdx >= 0 && dragSrcIdx !== idx) {
          const [moved] = state.photos.splice(dragSrcIdx, 1);
          state.photos.splice(idx, 0, moved);
          dragSrcIdx = -1;
          renderPhotoGrid();
        }
      });
    });

    grid.querySelectorAll('.tile-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        const action = btn.dataset.action;
        const item = state.photos[idx];
        if (!item) return;

        if (action === 'remove') {
          state.photos.splice(idx, 1);
          renderPhotoGrid();
        } else if (action === 'rotate') {
          const rotated = await window.VinePilotMedia.rotateBase64Image(item.data, item.mime, 90);
          state.photos[idx] = { ...item, ...rotated };
          renderPhotoGrid();
        } else if (action === 'flip') {
          const flipped = await window.VinePilotMedia.flipBase64Image(item.data, item.mime);
          state.photos[idx] = { ...item, ...flipped };
          renderPhotoGrid();
        }
      });
    });
  }

  // ---- 5. Direct Phone-to-Laptop QR Bridge (Local Wi-Fi + Cloud Relay) ---
  function setupPhoneBridge() {
    const openBtn = el('open-phone-qr-btn');
    const drawer = el('phone-qr-drawer');

    openBtn?.addEventListener('click', () => {
      drawer.classList.toggle('hidden');
      if (!drawer.classList.contains('hidden')) {
        connectPhoneBridge();
      }
    });

    el('refresh-bridge-btn')?.addEventListener('click', () => {
      state.bridgeMode = 'lan';
      connectPhoneBridge();
    });

    el('switch-cloud-relay-btn')?.addEventListener('click', () => {
      state.bridgeMode = state.bridgeMode === 'lan' ? 'cloud' : 'lan';
      connectPhoneBridge();
    });

    el('copy-bridge-url-btn')?.addEventListener('click', async () => {
      const url = el('phone-bridge-url').value;
      if (!url) return;
      await navigator.clipboard.writeText(url);
      el('copy-bridge-url-btn').textContent = 'Copied!';
      setTimeout(() => { el('copy-bridge-url-btn').textContent = 'Copy Link'; }, 1500);
    });
  }

  async function connectPhoneBridge() {
    const statusPill = el('qr-status-pill');
    const urlInput = el('phone-bridge-url');
    const qrImg = el('phone-qr-img');
    const descEl = el('qr-mode-desc');

    if (state.sseSource) {
      state.sseSource.close();
      state.sseSource = null;
    }
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }

    if (state.bridgeMode === 'lan') {
      try {
        const res = await fetch(`http://127.0.0.1:3847/api/info?room=${encodeURIComponent(state.bridgeRoom)}`);
        const info = await res.json();
        if (info?.ok && info.mobileUrl) {
          urlInput.value = info.mobileUrl;
          qrImg.src = window.VinePilotQR.toSvgDataUrl(info.mobileUrl);
          statusPill.textContent = `● Live Local Wi-Fi (${info.ip})`;
          descEl.textContent = 'Scan once with your phone camera (same Wi-Fi). Your phone stays paired for all future reviews automatically!';

          // 1) Subscribe to live SSE stream from phone-bridge/server.js
          const sse = new EventSource(`http://127.0.0.1:3847/api/events?room=${encodeURIComponent(state.bridgeRoom)}`);
          sse.onmessage = (ev) => {
            try {
              const packet = JSON.parse(ev.data);
              handleIncomingPhonePacket(packet);
            } catch { /* ignore */ }
          };
          state.sseSource = sse;

          // 2) Also poll /api/poll every 2 seconds as a rock-solid backup so 2nd/3rd review uploads never miss!
          state.pollTimer = setInterval(async () => {
            try {
              const pollRes = await fetch(`http://127.0.0.1:3847/api/poll?since=${state.lastPollTs}`);
              const pollData = await pollRes.json();
              if (pollData?.ok && Array.isArray(pollData.packets)) {
                for (const pkt of pollData.packets) {
                  if (pkt.ts && pkt.ts > state.lastPollTs) {
                    state.lastPollTs = pkt.ts;
                  }
                  handleIncomingPhonePacket(pkt);
                }
              }
            } catch { /* ignore */ }
          }, 2000);
          return;
        }
      } catch {
        // Local server not running yet — fall back to showing local LAN instructions + Cloud Relay QR
      }
    }

    // Fallback or explicit Cloud Relay mode (ntfy.sh SSE channel with persistent room ID)
    const cloudTopic = `vinepilot_${state.cloudRoom}`;
    const cloudReceiverInfo = `https://ntfy.sh/${cloudTopic}`;
    urlInput.value = cloudReceiverInfo;
    qrImg.src = window.VinePilotQR.toSvgDataUrl(cloudReceiverInfo);
    statusPill.textContent = '☁️ Cloud Relay / Start Local Bridge';
    descEl.textContent = 'For full Camera & Multi-Photo Mobile Web App over Wi-Fi, double-click start-phone-bridge.bat (or run node phone-bridge/server.js) and click Re-check!';

    try {
      const sse = new EventSource(`https://ntfy.sh/${cloudTopic}/sse`);
      sse.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.message) {
            const parsed = JSON.parse(msg.message);
            handleIncomingPhonePacket(parsed);
          }
        } catch { /* ignore */ }
      };
      state.sseSource = sse;
    } catch { /* ignore */ }
  }

  function handleIncomingPhonePacket(packet) {
    if (!packet) return;

    // Deduplicate packets received via both SSE and /api/poll
    const pktId = packet.id || (packet.ts ? `ts_${packet.ts}` : null);
    if (pktId) {
      if (state.seenPacketIds.has(pktId)) return;
      state.seenPacketIds.add(pktId);
    }
    if (packet.ts && packet.ts > state.lastPollTs) {
      state.lastPollTs = packet.ts;
    }

    if (Array.isArray(packet.images) && packet.images.length) {
      addRemoteConvertedImages(packet.images);
      el('qr-status-pill').textContent = `✓ Received ${packet.images.length} photo(s) from phone!`;
    }
    if (packet.notes) {
      const n = packet.notes;
      if (n.rating) updateStarsUI(Number(n.rating));
      if (n.liked) {
        const cur = el('exp-liked').value.trim();
        el('exp-liked').value = cur ? `${cur}\n${n.liked}` : n.liked;
      }
      if (n.disliked) {
        const cur = el('exp-disliked').value.trim();
        el('exp-disliked').value = cur ? `${cur}\n${n.disliked}` : n.disliked;
      }
      if (n.usage && !el('exp-usage').value.trim()) {
        el('exp-usage').value = n.usage;
      }
      el('qr-status-pill').textContent = '✓ Synced notes & rating from phone!';
    }
  }

  // ---- 6. AI Review Generation & External AI Handoff ---------------------
  function buildCurrentPayload() {
    return {
      product: {
        asin: el('product-asin').value.trim().toUpperCase(),
        title: el('product-title').value.trim(),
        description: el('product-description').value.trim()
      },
      context: {
        rating: state.rating,
        liked: el('exp-liked').value.trim(),
        disliked: el('exp-disliked').value.trim(),
        usage: el('exp-usage').value.trim(),
        notes: el('exp-notes').value.trim(),
        rawTitle: el('draft-title')?.value.trim() || '',
        rawDraft: el('draft-body')?.value.trim() || '',
        recommend: state.recommend,
        tone: el('exp-tone').value,
        length: el('exp-length').value
      },
      voiceProfile: getActiveVoiceProfileFromUI(),
      images: state.photos.map(p => ({ name: p.name, mime: p.mime, data: p.data }))
    };
  }

  function setupAiGenerationAndExternalHandoff() {
    const genBtn = el('generate-review-btn');
    const genText = el('generate-btn-text');

    el('exp-tone')?.addEventListener('change', () => {
      if (!genText) return;
      genText.textContent = el('exp-tone').value === 'speech_cleanup'
        ? 'Fix Speech-to-Text (Spelling & Context Only — Add Nothing)'
        : 'Generate Authentic Review in My Tone';
    });

    genBtn?.addEventListener('click', () => {
      hideError();
      const payload = buildCurrentPayload();
      const hasUserInput = payload.context.liked || payload.context.disliked || payload.context.usage || payload.context.notes || payload.context.rawDraft;
      if (payload.context.tone === 'speech_cleanup' && !hasUserInput) {
        showError('Please dictate or type your speech-to-text review first so the AI can fix spelling & out-of-context words.');
        return;
      }
      if (!payload.product.title && !payload.product.description && !hasUserInput) {
        showError('Please enter your speech-to-text notes or product details first.');
        return;
      }

      genBtn.disabled = true;
      genText.textContent = payload.context.tone === 'speech_cleanup'
        ? 'Fixing Spelling & Context Words…'
        : 'Generating in Your Voice…';

      chrome.runtime.sendMessage({
        type: 'VP_GENERATE_REVIEW',
        payload
      }, (res) => {
        genBtn.disabled = false;
        genText.textContent = el('exp-tone')?.value === 'speech_cleanup'
          ? 'Fix Speech-to-Text (Spelling & Context Only — Add Nothing)'
          : 'Regenerate Review in My Tone';

        if (!res?.ok || !res.review) {
          showError(res?.error || 'Could not generate review.');
          return;
        }

        el('draft-title').value = res.review.title || '';
        el('draft-body').value = res.review.body || '';
        saveDraftLocally();
        runLiveGuidelineAudit();
        el('result-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Copy External AI Prompt
    el('copy-ext-prompt-btn')?.addEventListener('click', async () => {
      const payload = buildCurrentPayload();
      const prompt = window.VinePilotVoice.buildReviewPrompt(payload);
      await navigator.clipboard.writeText(prompt);
      const b = el('copy-ext-prompt-btn');
      b.textContent = '✓ Prompt Copied!';
      setTimeout(() => { b.textContent = '📋 Copy Prompt'; }, 1800);
    });

    // Copy Numbered Contact Sheet of All Photos
    el('copy-contact-sheet-btn')?.addEventListener('click', async () => {
      const blob = await window.VinePilotMedia.buildContactSheetBlob(state.photos);
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        const b = el('copy-contact-sheet-btn');
        b.textContent = '✓ Contact Sheet Copied — Paste in AI!';
        setTimeout(() => { b.textContent = '🖼️ Copy Photos Sheet'; }, 2200);
      } catch {
        const reader = new FileReader();
        reader.onload = () => {
          const b64 = String(reader.result).split(',')[1];
          window.VinePilotMedia.downloadBase64File('vinepilot-contact-sheet.png', b64, 'image/png');
        };
        reader.readAsDataURL(blob);
      }
    });

    // External AI Launchers
    const extUrls = {
      chatgpt: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`,
      claude: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`,
      gemini: () => `https://gemini.google.com/app`
    };

    document.querySelectorAll('.btn-ext-ai').forEach(btn => {
      btn.addEventListener('click', async () => {
        const payload = buildCurrentPayload();
        const prompt = window.VinePilotVoice.buildReviewPrompt(payload);
        await navigator.clipboard.writeText(prompt);
        const key = btn.dataset.ai;
        const targetUrl = extUrls[key] ? extUrls[key](prompt.slice(0, 5000)) : 'https://chatgpt.com/';
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      });
    });
  }

  // ---- 7. Live Guideline Shield, Draft Editor & 1-Click Amazon Prefill ---
  function setupDraftEditorAndPrefill() {
    const titleEl = el('draft-title');
    const bodyEl = el('draft-body');

    const onDraftChange = () => {
      saveDraftLocally();
      runLiveGuidelineAudit();
    };

    titleEl?.addEventListener('input', onDraftChange);
    bodyEl?.addEventListener('input', onDraftChange);

    // Smart Paste: If pasting into empty body and first line is a headline, auto-split!
    bodyEl?.addEventListener('paste', (e) => {
      if (titleEl.value.trim() || bodyEl.value.trim()) return;
      const text = e.clipboardData?.getData('text/plain') || '';
      // Also check if pasted JSON
      if (text.trim().startsWith('{')) {
        try {
          const obj = JSON.parse(text.trim());
          if (obj.title && obj.body) {
            e.preventDefault();
            titleEl.value = obj.title;
            bodyEl.value = obj.body;
            onDraftChange();
            return;
          }
        } catch { /* fall through */ }
      }
      const splitMatch = text.match(/^\s*(.+?)\s*\r?\n\s*\r?\n([\s\S]+)$/);
      if (splitMatch && splitMatch[1].length < 140) {
        e.preventDefault();
        titleEl.value = splitMatch[1].replace(/^(headline|title)\s*[:—-]\s*/i, '').trim();
        bodyEl.value = splitMatch[2].trim();
        onDraftChange();
      }
    });

    el('autofix-draft-btn')?.addEventListener('click', () => {
      titleEl.value = window.VinePilotGuidelines.autoFixText(titleEl.value);
      bodyEl.value = window.VinePilotGuidelines.autoFixText(bodyEl.value);
      onDraftChange();
    });

    el('copy-title-btn')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(titleEl.value);
      el('copy-title-btn').textContent = '✓ Copied!';
      setTimeout(() => { el('copy-title-btn').textContent = 'Copy Headline'; }, 1500);
    });

    el('copy-body-btn')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(bodyEl.value);
      el('copy-body-btn').textContent = '✓ Copied!';
      setTimeout(() => { el('copy-body-btn').textContent = 'Copy Review'; }, 1500);
    });

    el('copy-both-btn')?.addEventListener('click', async () => {
      const combined = `${titleEl.value.trim()}\n\n${bodyEl.value.trim()}`.trim();
      await navigator.clipboard.writeText(combined);
      el('copy-both-btn').textContent = '✓ Copied Both!';
      setTimeout(() => { el('copy-both-btn').textContent = '📋 Copy Headline + Review'; }, 1500);
    });

    el('prefill-amazon-btn')?.addEventListener('click', triggerPrefillOnAmazon);
  }

  function runLiveGuidelineAudit() {
    const title = el('draft-title').value;
    const body = el('draft-body').value;
    const audit = window.VinePilotGuidelines.evaluateReviewDraft({
      title,
      body,
      rating: state.rating
    });

    el('draft-word-count').textContent = `${audit.wordCount} word${audit.wordCount === 1 ? '' : 's'}`;

    const badgeGuideline = el('badge-guideline');
    const badgeHuman = el('badge-human');
    const badgeInsight = el('badge-insight');

    if (audit.isSafeToSubmit) {
      badgeGuideline.className = 'score-pill score-safe';
      badgeGuideline.textContent = `🛡️ Guidelines: ${audit.guidelineScore}% Safe`;
    } else {
      badgeGuideline.className = 'score-pill score-danger';
      badgeGuideline.textContent = `⚠️ ${audit.violations.length} Guideline Risk(s)`;
    }

    badgeHuman.textContent = audit.wordCount > 0 ? `🧬 Human Voice: ${audit.humanScore}%` : '🧬 Human Voice: --';
    badgeInsight.textContent = audit.wordCount > 0 ? `📊 Insightfulness: ${audit.insightfulnessLabel}` : '📊 Insightfulness: --';

    // Render Violation & AI Cliché Alerts
    const alertBox = el('guideline-alerts-box');
    if (audit.violations.length > 0 || audit.aiWarnings.length > 0) {
      alertBox.classList.remove('hidden');
      let html = '';
      for (const v of audit.violations) {
        html += `
          <div class="violation-item">
            <strong style="color:#fda4af;">🚫 ${escapeHtml(v.categoryTitle)}:</strong>
            Matched <mark style="background:#f43f5e33;color:#fecdd3;padding:1px 5px;border-radius:4px;">"${escapeHtml(v.matchedText)}"</mark>
            — ${escapeHtml(v.issue)}
            <div style="color:#cbd5e1;font-size:11.5px;margin-top:2px;">💡 <em>${escapeHtml(v.suggestion)}</em></div>
          </div>
        `;
      }
      if (audit.aiWarnings.length > 0) {
        const words = [...new Set(audit.aiWarnings.map(w => `"${w.matchedText}"`))].join(', ');
        html += `
          <div class="violation-item">
            <strong style="color:#fde68a;">🤖 AI Cliché / Punctuation Detected:</strong> ${escapeHtml(words)}
            <span style="color:#cbd5e1;font-size:11.5px;"> — Click "Scrub AI Clichés & Guideline Risks" below to replace automatically.</span>
          </div>
        `;
      }
      alertBox.innerHTML = html;
    } else {
      alertBox.classList.add('hidden');
      alertBox.innerHTML = '';
    }

    // Render Constructive Strengths & Suggestions
    const feedbackBox = el('quality-feedback-box');
    if (audit.wordCount >= 15) {
      feedbackBox.classList.remove('hidden');
      let fbHtml = '';
      if (audit.strengths.length) {
        fbHtml += `<div style="color:#6ee7b7;margin-bottom:4px;">${audit.strengths.map(s => `✓ ${escapeHtml(s)}`).join(' · ')}</div>`;
      }
      if (audit.suggestions.length) {
        fbHtml += `<div style="color:#fcd34d;">${audit.suggestions.map(s => `💡 <strong>Tip:</strong> ${escapeHtml(s.issue)} <em>(${escapeHtml(s.question)})</em>`).join('<br/>')}</div>`;
      }
      feedbackBox.innerHTML = fbHtml;
    } else {
      feedbackBox.classList.add('hidden');
    }
  }

  async function saveDraftLocally() {
    const asin = el('product-asin').value.trim().toUpperCase();
    if (!asin || typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({
      [`vp_draft_${asin}`]: {
        asin,
        title: el('draft-title').value,
        body: el('draft-body').value,
        rating: state.rating,
        updatedAt: Date.now()
      }
    });
  }

  async function triggerPrefillOnAmazon() {
    const asin = el('product-asin').value.trim().toUpperCase();
    const title = el('draft-title').value.trim();
    const body = el('draft-body').value.trim();

    if (!body) {
      showError('Please generate or write your review body before prefilling Amazon.');
      return;
    }

    const reviewUrl = getAmazonReviewUrl();
    if (!reviewUrl) {
      showError('Please enter the 10-character product ASIN in Section 1 so VinePilot knows which Amazon review form to open.');
      return;
    }

    const handoffId = crypto.randomUUID();
    const meta = {
      id: handoffId,
      asin,
      origin: state.origin,
      rating: state.rating,
      title,
      body,
      imageCount: state.photos.length,
      ts: Date.now()
    };

    const imagesPayload = state.photos.map(p => ({
      name: p.name,
      mime: p.mime || 'image/jpeg',
      data: p.data
    }));

    // Save to IndexedDB + chrome.storage.local for cross-tab handoff
    await window.VinePilotMedia.saveImagesToIdb('imgs:' + handoffId, imagesPayload);

    chrome.runtime.sendMessage({
      type: 'VP_STASH_HANDOFF',
      meta,
      images: imagesPayload
    }, () => {
      window.open(reviewUrl, '_blank', 'noopener,noreferrer');
      el('prefill-status-msg').textContent = `✓ Opened Amazon Review Form with ${imagesPayload.length} photo(s) queued for batch upload!`;
    });
  }

  function showError(msg) {
    const box = el('generate-error-box');
    if (!box) return;
    box.textContent = '⚠️ ' + msg;
    box.classList.remove('hidden');
  }

  function hideError() {
    el('generate-error-box')?.classList.add('hidden');
  }

  function escapeHtml(s = '') {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
