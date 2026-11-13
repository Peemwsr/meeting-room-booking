const boot = require('./harness');
const D = n => new Date(Date.now() + 7 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const CODE = 'ABCDEF0123456789ABCDEF0123456789';
const seed = w => {
  w.rooms.push({ id: 'r1', name: 'ห้อง A', capacity: 10, location: '', equipment: [], status: 'open', sort_order: 1, photo_path: null, description: '', created_at: new Date().toISOString() });
  const b = { id: 'b1', code: CODE, room_id: 'r1', day: D(2), start_min: 600, end_min: 660, title: 'ประชุมจากลิงก์', booker_name: 'ก', agency: 'ข', mode: 'normal', attendees: 4, needs: [], note: '', status: 'active', prepared: false, created_at: new Date().toISOString() };
  w.bookings.push(b); w.contacts.push({ booking_id: 'b1', phone: '0811111111', email: 'k@x.co' }); w.slots.push({ bk: 'b1', id: 'b1', room_id: 'r1', day: D(2), start_min: 600, end_min: 660 });
};
(async () => {
  const results = []; const ok = (n, c, x) => { results.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' | ' + x)); };
  // 1) opening the e-mailed link
  let T = await boot(seed, { hash: '#code=' + 'ABCD-EF01-2345-6789-ABCD-EF01-2345-6789' });
  await T.sleep(600);
  ok('link with #code= opens that booking and shows the manage buttons', T.d.getElementById('dlg').hasAttribute('open') && /ประชุมจากลิงก์/.test(T.d.querySelector('#dlg .kv').textContent) && !!T.d.querySelector('#dlg [data-act="edit"]') && !!T.d.querySelector('#dlg [data-act="cancel"]'), T.d.getElementById('dlg').textContent.slice(0, 120));
  ok('the code is removed from the address bar and remembered on this device', T.w.location.hash === '' && JSON.parse(T.w.localStorage.getItem('rb.codes'))[0] === CODE);
  ok('the opened link lands on "my bookings"', T.d.querySelector('.tab[aria-current="page"]').textContent === 'การจองของฉัน' && T.d.querySelectorAll('.bk').length === 1);
  // 2) bad link
  T = await boot(seed, { hash: '#code=' + '1'.repeat(32) }); await T.sleep(500);
  ok('bad link shows an error toast and no dialog', !T.d.getElementById('dlg').hasAttribute('open') && /ไม่พบการจอง/.test([...T.d.querySelectorAll('.toast')].map(x => x.textContent).join(' ')));
  // 3) returning on the same device (code stored from an earlier visit)
  T = await boot(seed, { preload: w => w.localStorage.setItem('rb.codes', JSON.stringify([CODE, '9'.repeat(32)])) }); await T.sleep(500);
  T.click('[data-tab="mine"]');
  ok('stored codes bring the booking back; codes that no longer exist are dropped', T.d.querySelectorAll('.bk').length === 1 && JSON.parse(T.w.localStorage.getItem('rb.codes')).join() === CODE);
  ok('the same hour is not drawn twice on the calendar (own booking replaces the anonymous block)', (T.click('[data-tab="calendar"]'), T.click('[data-act="goto-date"][data-date="' + D(2) + '"]'), T.d.querySelectorAll('.ev').length === 1 && !T.d.querySelector('.ev.slot')));
  // 4) not configured
  T = await boot(seed, { config: { SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co', SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY' } }); await T.sleep(200);
  ok('placeholder config shows the setup message instead of a broken page', /ยังไม่ได้ตั้งค่า Supabase/.test(T.d.getElementById('main').textContent) && T.d.getElementById('navbar').hidden);
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed'); process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('CRASH', e.stack.split('\n').slice(0, 4).join(' | ')); process.exit(1); });
