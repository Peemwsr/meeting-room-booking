// เว็บเซิร์ฟเวอร์ไฟล์นิ่งแบบง่าย ไม่ต้องติดตั้งแพ็กเกจเพิ่ม
// ใช้: node server.js   (เปิดที่ http://localhost:8080 เปลี่ยนพอร์ตด้วย PORT=3000 node server.js)
// ถ้าตั้งค่า SMTP ใน .env เซิร์ฟเวอร์นี้จะส่งอีเมลจากคิวให้ด้วย (ดู mailer.js และ README)
// ถ้าจะเปิดให้คนทั่วไปใช้ ควรวางหลัง Caddy หรือ Nginx เพื่อให้ได้ HTTPS (ดู README)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { startMailer, loadEnvFile } = require('./mailer');
loadEnvFile(path.join(__dirname, '.env'));   // อ่านค่าตั้งจากไฟล์ .env (ถ้ามี) ดู .env.example

const ROOT = path.join(__dirname, 'web');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }   // กันการอ่านไฟล์นอกโฟลเดอร์ web
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('ไม่พบหน้านี้'); }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  });
}).listen(PORT, () => { console.log('เปิดที่ http://localhost:' + PORT); startMailer(); });   // ตัวส่งอีเมลทำงานเมื่อตั้งค่า SMTP แล้วเท่านั้น
