/**
 * VinePilot AI — Self-Contained QR Code SVG/Canvas Renderer
 * Generates scannable QR codes (Byte mode, ECC Level L, Versions 1..10) with zero external network calls,
 * plus optional fallback SVG data URL.
 */
(function (root) {
  'use strict';

  // GF(256) exponent & log tables for Reed-Solomon ECC
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGalois() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
  }

  function rsGeneratorPoly(degree) {
    let poly = new Uint8Array([1]);
    for (let i = 0; i < degree; i++) {
      const next = new Uint8Array(poly.length + 1);
      const factor = EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGeneratorPoly(ecLen);
    const msg = new Uint8Array(data.length + ecLen);
    msg.set(data, 0);
    for (let i = 0; i < data.length; i++) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          msg[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return msg.slice(data.length);
  }

  // Version table for ECC Level L (1..10): [totalCodewords, ecCodewordsPerBlock, numBlocks, alignCenters]
  const VERSION_INFO = [
    null,
    { total: 26, ec: 7, blocks: 1, align: [] },
    { total: 44, ec: 10, blocks: 1, align: [6, 18] },
    { total: 70, ec: 15, blocks: 1, align: [6, 22] },
    { total: 100, ec: 20, blocks: 1, align: [6, 26] },
    { total: 134, ec: 26, blocks: 1, align: [6, 30] },
    { total: 172, ec: 18, blocks: 2, align: [6, 34] },
    { total: 196, ec: 20, blocks: 2, align: [6, 22, 38] },
    { total: 242, ec: 24, blocks: 2, align: [6, 24, 42] },
    { total: 292, ec: 30, blocks: 2, align: [6, 26, 46] },
    { total: 346, ec: 18, blocks: 4, align: [6, 28, 50] }
  ];

  // Format info strings for ECC Level L (01), masks 0..7
  const FORMAT_BITS_L = [
    0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976
  ];

  const VERSION_BITS = {
    7: 0x07c94,
    8: 0x085bc,
    9: 0x09a99,
    10: 0x0a4d3
  };

  function encodeQRMatrix(text) {
    const bytes = new TextEncoder().encode(String(text));
    let ver = 1;
    for (; ver <= 10; ver++) {
      const info = VERSION_INFO[ver];
      const dataCap = info.total - info.ec * info.blocks;
      const headerBytes = ver >= 10 ? 3 : 2;
      if (bytes.length + headerBytes <= dataCap) break;
    }
    if (ver > 10) throw new Error('Text too long for QR V10');

    const info = VERSION_INFO[ver];
    const dataCap = info.total - info.ec * info.blocks;

    // Build bit stream: Mode 0100 (Byte), char count (8 bits for v1-9, 16 bits for v10)
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    pushBits(0b0100, 4);
    pushBits(bytes.length, ver >= 10 ? 16 : 8);
    for (const b of bytes) pushBits(b, 8);
    for (let i = 0; i < 4 && bits.length < dataCap * 8; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataCodewords = new Uint8Array(dataCap);
    for (let i = 0; i < bits.length / 8; i++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
      dataCodewords[i] = byte;
    }
    const padBytes = [0xec, 0x11];
    for (let i = bits.length / 8, p = 0; i < dataCap; i++, p ^= 1) {
      dataCodewords[i] = padBytes[p];
    }

    // Split into blocks & compute ECC
    const blocksData = [];
    const blocksEc = [];
    const baseBlockLen = Math.floor(dataCap / info.blocks);
    const extraBlocks = dataCap % info.blocks;
    let offset = 0;
    for (let b = 0; b < info.blocks; b++) {
      const len = baseBlockLen + (b >= info.blocks - extraBlocks ? 1 : 0);
      const slice = dataCodewords.slice(offset, offset + len);
      offset += len;
      blocksData.push(slice);
      blocksEc.push(rsEncode(slice, info.ec));
    }

    // Interleave data and EC codewords
    const finalCodewords = [];
    const maxDataLen = baseBlockLen + (extraBlocks > 0 ? 1 : 0);
    for (let i = 0; i < maxDataLen; i++) {
      for (let b = 0; b < info.blocks; b++) {
        if (i < blocksData[b].length) finalCodewords.push(blocksData[b][i]);
      }
    }
    for (let i = 0; i < info.ec; i++) {
      for (let b = 0; b < info.blocks; b++) {
        finalCodewords.push(blocksEc[b][i]);
      }
    }

    const size = ver * 4 + 17;
    const matrix = Array.from({ length: size }, () => new Uint8Array(size));
    const reserved = Array.from({ length: size }, () => new Uint8Array(size));

    function setFunctionModule(r, c, dark) {
      if (r < 0 || r >= size || c < 0 || c >= size) return;
      matrix[r][c] = dark ? 1 : 0;
      reserved[r][c] = 1;
    }

    function drawFinder(top, left) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const dark =
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          setFunctionModule(top + r, left + c, dark);
        }
      }
    }

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      setFunctionModule(6, i, i % 2 === 0);
      setFunctionModule(i, 6, i % 2 === 0);
    }

    // Alignment patterns
    const align = info.align;
    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < align.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
        const cr = align[i], cc = align[j];
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
            setFunctionModule(cr + r, cc + c, dark);
          }
        }
      }
    }

    // Dark module & reserve format info areas
    setFunctionModule(size - 8, 8, true);
    for (let i = 0; i < 9; i++) {
      if (!reserved[8][i]) reserved[8][i] = 1;
      if (!reserved[i][8]) reserved[i][8] = 1;
    }
    for (let i = 0; i < 8; i++) {
      reserved[8][size - 1 - i] = 1;
      reserved[size - 1 - i][8] = 1;
    }

    // Version info for v >= 7
    if (ver >= 7 && VERSION_BITS[ver]) {
      const vbits = VERSION_BITS[ver];
      for (let i = 0; i < 18; i++) {
        const bit = ((vbits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFunctionModule(b, a, bit);
        setFunctionModule(a, b, bit);
      }
    }

    // Place data bits in upward/downward 2-column zigzag
    let bitIdx = 0;
    const totalBits = finalCodewords.length * 8;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!reserved[r][c]) {
            let dark = false;
            if (bitIdx < totalBits) {
              dark = ((finalCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
              bitIdx++;
            }
            // Apply mask 0: (r + c) % 2 === 0
            if ((r + c) % 2 === 0) dark = !dark;
            matrix[r][c] = dark ? 1 : 0;
          }
        }
      }
      upward = !upward;
    }

    // Draw format bits for Mask 0
    const fbits = FORMAT_BITS_L[0];
    for (let i = 0; i <= 5; i++) setFunctionModule(8, i, ((fbits >>> i) & 1) === 1);
    setFunctionModule(8, 7, ((fbits >>> 6) & 1) === 1);
    setFunctionModule(8, 8, ((fbits >>> 7) & 1) === 1);
    setFunctionModule(7, 8, ((fbits >>> 8) & 1) === 1);
    for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, ((fbits >>> i) & 1) === 1);

    for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, ((fbits >>> i) & 1) === 1);
    for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, ((fbits >>> i) & 1) === 1);

    return matrix;
  }

  function toSvgDataUrl(text, { margin = 3, darkColor = '#0f172a', lightColor = '#ffffff' } = {}) {
    const matrix = encodeQRMatrix(text);
    const n = matrix.length;
    const total = n + margin * 2;
    let paths = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          paths += `M${c + margin},${r + margin}h1v1h-1z`;
        }
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${lightColor}"/><path d="${paths}" fill="${darkColor}"/></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  root.VinePilotQR = {
    encodeQRMatrix,
    toSvgDataUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
