const boot = require('./harness');
(async () => {
  const mkRoom = (id, name, cap, st) => ({ id, name, capacity: cap, location: 'ชั้น 2', equipment: [], status: st || 'open', sort_order: 1, photo_path: null, description: '', created_at: new Date().toISOString() });
  let tomorrow; const D = n => { const t = new Date(Date.now() + 7 * 3600e3 + n * 864e5); return t.toISOString().slice(0, 10); };
  const T = await boot(w => {
    w.addUser('admin@x.go.th', 'secret123', { full_name: 'ผู้ดูแล' }, 'admin'); w.addUser('stray@x.go.th', 'secret123', { full_name: 'ไม่ใช่ผู้ดูแล' });
    w.rooms.push(mkRoom('r1', 'ห้อง A', 10), mkRoom('r2', 'ห้อง B', 4), mkRoom('r3', 'ห้องปิด', 4, 'closed'));
    ['โปรเจกเตอร์'].forEach((n, i) => w.options.push({ id: 'oe' + i, kind: 'equipment', name: n, sort_order: i })); ['น้ำดื่ม', 'กาแฟและของว่าง'].forEach((n, i) => w.options.push({ id: 'on' + i, kind: 'need', name: n, sort_order: i }));
  });
  const { d, w, sleep, set, submit, click, world, errors } = T; tomorrow = T.tomorrow();
  const results = []; const ok = (n, c, x) => { results.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' | ' + x)); };
  await sleep(250);
  const tabs = () => [...d.querySelectorAll('.tab')].map(t => t.textContent).join('|');
  ok('public visitor lands on the calendar without any login', !!d.querySelector('.cal') && !d.getElementById('auth-login') && d.querySelectorAll('.ritem').length === 4, d.getElementById('main').textContent.slice(0, 60));
  ok('public tabs: calendar, status, my bookings only; no bell/user chip; admin link visible', tabs() === 'ปฏิทิน|สถานะห้อง|การจองของฉัน' && d.getElementById('bell').hidden && d.getElementById('user-btn').hidden && !d.getElementById('admin-link').hidden, tabs());
  // somebody else's booking appears as an anonymous busy block
  world.calls.length = 0;
  const other = world.client.rpc; await other.call(world.client, 'create_booking_public', { p_room: 'r1', p_day: tomorrow, p_start: 600, p_end: 720, p_title: 'ความลับของคนอื่น', p_name: 'วันเพ็ญ', p_agency: 'คลัง', p_mode: 'normal', p_attendees: 3, p_needs: [], p_note: '', p_phone: '0822222222', p_email: 'wan@x.co' });
  world.notify(); await sleep(500);
  click('[data-act="goto-date"][data-date="' + tomorrow + '"]');
  const slot = d.querySelector('.ev.slot');
  ok('another person\'s booking shows only "ไม่ว่าง" (no title, no name, not clickable)', !!slot && slot.tagName === 'DIV' && !/ความลับ|วันเพ็ญ|คลัง/.test(d.getElementById('main').textContent), slot && slot.textContent);
  ok('public data load never touched protected tables', !world.calls.some(c => c[0] === 'rpc' && /admin|mail/.test(c[1])));
  // ---------- book without an account
  click('#cta-top'); set('bk-date', tomorrow, 'change'); set('bk-room', 'r1', 'change');
  ok('busy hours of the other booking are blocked in the picker', d.querySelector('.slotbtn[data-m="600"]').disabled);
  click('.preset[data-id="pm"]'); set('bk-name', 'สมชาย ใจดี'); set('bk-phone', '042-711282'); set('bk-agency', 'สำนักงานจังหวัด'); set('bk-email', 'somchai@x.go.th'); set('bk-title', 'ประชุมบ่าย'); d.getElementById('bk-mode-vcs').checked = true;
  submit('bk-form'); await sleep(60);
  ok('consent tick is required', /ติ๊กยอมรับ/.test(d.getElementById('bk-err').textContent), d.getElementById('bk-err').textContent);
  d.getElementById('bk-consent').checked = true; set('bk-hp', 'http://spam.example'); submit('bk-form'); await sleep(200);
  ok('honeypot filled -> pretends success but creates nothing', world.bookings.length === 1 && !d.getElementById('dlg').hasAttribute('open'), world.bookings.length);
  click('#cta-top'); set('bk-date', tomorrow, 'change'); set('bk-room', 'r1', 'change'); click('.preset[data-id="pm"]');
  ok('requester details were not remembered after the failed attempts', d.getElementById('bk-name').value === '');
  set('bk-name', 'สมชาย ใจดี'); set('bk-phone', '042-711282'); set('bk-agency', 'สำนักงานจังหวัด'); set('bk-email', 'somchai@x.go.th'); set('bk-title', 'ประชุมบ่าย'); d.getElementById('bk-mode-vcs').checked = true; d.getElementById('bk-consent').checked = true;
  submit('bk-form'); await sleep(350);
  const mine = world.bookings.find(b => b.title === 'ประชุมบ่าย'); const code = mine && mine.code;
  ok('booking created with no account and a code was returned', !!mine && mine.start_min === 780 && mine.end_min === 960, JSON.stringify(mine));
  ok('code dialog shows the code, a link, and warns to keep it', d.getElementById('dlg').hasAttribute('open') && d.querySelector('.codebox code').textContent === code.replace(/(.{4})(?=.)/g, '$1-') && /#code=/.test(d.getElementById('code-link').value) && /เก็บรหัส/.test(d.getElementById('dlg').textContent));
  ok('code and details remembered in this browser', JSON.parse(w.localStorage.getItem('rb.codes'))[0] === code && JSON.parse(w.localStorage.getItem('rb.requester')).phone === '042-711282');
  ok('confirmation and admin notice queued', world.outbox.some(m => m.to === 'somchai@x.go.th' && m.body.includes(code)) && world.outbox.some(m => m.to === 'boss@x.go.th'));
  click('#dlg [data-act="goto-mine"]');
  ok('my bookings lists it with edit and cancel buttons', d.querySelectorAll('.bk').length === 1 && !!d.querySelector('.bk [data-act="edit"]') && !!d.querySelector('.bk [data-act="cancel"]'));
  ok('own booking is shown in full on the calendar (title, mine tag)', (click('[data-tab="calendar"]'), true) && [...d.querySelectorAll('.ev')].some(e => /ประชุมบ่าย/.test(e.textContent) && !e.classList.contains('slot') && /ของฉัน/.test(e.textContent)));
  // ---------- edit with the code
  click('.ev:not(.slot)'); ok('detail shows the code and own phone/email', /042-711282/.test(d.querySelector('#dlg .kv').textContent) && /somchai@x\.go\.th/.test(d.querySelector('#dlg .kv').textContent) && d.querySelector('#dlg code.code'));
  click('#dlg [data-act="edit"]'); ok('edit form prefilled', d.getElementById('bk-title').value === 'ประชุมบ่าย' && d.getElementById('bk-email').value === 'somchai@x.go.th' && !d.getElementById('bk-consent'));
  set('bk-title', 'ประชุมบ่าย (แก้ไข)'); submit('bk-form'); await sleep(350);
  ok('edit goes through update_booking_by_code', world.calls.some(c => c[1] === 'update_booking_by_code') && mine.title === 'ประชุมบ่าย (แก้ไข)' && world.events.filter(e => e.booking_id === mine.id).map(e => e.kind).join() === 'created,edited');
  // ---------- cancel with the code
  click('[data-tab="mine"]'); click('.bk [data-act="cancel"]'); ok('cancel dialog for the owner has no admin reason box', !d.getElementById('cx-reason')); click('#dlg [data-act="cancel-do"]'); await sleep(350);
  ok('cancel goes through cancel_booking_by_code and frees the hours', mine.status === 'cancelled' && !world.slots.some(s => s.bk === mine.id) && world.calls.some(c => c[1] === 'cancel_booking_by_code'));
  ok('cancelled booking moves to history; confirmation emailed', d.querySelectorAll('details.hist .bk').length === 1 && world.outbox.some(m => m.to === 'somchai@x.go.th' && /ยกเลิก/.test(m.subject)));
  click('details.hist [data-act="forget-code"]'); await sleep(300);
  ok('"remove from list" forgets the code', JSON.parse(w.localStorage.getItem('rb.codes')).length === 0 && d.querySelectorAll('.bk').length === 0);
  // ---------- code form, forgot form
  const b2 = world.bookings.find(b => b.title === 'ความลับของคนอื่น'); const c2 = b2.code.replace(/(.{4})(?=.)/g, '$1-');
  set('mc-code', 'ABC'); submit('code-form'); await sleep(50); ok('short code is rejected client-side', /ไม่ครบ/.test(d.getElementById('mc-err').textContent));
  set('mc-code', '0'.repeat(32)); submit('code-form'); await sleep(200); ok('unknown code -> not found message', /ไม่พบการจอง/.test(d.getElementById('mc-err').textContent), d.getElementById('mc-err').textContent);
  set('mc-code', 'https://rooms.test/#code=' + c2); submit('code-form'); await sleep(350);
  ok('pasting a link with a valid code adds that booking to this device', d.querySelectorAll('.bk').length === 1 && /ความลับของคนอื่น/.test(d.getElementById('main').textContent));
  set('ml-email', 'nope'); submit('links-form'); await sleep(50); ok('forgot-code form validates the address', /ไม่ถูกต้อง/.test(d.getElementById('ml-err2').textContent));
  set('ml-email', 'wan@x.co'); submit('links-form'); await sleep(100); ok('forgot-code form calls request_manage_links', world.linkReq && world.linkReq.includes('wan@x.co'));
  // ---------- clash while saving
  click('[data-tab="calendar"]'); click('#cta-top'); set('bk-date', tomorrow, 'change'); set('bk-room', 'r2', 'change'); click('.preset[data-id="pm"]');
  set('bk-name', 'ก'); set('bk-phone', '0811111111'); set('bk-agency', 'ข'); set('bk-email', 'k@x.co'); set('bk-title', 'ชนกัน'); d.getElementById('bk-mode-normal').checked = true; d.getElementById('bk-consent').checked = true;
  world.bookings.push({ id: 'race', code: 'R'.repeat(32), room_id: 'r2', day: tomorrow, start_min: 780, end_min: 960, title: 'ตัดหน้า', booker_name: 'x', agency: 'x', mode: 'normal', attendees: null, needs: [], note: '', status: 'active', prepared: false, created_at: new Date().toISOString() });
  submit('bk-form'); await sleep(350);
  ok('race: clash message with alternative-room buttons, dialog stays open', /มีผู้จองช่วงเวลานี้ไปแล้ว/.test(d.getElementById('bk-err').textContent) && !!d.querySelector('#bk-err [data-act="switch-room"]') && d.getElementById('dlg').hasAttribute('open'), d.getElementById('bk-err').textContent);
  click('#dlg [data-act="close"]');
  // ---------- admin
  click('#admin-link'); ok('admin link opens the sign-in card', !!d.getElementById('auth-login') && /สำหรับผู้ดูแลระบบเท่านั้น/.test(d.getElementById('main').textContent) && !d.querySelector('[data-act="auth-go"][data-v="register"]'));
  set('au-email', 'admin@x.go.th'); set('au-pass', 'bad'); submit('auth-login'); await sleep(80); ok('wrong admin password shows Thai error', /ไม่ถูกต้อง/.test(d.getElementById('au-err').textContent));
  set('au-email', 'stray@x.go.th'); set('au-pass', 'secret123'); submit('auth-login'); await sleep(500);
  ok('an account without admin rights is turned away and signed out', !world.session && /ไม่ได้รับสิทธิ์ผู้ดูแล/.test([...d.querySelectorAll('.toast')].map(t => t.textContent).join(' ')) && tabs() === 'ปฏิทิน|สถานะห้อง|การจองของฉัน', tabs());
  click('#admin-link'); set('au-email', 'admin@x.go.th'); set('au-pass', 'secret123'); submit('auth-login'); await sleep(500);
  ok('admin signs in: tabs, role pill, bell, no public-only tab', tabs() === 'ปฏิทิน|สถานะห้อง|งานผู้ดูแล|จัดการห้อง|บัญชีผู้ดูแล' && d.getElementById('role').textContent === 'ผู้ดูแล' && !d.getElementById('bell').hidden && d.getElementById('admin-link').hidden, tabs());
  click('[data-tab="calendar"]'); click('[data-act="goto-date"][data-date="' + tomorrow + '"]');
  ok('admin sees real titles of everyone\'s bookings, no anonymous blocks', [...d.querySelectorAll('.ev')].some(e => /ความลับของคนอื่น/.test(e.textContent)) && !d.querySelector('.ev.slot'));
  ok('bell counts requester events', Number(d.getElementById('bell-n').textContent) >= 3, d.getElementById('bell-n').textContent);
  click('#bell'); ok('notices speak about "ผู้จอง" (requester) actions', /มีการจองใหม่/.test(d.getElementById('dlg').textContent) && /ผู้จองยกเลิกการจอง/.test(d.getElementById('dlg').textContent)); await sleep(80); click('#dlg [data-act="close"]');
  click('[data-tab="ops"]'); ok('ops list shows phone/email of requesters', /0822222222/.test(d.getElementById('main').textContent) && /wan@x\.co/.test(d.getElementById('main').textContent));
  world.outbox.length = 0; click('[data-tab="calendar"]'); [...d.querySelectorAll('.ev')].find(e => /ความลับ/.test(e.textContent)).click(); click('#dlg [data-act="cancel"]'); ok('admin cancel dialog has a reason box', !!d.getElementById('cx-reason')); set('cx-reason', 'ห้องซ่อม'); click('#dlg [data-act="cancel-do"]'); await sleep(350);
  ok('admin cancel goes through cancel_booking and emails the requester the reason', world.calls.some(c => c[1] === 'cancel_booking') && world.outbox.some(m => m.to === 'wan@x.co' && m.body === 'ห้องซ่อม'));
  click('#cta-top'); set('bk-date', tomorrow, 'change'); set('bk-room', 'r1', 'change'); click('.preset[data-id="am"]');
  ok('admin booking form is not prefilled with the admin\'s own details', d.getElementById('bk-name').value === '');
  set('bk-name', 'ผู้ถูกจองแทน'); set('bk-phone', '0833333333'); set('bk-agency', 'กอง'); set('bk-email', 'c@x.co'); set('bk-title', 'จองแทน'); d.getElementById('bk-mode-online').checked = true; d.getElementById('bk-consent').checked = true;
  submit('bk-form'); await sleep(350);
  ok('admin books on behalf via admin_create_booking, code shown but not stored in admin browser', world.calls.some(c => c[1] === 'admin_create_booking') && d.getElementById('dlg').hasAttribute('open') && !!d.querySelector('.codebox code') && !w.localStorage.getItem('rb.codes') || JSON.parse(w.localStorage.getItem('rb.codes') || '[]').length === 1);
  click('#dlg [data-act="close"]');
  click('[data-tab="rooms"]'); ok('mail settings card with queue counters', !!d.getElementById('mail-form') && d.getElementById('ml-site').value === 'https://rooms.test' && /รอส่ง/.test(d.getElementById('main').textContent));
  set('ml-site', 'javascript:alert(1)'); submit('mail-form'); await sleep(150); ok('invalid site URL refused', /ข้อมูลไม่ถูกต้อง/.test(d.getElementById('ml-err').textContent));
  set('ml-site', 'https://new.example.go.th'); set('ml-admins', 'a@x.co, b@x.co'); submit('mail-form'); await sleep(300); ok('mail settings saved', world.settings.site_url === 'https://new.example.go.th' && world.settings.admin_emails === 'a@x.co, b@x.co');
  click('[data-tab="users"]'); ok('accounts page is about admin accounts only', /บัญชีผู้ดูแล/.test(d.getElementById('main').textContent) && d.querySelectorAll('.usr').length === 2);
  click('#user-btn'); click('#dlg [data-act="logout"]'); await sleep(400);
  ok('logout returns to the public view', tabs() === 'ปฏิทิน|สถานะห้อง|การจองของฉัน' && !d.getElementById('admin-link').hidden && d.getElementById('role').hidden);
  console.log('JS errors:', errors); console.log(results.filter(Boolean).length + '/' + results.length + ' passed'); process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('CRASH', e.stack.split('\n').slice(0, 4).join(' | ')); process.exit(1); });
