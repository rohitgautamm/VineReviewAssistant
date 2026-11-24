/**
 * VinePilot AI — Zero-Dependency Local Wi-Fi Phone-to-Laptop Photo & Notes Bridge Server
 * Run: `node phone-bridge/server.js` (or double-click `start-phone-bridge.bat`)
 *
 * Improvements:
 * - Persistent session pairing: scan the QR code ONCE on your phone and upload across
 *   unlimited reviews/tabs on your laptop without ever needing to re-scan!
 * - Dual SSE + Polling delivery so even if you open a new Studio tab for a 2nd review,
 *   it automatically connects in the background and receives phone uploads immediately.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 3847;

// Global shared queue & connected SSE clients so phone -> laptop works across all reviews & tabs
const packetHistory = []; // [{ id, ts, room, images, notes }]
const allSseClients = new Set(); // Set<http.ServerResponse>
let activeProductInfo = { asin: '', title: '' };

function getLocalLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        candidates.push({ name, address: net.address });
      }
    }
  }
  const wifi = candidates.find(c => /wi-?fi|wlan|en0|eth/i.test(c.name)) ||
               candidates.find(c => /^192\.168\./.test(c.address)) ||
               candidates[0];
  return wifi ? wifi.address : '127.0.0.1';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const roomId = parsedUrl.searchParams.get('room') || 'default';

  // 1. Bridge Status & LAN URL Discovery for the Chrome Extension
  if (pathname === '/api/info' && req.method === 'GET') {
    const ip = getLocalLanIp();
    const mobileUrl = `http://${ip}:${PORT}/mobile`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      ip,
      port: PORT,
      room: 'default',
      mobileUrl,
      activeProduct: activeProductInfo
    }));
    return;
  }

  // 2. Laptop Studio informs Bridge which product is currently open
  if (pathname === '/api/active-product' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        activeProductInfo = {
          asin: String(data.asin || ''),
          title: String(data.title || '')
        };
      } catch { /* ignore */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // 3. Serve Mobile Camera & Gallery Upload Web App
  if ((pathname === '/' || pathname === '/mobile') && req.method === 'GET') {
    const htmlPath = path.join(__dirname, 'mobile.html');
    fs.readFile(htmlPath, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500);
        res.end('Could not load mobile.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  // 4. Receive Photos & Bullet Notes from Phone -> Broadcast to ALL open Laptop Studio tabs
  if (pathname === '/api/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 95 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const packet = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ts: Date.now(),
          room: roomId,
          images: Array.isArray(payload.images) ? payload.images : [],
          notes: payload.notes || null
        };
        packetHistory.push(packet);
        if (packetHistory.length > 40) packetHistory.shift();

        // Broadcast immediately via SSE to every connected Chrome Extension Studio tab
        const sseData = `data: ${JSON.stringify(packet)}\n\n`;
        for (const client of allSseClients) {
          try {
            client.write(sseData);
          } catch {
            allSseClients.delete(client);
          }
        }

        console.log(`[PhoneBridge] Received ${packet.images.length} photo(s)${packet.notes ? ' + notes' : ''} -> Broadcasted to ${allSseClients.size} laptop studio tab(s)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: packet.id, clientsCount: allSseClients.size }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 5. Server-Sent Events (SSE) stream for live push to Chrome Extension
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write(': connected\n\n');
    allSseClients.add(res);
    req.on('close', () => allSseClients.delete(res));
    return;
  }

  // 6. Polling endpoint (used by Studio tabs every 2s so no upload is ever missed!)
  if (pathname === '/api/poll' && req.method === 'GET') {
    const since = Number(parsedUrl.searchParams.get('since') || 0);
    const fresh = packetHistory.filter(item => item.ts > since);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, packets: fresh, activeProduct: activeProductInfo }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalLanIp();
  console.log('================================================================');
  console.log(' 📱 VinePilot AI — Direct Phone-to-Laptop Bridge is RUNNING!');
  console.log(` 🌐 Local Wi-Fi URL : http://${ip}:${PORT}/mobile`);
  console.log(` 💻 Extension API   : http://127.0.0.1:${PORT}/api/info`);
  console.log('================================================================');
});
