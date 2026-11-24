/**
 * VinePilot AI — Photo & Media Processor
 * Converts photos (JPEG/PNG/WebP/HEIC) to EXIF-scrubbed JPEGs, supports 90° rotate,
 * horizontal flip, privacy blur/redaction, contact-sheet generation, and IndexedDB handoff.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'vp_review_handoff';
  const STORE_NAME = 'images';

  function isHeic(file) {
    return /image\/heic|image\/heif/i.test(file?.type || '') || /\.(heic|heif)$/i.test(file?.name || '');
  }

  function isVideo(file) {
    return /^video\//i.test(file?.type || '') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file?.name || '');
  }

  function readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error || new Error('Failed to read file'));
      r.readAsDataURL(blob);
    });
  }

  function stripDataUrlPrefix(dataUrl) {
    const idx = dataUrl.indexOf(',');
    return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  }

  /**
   * Convert any browser-decodable image File/Blob to an EXIF-scrubbed JPEG base64 object
   */
  async function convertImageToJpeg(fileOrBlob, maxDim = 2000, quality = 0.9) {
    const nameBase = (fileOrBlob.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    try {
      const bitmap = await createImageBitmap(fileOrBlob);
      try {
        const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
        const jpegBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
        const dataUrl = await readAsDataURL(jpegBlob);
        return {
          name: nameBase,
          mime: 'image/jpeg',
          data: stripDataUrlPrefix(dataUrl),
          dataUrl,
          width,
          height,
          exifStripped: true
        };
      } finally {
        bitmap.close?.();
      }
    } catch {
      // Fallback via <img> element or raw base64
      const rawUrl = await readAsDataURL(fileOrBlob);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Browser could not decode this image format directly.'));
        el.src = rawUrl;
      }).catch(() => null);

      if (img) {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1000, img.naturalHeight || 1000));
        const width = Math.max(1, Math.round((img.naturalWidth || 1000) * scale));
        const height = Math.max(1, Math.round((img.naturalHeight || 1000) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const jpegBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
        const dataUrl = await readAsDataURL(jpegBlob);
        return {
          name: nameBase,
          mime: 'image/jpeg',
          data: stripDataUrlPrefix(dataUrl),
          dataUrl,
          width,
          height,
          exifStripped: true
        };
      }

      return {
        name: fileOrBlob.name || nameBase,
        mime: fileOrBlob.type || 'image/jpeg',
        data: stripDataUrlPrefix(rawUrl),
        dataUrl: rawUrl,
        width: 0,
        height: 0,
        exifStripped: false
      };
    }
  }

  /**
   * Rotate a base64 JPEG by 90 degrees clockwise
   */
  async function rotateBase64Image(base64Data, mime = 'image/jpeg', degrees = 90, quality = 0.9) {
    const img = await loadImageFromBase64(base64Data, mime);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const swap = degrees === 90 || degrees === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    const dataUrl = await readAsDataURL(blob);
    return {
      data: stripDataUrlPrefix(dataUrl),
      dataUrl,
      mime: 'image/jpeg',
      width: canvas.width,
      height: canvas.height
    };
  }

  /**
   * Flip a base64 JPEG horizontally
   */
  async function flipBase64Image(base64Data, mime = 'image/jpeg', quality = 0.9) {
    const img = await loadImageFromBase64(base64Data, mime);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    const dataUrl = await readAsDataURL(blob);
    return {
      data: stripDataUrlPrefix(dataUrl),
      dataUrl,
      mime: 'image/jpeg',
      width: w,
      height: h
    };
  }

  /**
   * Build a numbered contact sheet PNG of up to 9 photos (for 1-paste into external AI chats)
   */
  async function buildContactSheetBlob(images = [], { tile = 640, maxCols = 3, gap = 12, maxImages = 9 } = {}) {
    const valid = images.filter(im => im?.data).slice(0, maxImages);
    if (!valid.length) return null;
    const loaded = (await Promise.all(
      valid.map(im => loadImageFromBase64(im.data, im.mime || 'image/jpeg').catch(() => null))
    )).filter(Boolean);
    if (!loaded.length) return null;

    const cols = Math.min(maxCols, loaded.length);
    const rows = Math.ceil(loaded.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = cols * tile + (cols + 1) * gap;
    canvas.height = rows * tile + (rows + 1) * gap;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    loaded.forEach((img, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const x = gap + c * (tile + gap);
      const y = gap + r * (tile + gap);
      const scale = Math.min(tile / img.naturalWidth, tile / img.naturalHeight);
      const dw = Math.round(img.naturalWidth * scale);
      const dh = Math.round(img.naturalHeight * scale);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(x, y, tile, tile);
      ctx.drawImage(img, x + Math.round((tile - dw) / 2), y + Math.round((tile - dh) / 2), dw, dh);

      // Numbered badge
      ctx.fillStyle = 'rgba(17, 24, 39, 0.8)';
      ctx.beginPath();
      ctx.arc(x + 28, y + 28, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(idx + 1), x + 28, y + 29);
    });

    return new Promise(res => canvas.toBlob(res, 'image/png'));
  }

  function loadImageFromBase64(base64Data, mime = 'image/jpeg') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = `data:${mime};base64,${base64Data}`;
    });
  }

  function downloadBase64File(name, base64Data, mime = 'image/jpeg') {
    const bin = atob(base64Data);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'vine-photo.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // IndexedDB helpers for same-origin handoff when running embedded on Amazon
  function openHandoffDb() {
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

  async function saveImagesToIdb(key, images) {
    try {
      const db = await openHandoffDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ expiresAt: Date.now() + 20 * 60 * 1000, images }, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      });
    } catch { /* ignore if cross-origin */ }
  }

  root.VinePilotMedia = {
    isHeic,
    isVideo,
    convertImageToJpeg,
    rotateBase64Image,
    flipBase64Image,
    buildContactSheetBlob,
    downloadBase64File,
    saveImagesToIdb
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
