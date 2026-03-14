// server.js – minimalny serwer HTTP dla OgrodzeniePRO (Node.js)
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2]) || 8080;
const ROOT = __dirname;

const MIME = {
  '.html':        'text/html; charset=utf-8',
  '.js':          'application/javascript; charset=utf-8',
  '.css':         'text/css; charset=utf-8',
  '.json':        'application/json; charset=utf-8',
  '.png':         'image/png',
  '.jpg':         'image/jpeg',
  '.jpeg':        'image/jpeg',
  '.ico':         'image/x-icon',
  '.svg':         'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(ROOT, urlPath);

  // Zabezpieczenie przed wychodzeniem poza katalog aplikacji
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nie znaleziono pliku');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });

}).listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Serwer dziala na: http://localhost:' + PORT);
  console.log('  Zamknij to okno zeby zatrzymac.');
  console.log('');
});
