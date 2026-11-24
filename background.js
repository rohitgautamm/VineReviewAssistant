/**
 * VinePilot AI — Background Service Worker (Manifest V3)
 * Handles AI review generation (Gemini 3.8 Flash / Gemini 4 Argon / OpenAI / Claude / Local Synthesizer),
 * multimodal photo analysis, Amazon PDP scraping, and cross-tab review + batch photo handoff.
 */

import './js/guidelines-engine.js';
import './js/voice-dna.js';

const DEFAULT_SETTINGS = {
  aiProvider: 'gemini', // 'gemini' | 'openai' | 'anthropic' | 'local'
  geminiModel: 'gemini-3.8-flash', // 'gemini-3.8-flash' | 'gemini-4-argon' | 'gemini-3.5-flash-lite'
  geminiApiKey: '',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  anthropicApiKey: '',
  anthropicModel: 'claude-3-7-sonnet-latest',
  phoneBridgePort: 3847
};

async function getSettings() {
  const res = await chrome.storage.local.get('vp_settings');
  return { ...DEFAULT_SETTINGS, ...(res?.vp_settings || {}) };
}

async function getVoiceProfile() {
  const res = await chrome.storage.local.get('vp_voice_profile');
  return res?.vp_voice_profile || {
    useProfile: true,
    personaBio: '',
    customInstructions: '',
    samples: []
  };
}

// Parse JSON from LLM response even if wrapped in ```json fences
function parseReviewJson(rawText = '') {
  const text = String(rawText || '').trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text;
  try {
    const obj = JSON.parse(candidate);
    if (obj && (obj.body || obj.title)) {
      return {
        title: String(obj.title || '').replace(/^[""]|[""]$/g, '').trim(),
        body: String(obj.body || '').trim()
      };
    }
  } catch {
    // Fallback: locate first { ... }
    const braceStart = candidate.indexOf('{');
    const braceEnd = candidate.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      try {
        const obj = JSON.parse(candidate.slice(braceStart, braceEnd + 1));
        if (obj && (obj.body || obj.title)) {
          return {
            title: String(obj.title || '').trim(),
            body: String(obj.body || '').trim()
          };
        }
      } catch { /* fallback to line split */ }
    }
  }
  // Line-based fallback: first line = headline, rest = body
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length >= 2) {
    return {
      title: lines[0].replace(/^(headline|title)\s*[:—-]\s*/i, '').replace(/^#+\s*/, '').trim(),
      body: lines.slice(1).join('\n\n').trim()
    };
  }
  return { title: 'My Hands-On Experience', body: text };
}

/**
 * Call Google Gemini API (Supports gemini-3.8-flash and gemini-4-argon with multimodal product photos)
 */
async function callGeminiApi({ apiKey, model, prompt, images = [] }) {
  const modelName = model || 'gemini-3.8-flash';
  const parts = [{ text: prompt }];

  // Attach up to 4 product photos for visual detail grounding
  for (const img of (images || []).slice(0, 4)) {
    if (img?.data) {
      parts.push({
        inline_data: {
          mime_type: img.mime || 'image/jpeg',
          data: img.data
        }
      });
    }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.75,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API Error (${res.status}): ${errText.slice(0, 220)}`);
  }

  const data = await res.json();
  const outputText = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!outputText) throw new Error('Empty response from Gemini API');
  return parseReviewJson(outputText);
}

/**
 * Call OpenAI API
 */
async function callOpenAiApi({ apiKey, model, prompt, images = [] }) {
  const content = [{ type: 'text', text: prompt }];
  for (const img of (images || []).slice(0, 4)) {
    if (img?.data) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${img.mime || 'image/jpeg'};base64,${img.data}` }
      });
    }
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      temperature: 0.75
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI API Error (${res.status}): ${errText.slice(0, 220)}`);
  }
  const data = await res.json();
  return parseReviewJson(data?.choices?.[0]?.message?.content || '');
}

/**
 * Call Anthropic Claude API
 */
async function callAnthropicApi({ apiKey, model, prompt, images = [] }) {
  const content = [];
  for (const img of (images || []).slice(0, 4)) {
    if (img?.data) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mime || 'image/jpeg',
          data: img.data
        }
      });
    }
  }
  content.push({ type: 'text', text: prompt });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || 'claude-3-7-sonnet-latest',
      max_tokens: 1024,
      messages: [{ role: 'user', content }]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API Error (${res.status}): ${errText.slice(0, 220)}`);
  }
  const data = await res.json();
  const text = data?.content?.map(c => c.text || '').join('') || '';
  return parseReviewJson(text);
}

const HINGLISH_WORDS = new Set(['hai','hain','hoon','hun','nahi','nahin','bahut','bahot','acchi','achhi','accha','acha','acche','ka','ki','ke','ko','mein','main','maine','aur','se','kar','karti','karta','raha','rahi','jyada','zyada','lekin','bhi','to','yah','yeh','ye','woh','vo','uski','uska','iska','iski','mera','meri','mujhe','hota','hoti','kaam','bilkul','thoda','kuch','ek','par','pe','liye','jab','tab','ji','sabse','baat','bahar','raat','roshani','jisse','toh','wala','wali','tha','thi','gaya','gayi','lagaya','sahi','badhiya','zabardast']);
function looksHindi(text = '') {
  if (/[\u0900-\u0DFF]/.test(text)) return true;
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length < 3) return false;
  const hits = words.filter(w => HINGLISH_WORDS.has(w) && !['to','se','ek','par','pe','main','ji','ye','ka','ko','ki','ke','kar'].includes(w) || ['ka','ki','ke','ko','mein','aur','hai','nahi','bahut'].includes(w)).length;
  return hits >= 3 || hits / words.length > 0.2;
}
async function withHindiRetry(inputIsHindi, prompt, call) {
  let review = await call(prompt);
  if (!inputIsHindi) return review;
  for (let i = 0; i < 2 && looksHindi(`${review.title || ''} ${review.body || ''}`); i++) {
    review = await call(prompt + '\n\nIMPORTANT: Your previous answer still contained Hindi/Hinglish. Translate EVERYTHING into plain English now. Output JSON only, English words only, no Devanagari, no Hindi words written in English letters.');
  }
  if (looksHindi(`${review.title || ''} ${review.body || ''}`)) throw new Error('Translation to English failed, please tap Generate again.');
  return review;
}
/**
 * Generate a review using configured AI provider or local human synthesizer
 */
async function handleGenerateReview(payload) {
  const settings = await getSettings();
  const voiceProfile = payload.voiceProfile || (await getVoiceProfile());
  const prompt = globalThis.VinePilotVoice.buildReviewPrompt({
    product: payload.product || {},
    context: payload.context || {},
    voiceProfile,
    aspects: payload.aspects || []
  });

  let review = null;
  let usedProvider = 'local';
  const inputText = JSON.stringify(payload.context || {});
  const inputIsHindi = looksHindi(inputText.replace(/[{}"\\]/g, ' '));

  if (settings.aiProvider === 'gemini' && settings.geminiApiKey?.trim()) {
    review = await withHindiRetry(inputIsHindi, prompt, (pr) => callGeminiApi({
      apiKey: settings.geminiApiKey.trim(),
      model: settings.geminiModel,
      prompt: pr,
      images: payload.images || []
    }));
    usedProvider = `Gemini (${settings.geminiModel})`;
  } else if (settings.aiProvider === 'openai' && settings.openaiApiKey?.trim()) {
    review = await withHindiRetry(inputIsHindi, prompt, (pr) => callOpenAiApi({
      apiKey: settings.openaiApiKey.trim(),
      model: settings.openaiModel,
      prompt: pr,
      images: payload.images || []
    }));
    usedProvider = `OpenAI (${settings.openaiModel})`;
  } else if (settings.aiProvider === 'anthropic' && settings.anthropicApiKey?.trim()) {
    review = await withHindiRetry(inputIsHindi, prompt, (pr) => callAnthropicApi({
      apiKey: settings.anthropicApiKey.trim(),
      model: settings.anthropicModel,
      prompt: pr,
      images: payload.images || []
    }));
    usedProvider = `Claude (${settings.anthropicModel})`;
  } else {
    if (inputIsHindi) {
      return { ok: false, error: 'Hindi translation needs an AI key. Add a Gemini/OpenAI/Claude API key in settings (the offline mode cannot translate).' };
    }
    // Smart Local Human Review Synthesizer (works with zero API key!)
    review = globalThis.VinePilotVoice.synthesizeLocalHumanReview({
      product: payload.product || {},
      context: payload.context || {},
      voiceProfile,
      aspects: payload.aspects || []
    });
    usedProvider = 'VinePilot Built-in Human Synthesizer';
  }

  // Always run our anti-em-dash & deterministic guideline auto-scrubber on the output
  const cleanTitle = globalThis.VinePilotGuidelines.autoFixText(review.title || '');
  const cleanBody = globalThis.VinePilotGuidelines.autoFixText(review.body || '');

  return {
    ok: true,
    provider: usedProvider,
    review: {
      title: cleanTitle,
      body: cleanBody,
      rating: Number(payload.context?.rating) || 5
    }
  };
}

/**
 * Weave missing Amazon "Ideas" topics into an existing review draft
 */
async function handleWeaveMissingIdeas({ asin, title, body, rating, missingIdeas = [] }) {
  const settings = await getSettings();
  const voiceProfile = await getVoiceProfile();
  const ideasList = missingIdeas.join(', ');

  const weavePrompt = `You are revising an Amazon Vine review so that Amazon's live "Ideas" topic checker ticks these missing topics: [${ideasList}].

RULES:
1. Keep the reviewer's existing voice, wording, and paragraphs intact as much as possible—only weave in 1 or 2 natural sentences that explicitly mention the missing topic keywords (${ideasList}) based on their experience.
2. Do NOT use em-dashes ("—") or robotic AI phrases.
3. Respect all Amazon Community Guidelines (no medical claims, no shipping/seller mentions, no Vine/free mentions).

CURRENT HEADLINE: ${title || ''}
CURRENT REVIEW BODY:
${body || ''}

STAR RATING: ${rating || 5}/5
MISSING AMAZON IDEAS TO COVER: ${ideasList}

Return JSON: { "title": "...", "body": "..." }`;

  if (settings.aiProvider === 'gemini' && settings.geminiApiKey?.trim()) {
    const res = await callGeminiApi({ apiKey: settings.geminiApiKey.trim(), model: settings.geminiModel, prompt: weavePrompt });
    return { ok: true, title: globalThis.VinePilotGuidelines.autoFixText(res.title || title), body: globalThis.VinePilotGuidelines.autoFixText(res.body) };
  } else if (settings.aiProvider === 'openai' && settings.openaiApiKey?.trim()) {
    const res = await callOpenAiApi({ apiKey: settings.openaiApiKey.trim(), model: settings.openaiModel, prompt: weavePrompt });
    return { ok: true, title: globalThis.VinePilotGuidelines.autoFixText(res.title || title), body: globalThis.VinePilotGuidelines.autoFixText(res.body) };
  } else if (settings.aiProvider === 'anthropic' && settings.anthropicApiKey?.trim()) {
    const res = await callAnthropicApi({ apiKey: settings.anthropicApiKey.trim(), model: settings.anthropicModel, prompt: weavePrompt });
    return { ok: true, title: globalThis.VinePilotGuidelines.autoFixText(res.title || title), body: globalThis.VinePilotGuidelines.autoFixText(res.body) };
  }

  // Fallback local natural weaver
  const additions = missingIdeas.map(topic => {
    const lower = topic.toLowerCase();
    if (/value|price|money|worth/.test(lower)) {
      return rating >= 4
        ? `As far as ${lower} goes, I feel like it offers solid value for what you get.`
        : `In terms of ${lower}, it feels a little steep given those trade-offs.`;
    }
    if (/size|fit/.test(lower)) {
      return `The ${lower} was true to what I expected from the listing measurements.`;
    }
    if (/ease|easy|setup|install/.test(lower)) {
      return `For ${lower}, getting everything set up and working took only a couple of minutes.`;
    }
    return `Regarding ${lower}, it performed reliably throughout my testing.`;
  });

  const updatedBody = `${String(body || '').trim()}\n\n${additions.join(' ')}`.trim();
  return { ok: true, title, body: updatedBody, voidAsin: asin, voidVoice: !!voiceProfile };
}

const CATALOG_LOCALES = {
  'amazon.com': 'en_US',
  'amazon.ca': 'en_CA',
  'amazon.co.uk': 'en_GB',
  'amazon.de': 'de_DE',
  'amazon.fr': 'fr_FR',
  'amazon.es': 'es_ES',
  'amazon.it': 'it_IT',
  'amazon.co.jp': 'ja_JP',
  'amazon.com.au': 'en_AU',
  'amazon.in': 'en_IN'
};

function buildCatalogPdpUrl(origin, asin) {
  const cleanOrigin = /^https?:\/\/[^/]*amazon\./i.test(origin || '')
    ? new URL(origin).origin
    : 'https://www.amazon.in';
  const hostKey = new URL(cleanOrigin).hostname.replace(/^www\./i, '').toLowerCase();
  const locale = CATALOG_LOCALES[hostKey] || null;
  const u = new URL(`${cleanOrigin}/dp/${encodeURIComponent(asin)}`);
  u.searchParams.set('th', '1');
  if (locale) u.searchParams.set('language', locale);
  return { url: u.href, locale, origin: cleanOrigin };
}

/**
 * Injected function that runs inside an Amazon product tab (open or hidden)
 * to scrape the live rendered DOM with 100% accuracy.
 */
function scrapePdpDomInPage() {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const title = clean(
    document.querySelector('#productTitle, #title, h1#title span')?.textContent
  );

  const bulletNodes = document.querySelectorAll(
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

  // Also grab product overview key-value table if present
  const overviewRows = document.querySelectorAll('#productOverview_feature_div tr, #prodDetails tr');
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
    document.querySelector('#productDescription, #aplus_feature_div, #aplus')?.textContent
  ).slice(0, 2000);

  let image = '';
  const imgEl = document.querySelector('#landingImage, #imgTagWrapperId img, #main-image-container img, #imageBlock img');
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
    image = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
  }

  const description = [
    bullets.length ? bullets.map(b => `• ${b}`).join('\n') : '',
    desc
  ].filter(Boolean).join('\n\n').slice(0, 4000);

  return { title, description, bullets, image };
}

async function detectOpenAmazonOrigin() {
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.amazon.in/*', '*://*.amazon.com/*', '*://*.amazon.co.uk/*', '*://*.amazon.ca/*', '*://*.amazon.de/*', '*://*.amazon.fr/*', '*://*.amazon.es/*', '*://*.amazon.it/*', '*://*.amazon.co.jp/*', '*://*.amazon.com.au/*'] });
    if (tabs.length > 0 && tabs[0].url) {
      return new URL(tabs[0].url).origin;
    }
  } catch { /* ignore */ }
  return null;
}

async function capturePdpViaHiddenTab(url) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }, 12000);
      function onUpdated(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePdpDomInPage
    });
    const scraped = results?.[0]?.result;
    if (scraped && (scraped.title || scraped.description || scraped.image)) {
      return { ok: true, scraped };
    }
    return { ok: false };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
    }
  }
}

/**
 * Fetch product title, bullets, description & main image from Amazon PDP
 * Uses a 3-tier strategy (Open Tab -> Direct Catalog Fetch -> Hidden Tab DOM Scrape)
 */
async function fetchProductPdp({ asin, origin }) {
  // Support pasting either an ASIN or a full Amazon URL
  let rawInput = String(asin || '').trim();
  let detectedOriginFromInput = null;
  if (/^https?:\/\/[^/]*amazon\./i.test(rawInput)) {
    try {
      const u = new URL(rawInput);
      detectedOriginFromInput = u.origin;
      const m = u.pathname.match(/\/(?:dp|gp\/product|product|review\/create-review)\/([A-Z0-9]{10})/i) ||
                u.search.match(/[?&]asin=([A-Z0-9]{10})/i);
      if (m) rawInput = m[1];
    } catch { /* ignore */ }
  } else {
    const m = rawInput.match(/\b([A-Z0-9]{10})\b/i);
    if (m) rawInput = m[1];
  }

  const cleanAsin = rawInput.toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) {
    return { ok: false, error: 'Please enter a valid 10-character Amazon ASIN (e.g. B0...) or paste an Amazon product link.' };
  }

  const openOrigin = await detectOpenAmazonOrigin();
  const primaryOrigin = detectedOriginFromInput || openOrigin || origin || 'https://www.amazon.in';

  // 1) Check if the user already has a product tab open for this ASIN
  try {
    const dpTabs = await chrome.tabs.query({ url: ['*://*.amazon.*/*/dp/*', '*://*.amazon.*/dp/*', '*://*.amazon.*/*/gp/product/*'] });
    const matchingTab = dpTabs.find(t => t.url && t.url.toUpperCase().includes(cleanAsin));
    if (matchingTab?.id) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: matchingTab.id },
        func: scrapePdpDomInPage
      });
      const scraped = results?.[0]?.result;
      if (scraped && (scraped.title || scraped.description)) {
        return {
          ok: true,
          product: {
            asin: cleanAsin,
            ...scraped,
            origin: new URL(matchingTab.url).origin
          }
        };
      }
    }
  } catch { /* fallback to fetch */ }

  // Candidate marketplaces to try in order
  const candidateOrigins = [...new Set([
    primaryOrigin,
    'https://www.amazon.in',
    'https://www.amazon.com'
  ])];

  // 2) Try Direct Catalog Fetch with storefront locale headers
  for (const candOrigin of candidateOrigins) {
    const { url, locale, origin: cleanOrigin } = buildCatalogPdpUrl(candOrigin, cleanAsin);
    try {
      const headers = { Accept: 'text/html,application/xhtml+xml' };
      if (locale) headers['Accept-Language'] = locale.replace('_', '-');

      const res = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        headers
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!/id=["']productTitle["']|id=["']title["']/i.test(html)) continue;

      return {
        ok: true,
        html,
        product: {
          asin: cleanAsin,
          origin: cleanOrigin
        }
      };
    } catch { /* try next */ }
  }

  // 3) Fallback: Hidden background tab DOM scrape (handles dynamic/bot-gated pages)
  const { url: fallbackUrl, origin: fallbackOrigin } = buildCatalogPdpUrl(primaryOrigin, cleanAsin);
  const hiddenRes = await capturePdpViaHiddenTab(fallbackUrl);
  if (hiddenRes.ok && hiddenRes.scraped) {
    return {
      ok: true,
      product: {
        asin: cleanAsin,
        ...hiddenRes.scraped,
        origin: fallbackOrigin
      }
    };
  }

  return {
    ok: false,
    error: `Could not auto-fetch listing for ${cleanAsin} on ${new URL(primaryOrigin).hostname}. Check the marketplace dropdown or paste the title/bullets manually.`
  };
}

// ---- Message Router ----------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'VP_GENERATE_REVIEW') {
    handleGenerateReview(msg.payload || {})
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (msg.type === 'VP_WEAVE_MISSING_IDEAS') {
    handleWeaveMissingIdeas(msg)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (msg.type === 'VP_FETCH_PRODUCT_PDP') {
    fetchProductPdp(msg)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (msg.type === 'VP_STASH_HANDOFF') {
    (async () => {
      try {
        const meta = {
          ...msg.meta,
          id: msg.meta?.id || crypto.randomUUID(),
          ts: Date.now(),
          consumed: false
        };
        const images = Array.isArray(msg.images) ? msg.images : [];
        await chrome.storage.local.set({
          vp_review_prefill: meta,
          vp_review_prefill_images: images
        });
        sendResponse({ ok: true, id: meta.id });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'VP_CONSUME_HANDOFF') {
    (async () => {
      try {
        const data = await chrome.storage.local.get('vp_review_prefill');
        if (data?.vp_review_prefill) {
          await chrome.storage.local.set({
            vp_review_prefill: { ...data.vp_review_prefill, consumed: true }
          });
        }
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (msg.type === 'VP_SAVE_PENDING_ITEMS') {
    (async () => {
      try {
        const existing = (await chrome.storage.local.get('vp_pending_items'))?.vp_pending_items || [];
        const map = new Map();
        for (const item of existing) if (item?.asin) map.set(item.asin, item);
        for (const item of (msg.items || [])) if (item?.asin) map.set(item.asin, { ...map.get(item.asin), ...item, updatedAt: Date.now() });
        const merged = Array.from(map.values()).slice(0, 300);
        await chrome.storage.local.set({ vp_pending_items: merged });
        sendResponse({ ok: true, count: merged.length });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'VP_OPEN_STUDIO') {
    (async () => {
      const url = new URL(chrome.runtime.getURL('studio.html'));
      if (msg.seed?.asin) url.searchParams.set('asin', msg.seed.asin);
      if (msg.seed?.title) url.searchParams.set('title', msg.seed.title);
      if (msg.seed?.reviewUrl) url.searchParams.set('reviewUrl', msg.seed.reviewUrl);
      await chrome.tabs.create({ url: url.toString() });
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});
