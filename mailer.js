// ตัวส่งอีเมล: อ่านคิวจากตาราง email_outbox ใน Supabase แล้วส่งผ่าน SMTP
// ใช้ร่วมกับ server.js (รันพร้อมกัน) หรือรันเดี่ยว ๆ ด้วย  node mailer.js
// ต้องตั้งค่าตัวแปร (ไฟล์ .env หรือ environment): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// SUPABASE_SERVICE_ROLE_KEY เป็นคีย์ลับ ใส่ได้เฉพาะบนเซิร์ฟเวอร์นี้ ห้ามใส่ใน web/ เด็ดขาด
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) return;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
}

const MAX_TRIES = 5;

function startMailer(env, log, overrides) {
  env = env || process.env; log = log || console; overrides = overrides || {};
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !env.SMTP_HOST) {
    log.log('[mailer] ยังไม่ได้ตั้งค่า (ต้องมี SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY และ SMTP_HOST) จึงไม่ส่งอีเมล');
    return null;
  }
  const nodemailer = require('nodemailer');
  const port = Number(env.SMTP_PORT) || 587;
  const transport = overrides.transport || nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
  });
  const from = env.SMTP_FROM || env.SMTP_USER;
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const rest = (q, opt) => fetch(url + '/rest/v1/email_outbox' + q, Object.assign({ headers }, opt));
  const iso = ms => new Date(ms).toISOString();
  let busy = false;

  async function tick() {
    if (busy) return; busy = true;
    try {
      const r = await rest('?select=id,to_addr,subject,body,tries&status=eq.pending&next_try_at=lte.' + encodeURIComponent(iso(Date.now())) + '&order=id&limit=20');
      if (!r.ok) throw new Error('อ่านคิวไม่ได้ HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      for (const m of await r.json()) {
        // ล็อกแถวนี้ไว้ก่อนส่ง (เลื่อนเวลาลองใหม่ออกไป 5 นาที) กันตัวส่งสองตัวส่งซ้ำ
        const claim = await rest('?id=eq.' + m.id + '&status=eq.pending&next_try_at=lte.' + encodeURIComponent(iso(Date.now())),
          { method: 'PATCH', headers: Object.assign({ Prefer: 'return=representation' }, headers), body: JSON.stringify({ next_try_at: iso(Date.now() + 5 * 60e3) }) });
        if (!claim.ok || !(await claim.json()).length) continue;
        try {
          await transport.sendMail({ from, to: m.to_addr, subject: m.subject, text: m.body });
          await rest('?id=eq.' + m.id, { method: 'PATCH', body: JSON.stringify({ status: 'sent', sent_at: iso(Date.now()), body: '', last_error: null }) });   // ล้างเนื้อหาที่มีรหัสการจองทิ้ง
          log.log('[mailer] ส่งแล้ว #' + m.id + ' -> ' + m.to_addr);
        } catch (e) {
          const tries = (m.tries || 0) + 1, dead = tries >= MAX_TRIES;
          await rest('?id=eq.' + m.id, { method: 'PATCH', body: JSON.stringify(Object.assign({ tries, last_error: String(e.message || e).slice(0, 300) },
            dead ? { status: 'failed', body: '' } : { next_try_at: iso(Date.now() + Math.pow(2, tries) * 60e3) })) });
          log.log('[mailer] ส่งไม่สำเร็จ #' + m.id + ' (ครั้งที่ ' + tries + (dead ? ' เลิกลอง' : ' จะลองใหม่') + '): ' + (e.message || e));
        }
      }
    } catch (e) { log.log('[mailer] ' + (e.message || e)); }
    finally { busy = false; }
  }
  const every = Math.max(2, Number(env.MAIL_POLL_SECONDS) || 10) * 1000;
  const timer = setInterval(tick, every); tick();
  log.log('[mailer] เริ่มทำงาน ตรวจคิวทุก ' + every / 1000 + ' วินาที ส่งผ่าน ' + env.SMTP_HOST + ':' + port);
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = { startMailer, loadEnvFile };
if (require.main === module) { loadEnvFile(path.join(__dirname, '.env')); startMailer(); }
