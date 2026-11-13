// ทดสอบ mailer.js กับ REST ปลอม (แทน Supabase) และ SMTP server ปลอม
const http = require('http'); const { SMTPServer } = require('smtp-server'); const { simpleParser } = require('mailparser');
const path = require('path').join(__dirname, '..', 'mailer.js');   // ต้องติดตั้งเพิ่ม: npm i -D smtp-server mailparser
(async () => {
  const { startMailer } = require(path);
  const rows = []; let id = 0; const add = (to, subject, body, extra) => rows.push(Object.assign({ id: ++id, to_addr: to, subject, body, status: 'pending', tries: 0, next_try_at: new Date(Date.now() - 1000).toISOString(), last_error: null, sent_at: null }, extra));
  const seenAuth = [];
  // fake PostgREST for email_outbox
  const rest = http.createServer((req, res) => {
    seenAuth.push(req.headers.apikey + '|' + req.headers.authorization);
    const u = new URL(req.url, 'http://x'); let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const f = Object.fromEntries([...u.searchParams.entries()]); const m = r => (!f.id || r.id === Number(f.id.replace('eq.', ''))) && (!f.status || r.status === f.status.replace('eq.', '')) && (!f.next_try_at || new Date(r.next_try_at) <= new Date(f.next_try_at.replace('lte.', '')));
      const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.method === 'GET') return send(200, rows.filter(m).sort((a, b) => a.id - b.id).slice(0, Number(f.limit || 100)).map(r => ({ id: r.id, to_addr: r.to_addr, subject: r.subject, body: r.body, tries: r.tries })));
      if (req.method === 'PATCH') { const hit = rows.filter(m); hit.forEach(r => Object.assign(r, JSON.parse(body))); return send(200, req.headers.prefer === 'return=representation' ? hit : null); }
      send(405, {});
    });
  }).listen(0);
  // fake SMTP
  const inbox = []; let failNext = 0; let rejectAll = false;
  const smtp = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onData(stream, session, cb) { simpleParser(stream).then(m => { if (rejectAll || failNext > 0) { failNext--; return cb(new Error('451 try later')); } inbox.push(m); cb(); }).catch(cb); } }).listen(0);
  await new Promise(r => setTimeout(r, 200));
  const env = { SUPABASE_URL: 'http://127.0.0.1:' + rest.address().port, SUPABASE_SERVICE_ROLE_KEY: 'SECRET-KEY', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_FROM: 'ระบบจอง <booking@x.go.th>', MAIL_POLL_SECONDS: '2' };
  const logs = []; const log = { log: m => logs.push(m) };
  const results = []; const ok = (n, c, x) => { results.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' | ' + x)); };
  ok('not configured -> does nothing and says why', startMailer({}, log) === null && /ยังไม่ได้ตั้งค่า/.test(logs[0]));
  add('wan@x.co', 'ยืนยันการจอง', 'รหัสการจอง: ABCD-1234 ลิงก์ https://x/#code=ABCD1234'); add('boss@x.go.th', 'การจองใหม่', 'รายละเอียด');
  const mailerA = startMailer(env, log); const mailerB = startMailer(env, log);   // two mailers racing for the same queue
  await new Promise(r => setTimeout(r, 1500));
  ok('both messages delivered exactly once even with two mailers', inbox.length === 2 && rows.every(r => r.status === 'sent'), inbox.length + ' ' + JSON.stringify(rows.map(r => r.status)));
  ok('subject/body/from come through (Thai text intact)', inbox.some(m => m.subject === 'ยืนยันการจอง' && /ABCD-1234/.test(m.text) && /booking@x\.go\.th/.test(m.from.text)) && inbox[0].to.text !== undefined);
  ok('after sending, the body (which holds the code) is wiped', rows.every(r => r.body === '') && rows.every(r => r.sent_at));
  ok('service key sent as apikey + bearer to REST', seenAuth.every(a => a === 'SECRET-KEY|Bearer SECRET-KEY'));
  // failure then success
  inbox.length = 0; failNext = 1; add('retry@x.co', 'ลองใหม่', 'เนื้อหา');
  await new Promise(r => setTimeout(r, 2600)); const r1 = rows.find(r => r.to_addr === 'retry@x.co');
  ok('SMTP failure: kept pending with tries=1, error noted, retry scheduled later', r1.status === 'pending' && r1.tries === 1 && /451|try later/.test(r1.last_error) && new Date(r1.next_try_at) > new Date(), JSON.stringify(r1));
  r1.next_try_at = new Date(Date.now() - 1000).toISOString();   // fast-forward the backoff
  await new Promise(r => setTimeout(r, 2600));
  ok('retry succeeds on the next attempt', r1.status === 'sent' && inbox.length === 1, JSON.stringify(r1));
  // permanent failure
  rejectAll = true; add('dead@x.co', 'ไม่มีวันส่งได้', 'ลับ', { tries: 4 });
  await new Promise(r => setTimeout(r, 2600)); const r2 = rows.find(r => r.to_addr === 'dead@x.co');
  ok('after 5 failures it is marked failed and the body wiped', r2.status === 'failed' && r2.body === '' && r2.tries === 5, JSON.stringify(r2));
  rejectAll = false; mailerA.stop(); mailerB.stop(); rest.close(); smtp.close();
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed'); process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
