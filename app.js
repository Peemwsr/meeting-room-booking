/* ระบบจองห้องประชุมจังหวัดสกลนคร: หน้าเว็บ (ต่อกับ Supabase) */
(() => {
'use strict';

/* ================= constants & helpers ================= */
const CFG = window.APP_CONFIG || {};
const DAY_START = (Number(CFG.DAY_START_HOUR) || 8) * 60, DAY_END = (Number(CFG.DAY_END_HOUR) || 16) * 60, STEP = 60, SPAN = DAY_END - DAY_START, NSLOT = SPAN / STEP;
/* meeting format, as in the agency's current request form */
const MODES = { normal: 'ปกติ (ประชุมในห้อง)', online: 'ออนไลน์ (Zoom, Webex ฯลฯ)', vcs: 'VCS มหาดไทย' };
/* quick picks; the hourly slots stay available for anything else. Lunch break 12:00-13:00 is left out of the afternoon. */
const LOG_KINDS = new Set(['created', 'edited', 'moved', 'cancelled', 'prepared', 'conflict']);
const PRESETS = [
  { id: 'am', label: 'เช้า', s: DAY_START, e: 12 * 60 },
  { id: 'pm', label: 'บ่าย', s: 13 * 60, e: DAY_END },
  { id: 'full', label: 'เต็มวัน', s: DAY_START, e: DAY_END }
];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const clone = o => JSON.parse(JSON.stringify(o));
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const minToStr = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const strToMin = s => { const p = String(s).split(':'); return (+p[0]) * 60 + (+p[1]); };
const parseYmd = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const fmtLong = s => parseYmd(s).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtMid = s => parseYmd(s).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const str = (v, max) => typeof v === 'string' ? v.slice(0, max || 200) : '';
const uniq = a => Array.from(new Set(a));
/* ===== requester without an account: remembered booking codes and form details live in this browser ===== */
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage may be unavailable */ } };
const normCode = c => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const prettyCode = c => normCode(c).replace(/(.{4})(?=.)/g, '$1-');
function rememberedCodes() { try { const a = JSON.parse(lsGet('rb.codes') || '[]'); return Array.isArray(a) ? a.map(normCode).filter(c => c.length >= 20).slice(0, 30) : []; } catch (e) { return []; } }
function saveCodes(list) { lsSet('rb.codes', JSON.stringify(uniq(list.map(normCode)).slice(0, 30))); }
function rememberCode(code) { saveCodes([normCode(code)].concat(rememberedCodes())); }
function forgetCode(code) { saveCodes(rememberedCodes().filter(c => c !== normCode(code))); }
function saveRequester(info) { lsSet('rb.requester', JSON.stringify(info)); }
const loadProfile = () => { try { const o = JSON.parse(lsGet('rb.requester') || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };

const ICONS = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  cal: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>'
};
const ic = (n, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[n] + '</svg>';

/* ================= state ================= */
const S = {
  mode: 'boot',   /* boot | setup | live */
  showAuth: false, authView: 'login', authNotice: '', started: false,
  uid: null, isAdmin: false, canBook: true, myName: '', profile: null, users: [], mailCfg: null,
  rooms: [], config: { needs: [], equipment: [] }, optionRows: [], bookings: [], idx: new Map(),
  loaded: { rooms: false, bookings: false }, fresh: false, timedOut: false, rt: false, channel: null,
  now: new Date(), tab: 'calendar', cal: { view: window.innerWidth < 700 ? 'day' : 'week', date: '', room: 'all' }, miniMonth: '', focusRoom: '',
  filter: { minCap: 0, freeOnly: false, equip: '' }, opsOnlyNeeds: false, showHist: false,
  dirty: false, contacts: new Map(),
  seenAt: 0, seenLoaded: false, noticeInit: false, knownNotices: new Set()
};
S.cal.date = ymd(S.now); S.miniMonth = S.cal.date.slice(0, 8) + '01';
let SB = null;   /* Supabase client */
let RP = { blob: null, preview: '', remove: false, room: null };   /* photo being edited in the room dialog */
const BK = { s: null, e: null, own: null };   /* slot selection inside the booking dialog */

const nowMin = () => S.now.getHours() * 60 + S.now.getMinutes();
const todayStr = () => ymd(S.now);
const floorStep = m => Math.floor(m / STEP) * STEP;
const roomSort = (a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'th');
const byTime = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.s - b.s || a.e - b.e;
const isPast = b => b.date < todayStr() || (b.date === todayStr() && b.e <= nowMin());

/* ================= data from Supabase (mapped to the shapes the screens use) ================= */
const photoSrc = r => r && r.photo ? String(CFG.SUPABASE_URL || '').replace(/\/$/, '') + '/storage/v1/object/public/room-photos/' + encodeURIComponent(r.photo) : '';
function mapRoom(d) {
  const cap = Math.floor(Number(d.capacity));
  return {
    id: d.id, name: str(d.name, 80) || 'ห้องไม่มีชื่อ', location: str(d.location, 120), capacity: cap > 0 ? cap : 0,
    equipment: Array.isArray(d.equipment) ? d.equipment.filter(x => typeof x === 'string').slice(0, 40) : [],
    description: str(d.description, 500), status: d.status === 'closed' ? 'closed' : 'open', order: Number(d.sort_order) || 0,
    createdAt: Date.parse(d.created_at) || 0, photo: str(d.photo_path, 200)
  };
}
function mapEvent(e) {
  return { at: Date.parse(e.created_at) || 0, by: e.actor_kind === 'system' ? 'system' : e.actor_kind === 'requester' ? 'requester' : (e.actor_id || ''), k: e.kind, x: str(e.text, 300) };
}
function mapBooking(d, log) {
  const s = Number(d.start_min), e = Number(d.end_min), cx = log.filter(l => l.k === 'cancelled').pop();
  return {
    slot: false, mine: false, code: '', id: d.id, ownerUid: '', roomId: d.room_id, date: String(d.day).slice(0, 10), start: minToStr(s), end: minToStr(e), s, e,
    title: str(d.title, 120), bookerName: str(d.booker_name, 80), contact: '', agency: str(d.agency, 100),
    mode: MODES[d.mode] ? d.mode : '', attendees: Number(d.attendees) || 0,
    needs: Array.isArray(d.needs) ? d.needs.filter(x => typeof x === 'string') : [],
    note: str(d.note, 500), status: d.status === 'cancelled' ? 'cancelled' : 'active', prepared: !!d.prepared,
    createdAt: Date.parse(d.created_at) || 0, schedAt: Date.parse(d.created_at) || 0, cancelledAt: 0,
    cancelledBy: cx ? cx.by : '', cancelReason: '', log, prevSched: null
  };
}
const isMine = b => !!b.mine;
const BASE_B = { ownerUid: '', mine: false, slot: false, code: '', contact: '', cancelledAt: 0, cancelReason: '', log: [], prevSched: null, prepared: false, attendees: 0, needs: [], note: '', agency: '', mode: '', bookerName: '' };
/* an hour somebody else has taken: public visitors see only that it is busy */
function mapSlot(r) {
  const s = Number(r.start_min), e = Number(r.end_min), date = String(r.day).slice(0, 10);
  return Object.assign({}, BASE_B, { id: 'slot:' + r.room_id + date + s, slot: true, roomId: r.room_id, date, start: minToStr(s), end: minToStr(e), s, e, title: 'ไม่ว่าง', status: 'active', createdAt: 0, schedAt: 0, cancelledBy: '' });
}
/* a booking found by its code (the person's own) */
function mapMine(j) {
  const s = Number(j.start_min), e = Number(j.end_min);
  return Object.assign({}, BASE_B, {
    id: j.id, mine: true, code: normCode(j.code), roomId: j.room_id, date: String(j.day).slice(0, 10), start: minToStr(s), end: minToStr(e), s, e,
    title: str(j.title, 120), bookerName: str(j.booker_name, 80), agency: str(j.agency, 100), mode: MODES[j.mode] ? j.mode : '', attendees: Number(j.attendees) || 0,
    needs: Array.isArray(j.needs) ? j.needs.filter(x => typeof x === 'string') : [], note: str(j.note, 500), status: j.status === 'cancelled' ? 'cancelled' : 'active', prepared: !!j.prepared,
    createdAt: Date.parse(j.created_at) || 0, schedAt: Date.parse(j.created_at) || 0, cancelledBy: j.status === 'cancelled' ? 'requester' : '', _phone: str(j.phone, 30), _email: str(j.email, 120)
  });
}
function rebuild() {
  const idx = new Map();
  S.bookings.forEach(b => {
    if (b.status !== 'active') return;
    const k = b.roomId + '|' + b.date;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(b);
  });
  idx.forEach(a => a.sort((x, y) => x.s - y.s || x.e - y.e));
  S.idx = idx;
}
const activeList = (roomId, date) => S.idx.get(roomId + '|' + date) || [];
const findConflict = (roomId, date, s, e, ignoreKey, list) => {
  const src = list ? list.filter(b => b.status === 'active' && b.roomId === roomId && b.date === date) : activeList(roomId, date);
  return src.find(b => (b.ownerUid + ':' + b.id) !== ignoreKey && s < b.e && b.s < e);
};
const bkey = b => b.ownerUid + ':' + b.id;
const findBooking = key => S.bookings.find(b => bkey(b) === key);
const roomOf = id => S.rooms.find(r => r.id === id);
const roomName = id => { const r = roomOf(id); return r ? r.name : 'ห้องที่ถูกลบแล้ว'; };
const allEquipment = () => uniq(S.config.equipment.concat(...S.rooms.map(r => r.equipment)));

function roomStatus(r) {
  if (r.status === 'closed') return { state: 'closed' };
  const m = nowMin(), list = activeList(r.id, todayStr());
  const cur = list.find(b => b.s <= m && m < b.e);
  if (cur) return { state: 'busy', booking: cur };
  const off = m < DAY_START || m >= DAY_END;
  return { state: 'free', next: list.find(b => b.s > m), off };
}
/* one hour slot of one room on one date: free, busy (someone booked it) or past */
function slotState(roomId, date, m, own) {
  if (own && roomId === own.roomId && date === own.date && m >= own.s && m < own.e) return { k: 'free' };   /* the booking being edited keeps its own hours */
  const today = todayStr();
  if (!date || date < today || (date === today && m < floorStep(nowMin()))) return { k: 'past' };
  const b = activeList(roomId, date).find(x => (!own || bkey(x) !== own.key) && x.s < m + STEP && m < x.e);
  return b ? { k: 'busy', b } : { k: 'free' };
}

/* ================= backend (Supabase) ================= */
function errMsg(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  const map = [
    ['slot_taken', 'มีผู้จองช่วงเวลานี้ไปแล้ว'], ['not_found', 'ไม่พบการจองจากรหัสนี้ ตรวจรหัสอีกครั้ง'], ['rate_limited', 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'], ['limit_reached', 'อีเมลนี้มีการจองที่ยังไม่ถึงวันครบจำนวนที่กำหนดแล้ว'], ['past_slot', 'ช่วงเวลานี้ผ่านไปแล้ว'], ['outside_hours', 'อยู่นอกเวลาเปิดจอง'],
    ['room_closed', 'ห้องนี้ปิดใช้งาน'], ['over_capacity', 'จำนวนผู้เข้าร่วมเกินความจุห้อง'], ['invalid_phone', 'หมายเลขโทรศัพท์ไม่ถูกต้อง'],
    ['invalid_email', 'รูปแบบอีเมลไม่ถูกต้อง'], ['not_logged_in', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'], ['JWT expired', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'],
    ['forbidden', 'ไม่มีสิทธิ์ทำรายการนี้'], ['row-level security', 'ไม่มีสิทธิ์ทำรายการนี้'], ['gone', 'การจองนี้ถูกยกเลิกหรือแก้ไขไม่ได้แล้ว'],
    ['last_admin', 'ต้องมีผู้ดูแลอย่างน้อย 1 คน'], ['room_has_bookings', 'ห้องนี้เคยมีการจอง ลบไม่ได้ ให้ปิดใช้งานแทน'],
    ['invalid', 'ข้อมูลไม่ถูกต้อง'], ['Failed to fetch', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง'], ['duplicate key', 'มีรายการนี้อยู่แล้ว']
  ];
  for (let i = 0; i < map.length; i++) if (m.indexOf(map[i][0]) >= 0) return map[i][1];
  return 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง';
}
async function must(q) { const r = await q; if (r && r.error) throw r.error; return r ? r.data : null; }
const rpc = (name, args) => must(SB.rpc(name, args || {}));
let loading = false, again = false, refreshTimer = null;
function onLoadError(e) { console.warn('load', e); S.timedOut = true; renderTop(); safeRender(); }
async function loadOnce() {
  const from = addDays(todayStr(), -45);
  if (S.uid) {
    const prof = await must(SB.from('profiles').select('*').eq('id', S.uid).single());
    S.profile = prof; S.isAdmin = prof.role === 'admin'; S.myName = prof.full_name || '';
  } else { S.profile = null; S.isAdmin = false; S.myName = ''; }
  const jobs = [must(SB.from('rooms').select('*').order('sort_order').order('name')), must(SB.from('options').select('*').order('sort_order').order('name'))];
  const codes = rememberedCodes();
  if (S.isAdmin) {
    jobs.push(must(SB.from('bookings').select('*').gte('day', from).order('day').limit(5000)),
      must(SB.from('booking_contacts').select('*').limit(5000)),
      must(SB.from('booking_events').select('*').gte('created_at', new Date(Date.now() - 31 * 864e5).toISOString()).order('created_at').limit(5000)),
      must(SB.from('profiles').select('*').order('created_at').limit(2000)), rpc('get_mail_settings'));
  } else {
    jobs.push(must(SB.from('public_slots').select('room_id,day,start_min,end_min').gte('day', from).limit(5000)), codes.length ? rpc('get_bookings_by_codes', { p_codes: codes }) : Promise.resolve([]));
  }
  const r = await Promise.all(jobs);
  const rooms = r[0] || [], opts = r[1] || [];
  S.rooms = rooms.map(mapRoom).sort(roomSort);
  S.optionRows = opts;
  S.config = { needs: opts.filter(o => o.kind === 'need').map(o => o.name), equipment: opts.filter(o => o.kind === 'equipment').map(o => o.name) };
  if (S.isAdmin) {
    const books = r[2] || [], contacts = r[3] || [], events = r[4] || [], evBy = {};
    events.forEach(e => { (evBy[e.booking_id] = evBy[e.booking_id] || []).push(mapEvent(e)); });
    S.bookings = books.map(b => mapBooking(b, (evBy[b.id] || []).slice(-10)));
    const byId = new Map(S.bookings.map(b => [b.id, b])), cm = new Map();
    contacts.forEach(c => { const b = byId.get(c.booking_id); if (b) cm.set(bkey(b), { phone: str(c.phone, 30), email: str(c.email, 120) }); });
    S.contacts = cm; S.users = r[5] || []; S.mailCfg = r[6] || null;
    S.seenAt = Math.max(S.seenAt, Date.parse(S.profile.notices_seen_at) || 0); S.seenLoaded = true;
  } else {
    const mine = (r[3] || []).map(mapMine), taken = new Set(mine.filter(b => b.status === 'active').map(b => b.roomId + '|' + b.date + '|' + b.s + '|' + b.e));
    const slots = (r[2] || []).filter(x => !taken.has(x.room_id + '|' + String(x.day).slice(0, 10) + '|' + x.start_min + '|' + x.end_min)).map(mapSlot);
    S.bookings = mine.concat(slots);
    const cm = new Map(); mine.forEach(b => cm.set(bkey(b), { phone: b._phone, email: b._email })); S.contacts = cm;
    if (codes.length) { const found = new Set(mine.map(b => b.code)); saveCodes(codes.filter(c => found.has(c))); }   /* forget codes that no longer exist */
    S.users = []; S.mailCfg = null;
  }
  S.canBook = true; S.loaded.rooms = S.loaded.bookings = true; S.fresh = true; S.timedOut = false;
  rebuild(); afterData();
}
async function loadAll() {
  if (!SB) return;
  if (loading) { again = true; return; }
  loading = true;
  try { await loadOnce(); } finally { loading = false; }
  if (again) { again = false; return loadAll(); }
}
function startRealtime() {
  if (S.channel || !SB.channel) return;
  const kick = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => loadAll().catch(onLoadError), 250); };
  let ch = SB.channel('rb-changes');
  (S.isAdmin ? ['rooms', 'options', 'public_slots', 'bookings', 'booking_events', 'booking_contacts', 'profiles'] : ['rooms', 'options', 'public_slots'])
    .forEach(t => { ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, kick); });
  S.channel = ch;
  ch.subscribe(st => { S.rt = st === 'SUBSCRIBED'; renderTop(); });
}
function stopRealtime() { if (S.channel && SB && SB.removeChannel) { try { SB.removeChannel(S.channel); } catch (e) { /* ignore */ } } S.channel = null; S.rt = false; }

/* ================= rendering: parts ================= */
/* a row of hourly cells for one room: free, booked by others, booked by me, now */
function slotStrip(roomId, date) {
  const list = activeList(roomId, date), today = todayStr(), m0 = nowMin();
  let cells = '', ticks = '', i = 0;
  for (let m = DAY_START; m < DAY_END; m += STEP, i++) {
    const b = list.find(x => x.s < m + STEP && m < x.e);
    const cls = b ? (isMine(b) ? 'mine' : 'busy') : 'free';
    const past = date < today || (date === today && m + STEP <= m0);
    const cur = date === today && m <= m0 && m0 < m + STEP;
    cells += '<i class="sc ' + cls + (past ? ' past' : '') + (cur ? ' cur' : '') + '" title="' + minToStr(m) + ' ถึง ' + minToStr(m + STEP) + (b ? ' ถูกจอง' : ' ว่าง') + '"></i>';
    ticks += '<span>' + pad(m / 60) + '</span>';
  }
  const label = list.length ? 'ช่วงที่ถูกจองวันนี้ ' + list.map(b => b.start + ' ถึง ' + b.end).join(', ') : 'วันนี้ยังไม่มีการจอง';
  return '<div class="sstrip" style="--n:' + NSLOT + '"><div class="sgrid" role="img" aria-label="' + esc(label) + '">' + cells + '</div><div class="sticks" aria-hidden="true">' + ticks + '</div><p class="scap">ช่องละ 1 ชั่วโมง ตั้งแต่ ' + pad(DAY_START / 60) + ' ถึง ' + pad(DAY_END / 60) + ' น.</p></div>';
}
const chipsOf = (arr, cls) => arr.length ? '<div class="chips">' + arr.map(x => '<span class="chip' + (cls ? ' ' + cls : '') + '">' + esc(x) + '</span>').join('') + '</div>' : '';

function emptyState(title, text, btn) {
  return '<div class="empty">' + ic('cal', '') + '<h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' + (btn || '') + '</div>';
}

/* ================= rendering: views ================= */
/* room photo, or a soft placeholder when there is none (or the file cannot load) */
function photoInner(r, cls) {
  const src = photoSrc(r);
  return '<span class="ph">' + ic('image') + '</span>' + (src ? '<img data-ph class="' + cls + '" src="' + esc(src) + '" alt="รูป ' + esc(r.name) + '">' : '');
}
function roomCard(r) {
  const st = roomStatus(r);
  let icon, line, sub = '';
  if (st.state === 'closed') { icon = 'wrench'; line = 'ปิดใช้งานชั่วคราว'; sub = r.description || 'ขณะนี้ยังไม่เปิดให้จอง'; }
  else if (st.state === 'busy') { icon = 'clock'; line = 'ไม่ว่างถึง ' + minToStr(st.booking.e) + ' น.'; sub = st.booking.title + (st.booking.bookerName ? ' โดย ' + st.booking.bookerName : ''); }
  else {
    icon = 'check';
    if (st.off) { line = 'ว่าง'; sub = 'นอกเวลาจอง (' + minToStr(DAY_START) + ' ถึง ' + minToStr(DAY_END) + ' น.)'; }
    else if (st.next) { line = 'ว่างถึง ' + st.next.start + ' น.'; sub = 'ถัดไป ' + st.next.title + ' เวลา ' + st.next.start + ' ถึง ' + st.next.end + ' น.'; }
    else { line = 'ว่างตลอดช่วงที่เหลือของวัน'; sub = 'ยังไม่มีการจองต่อจากนี้'; }
  }
  const eq = r.equipment.slice(0, 5), more = r.equipment.length - eq.length;
  const eqChips = eq.map(x => '<span class="chip">' + esc(x) + '</span>').join('') + (more > 0 ? '<span class="chip">อีก ' + more + ' รายการ</span>' : '');
  return '<article class="room ' + st.state + '">' +
    '<div class="shot">' + photoInner(r, 'shot-img') + '<span class="medal-st" aria-hidden="true">' + ic(icon) + '</span></div><div class="room-body">' +
    '<h2>' + esc(r.name) + '</h2>' + (r.location ? '<p class="loc">' + ic('pin') + '<span>' + esc(r.location) + '</span></p>' : '') +
    '<p class="cap-line">' + ic('users') + 'รองรับ ' + (r.capacity || '-') + ' ที่นั่ง</p>' +
    '<p class="state">' + ic(icon) + '<span>' + esc(line) + '</span></p>' +
    '<p class="sub">' + esc(sub) + '</p>' +
    (r.status === 'closed' ? '' : slotStrip(r.id, todayStr())) +
    (eqChips ? '<div class="chips">' + eqChips + '</div>' : '') +
    '<div class="room-act"><button type="button" class="btn primary sm" data-act="book" data-room="' + esc(r.id) + '"' + (r.status === 'closed' ? ' disabled' : '') + '>' + ic('plus') + 'จองห้องนี้</button>' +
    '<button type="button" class="btn sm" data-act="goto-schedule" data-room="' + esc(r.id) + '">' + ic('cal') + 'ดูตารางเวลา</button></div></div></article>';
}

function viewOverview() {
  const f = S.filter, m = nowMin();
  const open = S.rooms.filter(r => r.status !== 'closed');
  const free = open.filter(r => roomStatus(r).state === 'free').length;
  const off = m < DAY_START || m >= DAY_END;
  const list = S.rooms.filter(r => {
    if (f.minCap && r.capacity < f.minCap) return false;
    if (f.equip && r.equipment.indexOf(f.equip) < 0) return false;
    if (f.freeOnly && roomStatus(r).state !== 'free') return false;
    return true;
  });
  const capOpts = [0, 4, 8, 12, 20, 30, 50].map(n => '<option value="' + n + '"' + (f.minCap === n ? ' selected' : '') + '>' + (n ? n + ' ที่นั่งขึ้นไป' : 'ทุกขนาด') + '</option>').join('');
  const eqOpts = '<option value="">ทุกแบบ</option>' + allEquipment().map(x => '<option value="' + esc(x) + '"' + (f.equip === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
  const heading = open.length ? '<span>ห้องประชุมที่ว่างตอนนี้</span><span>' + free + ' จาก ' + open.length + ' ห้อง</span>' : '<span>จองห้องประชุม</span><span>ง่ายและเห็นสถานะทันที</span>';
  const copy = '<div class="hero-copy"><h1 class="hero-title">' + heading + '</h1>' +
    '<p class="hero-sub">' + esc(fmtLong(todayStr())) + ' เวลา <b>' + minToStr(m) + ' น.</b>' + (off ? ' (นอกเวลาจอง)' : '') + '<br>จองได้ครั้งละ 1 ชั่วโมง ระหว่าง ' + minToStr(DAY_START) + ' ถึง ' + minToStr(DAY_END) + ' น.</p>' +
    '<div class="hero-cta"><button type="button" class="btn primary big" data-act="book-new"' + (S.canBook ? '' : ' disabled') + '>' + ic('plus') + 'จองห้องประชุม</button></div>' +
    (S.rooms.length ? '<div class="filters"><label class="fld">จำนวนที่นั่ง<select data-filter="minCap" data-fk="f-cap">' + capOpts + '</select></label>' +
      '<label class="fld">อุปกรณ์ในห้อง<select data-filter="equip" data-fk="f-eq">' + eqOpts + '</select></label>' +
      '<label class="check"><input type="checkbox" data-filter="freeOnly" data-fk="f-free"' + (f.freeOnly ? ' checked' : '') + '>เฉพาะห้องที่ว่างตอนนี้</label></div>' : '') + '</div>';
  let right;
  if (!S.loaded.rooms) right = '<div class="rooms"><div class="skel"></div><div class="skel"></div></div>';
  else if (!S.rooms.length) right = emptyState('ยังไม่มีห้องประชุม', S.isAdmin ? 'เริ่มจากเพิ่มห้องแรก ระบุจำนวนที่นั่งและอุปกรณ์ในห้อง' : 'ผู้ดูแลยังไม่ได้เพิ่มห้องประชุมเข้าระบบ',
    S.isAdmin ? '<button type="button" class="btn primary" data-act="room-new">' + ic('plus') + 'เพิ่มห้องประชุม</button>' : '');
  else if (!list.length) right = emptyState('ไม่มีห้องที่ตรงกับตัวกรอง', 'ลองลดจำนวนที่นั่งหรือเลือกอุปกรณ์แบบอื่น', '<button type="button" class="btn" data-act="reset-filters">ล้างตัวกรอง</button>');
  else right = '<div class="rooms">' + list.map(roomCard).join('') + '</div>';
  return '<section class="hero">' + copy + '<div>' + right + '</div></section>';
}

/* ================= calendar (Google Calendar style) ================= */
const WD = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const WD_MINI = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const startOfWeek = s => addDays(s, -parseYmd(s).getDay());
const monthStart = s => s.slice(0, 8) + '01';
const addMonths = (s, n) => { const d = parseYmd(monthStart(s)); d.setMonth(d.getMonth() + n); return ymd(d); };
const daysIn = s => { const d = parseYmd(s); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };
const fmtMonthYear = s => parseYmd(s).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
const roomClass = id => { const i = S.rooms.findIndex(r => r.id === id); return i < 0 ? 'rcx' : 'rc' + (i % 8); };
const calRooms = () => S.cal.room === 'all' ? S.rooms : S.rooms.filter(r => r.id === S.cal.room);
function calEvents(from, to) {
  const ids = new Set(calRooms().map(r => r.id));
  return S.bookings.filter(b => b.status === 'active' && ids.has(b.roomId) && b.date >= from && b.date <= to);
}
function calTitle() {
  const c = S.cal;
  if (c.view === 'day') return fmtLong(c.date);
  if (c.view === 'month') return fmtMonthYear(c.date);
  const a = startOfWeek(c.date), b = addDays(a, 6), da = parseYmd(a), db = parseYmd(b);
  if (da.getMonth() === db.getMonth()) return da.getDate() + ' – ' + db.getDate() + ' ' + fmtMonthYear(b);
  const sm = d => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  return sm(da) + ' – ' + sm(db) + ' ' + db.toLocaleDateString('th-TH', { year: 'numeric' });
}
function calShift(dir) {
  const c = S.cal;
  if (c.view === 'day') c.date = addDays(c.date, dir);
  else if (c.view === 'week') c.date = addDays(c.date, 7 * dir);
  else { const n = addMonths(c.date, dir); c.date = monthStart(n) === monthStart(todayStr()) ? todayStr() : n; }
  S.miniMonth = monthStart(c.date);
  renderMain();
}
function roomBadge(r) {
  const s = roomStatus(r);
  if (s.state === 'closed') return { cls: 'off', txt: 'ปิด', tip: 'ปิดใช้งานชั่วคราว' };
  if (s.state === 'busy') return { cls: 'busy', txt: 'ไม่ว่าง', tip: 'ไม่ว่างถึง ' + minToStr(s.booking.e) + ' น.' };
  return { cls: 'free', txt: 'ว่าง', tip: s.off ? 'นอกเวลาจอง' : (s.next ? 'ว่างถึง ' + s.next.start + ' น.' : 'ว่างตลอดช่วงที่เหลือของวัน') };
}
/* can this hour be booked? 'ok' | 'past' | 'busy' | 'off' (outside booking hours) | 'closed' */
function slotAvail(date, m, roomId) {
  if (m < DAY_START || m >= DAY_END) return 'off';
  if (roomId) {
    const r = roomOf(roomId); if (!r || r.status === 'closed') return 'closed';
    const st = slotState(roomId, date, m); return st.k === 'free' ? 'ok' : st.k;
  }
  const open = S.rooms.filter(r => r.status !== 'closed');
  if (!open.length) return 'closed';
  let past = false;
  for (const r of open) { const st = slotState(r.id, date, m); if (st.k === 'free') return 'ok'; if (st.k === 'past') past = true; }
  return past ? 'past' : 'busy';
}
function gridRange(evs) {
  let gs = DAY_START, ge = DAY_END;
  evs.forEach(b => { gs = Math.min(gs, floorStep(b.s)); ge = Math.max(ge, Math.ceil(b.e / STEP) * STEP); });
  return [gs, ge];
}
/* overlapping bookings (different rooms) sit side by side */
function layoutLanes(evs) {
  const sorted = evs.slice().sort((a, b) => a.s - b.s || a.e - b.e), out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const ends = [], lane = new Map();
    cluster.forEach(ev => { let i = ends.findIndex(e => e <= ev.s); if (i < 0) { i = ends.length; ends.push(0); } ends[i] = ev.e; lane.set(ev, i); });
    cluster.forEach(ev => out.push({ b: ev, lane: lane.get(ev), lanes: ends.length }));
    cluster = [];
  };
  sorted.forEach(ev => { if (cluster.length && ev.s >= clusterEnd) { flush(); clusterEnd = -1; } cluster.push(ev); clusterEnd = Math.max(clusterEnd, ev.e); });
  flush(); return out;
}
function evHtml(b, lane, lanes, gs, ge, showRoom) {
  const span = ge - gs, top = (b.s - gs) / span * 100, h = (b.e - b.s) / span * 100, w = 100 / lanes, left = lane * w;
  const r = roomOf(b.roomId), mine = isMine(b);
  const pos = 'top:calc(' + top + '% + 2px);height:calc(' + h + '% - 4px);left:calc(' + left + '% + 3px);width:calc(' + w + '% - 6px)';
  if (b.slot) {   /* somebody else's hour: nothing to open, no personal data */
    const tip = 'ไม่ว่าง ' + b.start + ' ถึง ' + b.end + (r ? ' ' + r.name : '');
    return '<div class="ev slot ' + roomClass(b.roomId) + '" style="' + pos + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '"><b>ไม่ว่าง</b><span>' + b.start + '–' + b.end + '</span>' + (showRoom && r ? '<span>' + esc(r.name) + '</span>' : '') + '</div>';
  }
  const tip = b.title + ' ' + b.start + ' ถึง ' + b.end + (r ? ' ' + r.name : '');
  return '<button type="button" class="ev ' + roomClass(b.roomId) + '" style="' + pos + '" data-act="detail" data-key="' + esc(bkey(b)) + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '">' +
    '<b>' + esc(b.title) + '</b><span>' + b.start + '–' + b.end + (mine ? '<i class="me">ของฉัน</i>' : '') + '</span>' +
    (showRoom && r ? '<span>' + esc(r.name) + '</span>' : '') + '</button>';
}
function roomHead(r, date) {
  let st = '';
  if (r.status === 'closed') st = '<span class="rstat off">ปิดใช้งาน</span>';
  else if (date === todayStr()) { const s = roomStatus(r); st = s.state === 'busy' ? '<span class="rstat busy">ไม่ว่างถึง ' + minToStr(s.booking.e) + '</span>' : '<span class="rstat free">ว่างตอนนี้</span>'; }
  return '<div class="rhead ' + roomClass(r.id) + '"><span class="rdot"></span><b>' + esc(r.name) + '</b><small>' + (r.capacity || '-') + ' ที่นั่ง</small>' + st + '</div>';
}
function dayHead(date) {
  const d = parseYmd(date);
  return '<button type="button" class="dhead' + (date === todayStr() ? ' today' : '') + '" data-act="goto-day" data-date="' + date + '" aria-label="' + esc(fmtLong(date)) + '"><small>' + WD[d.getDay()] + '</small><b>' + d.getDate() + '</b></button>';
}
function timeGridHtml(cols, evsAll) {
  const today = todayStr(), m0 = nowMin(), r = gridRange(evsAll), gs = r[0], ge = r[1], n = (ge - gs) / STEP;
  let times = '';
  for (let m = gs; m < ge; m += STEP) times += '<div class="tg-time"><span>' + minToStr(m) + '</span></div>';
  times += '<div class="tg-time end"><span>' + minToStr(ge) + '</span></div>';
  const heads = cols.map(c => '<div class="tg-h">' + c.head + '</div>').join('');
  const body = cols.map(c => {
    let cells = '';
    for (let m = gs; m < ge; m += STEP) {
      const a = slotAvail(c.date, m, c.roomId);
      cells += '<button type="button" class="tg-cell ' + a + '" tabindex="-1" data-act="cell" data-date="' + c.date + '" data-room="' + esc(c.roomId || '') + '" data-m="' + m + '"' + (a !== 'ok' ? ' disabled' : '') + ' aria-label="' + esc('จอง ' + fmtMid(c.date) + ' ' + minToStr(m) + ' ถึง ' + minToStr(m + STEP)) + '"></button>';
    }
    const evs = layoutLanes(c.evs).map(x => evHtml(x.b, x.lane, x.lanes, gs, ge, c.showRoom)).join('');
    const now = c.date === today && m0 >= gs && m0 < ge ? '<i class="nowline" style="top:' + ((m0 - gs) / (ge - gs) * 100) + '%"></i>' : '';
    return '<div class="tg-col' + (c.roomId ? '' : ' all') + (c.closed ? ' closed' : '') + (c.date === today ? ' today' : '') + '">' + cells + evs + now + (c.closed ? '<span class="closed-t">ปิดใช้งานชั่วคราว</span>' : '') + '</div>';
  }).join('');
  return '<div class="tg-scroll"><div class="tg" style="--cols:' + cols.length + ';--n:' + n + '"><div class="tg-row head"><div></div>' + heads + '</div><div class="tg-row body"><div class="tg-times">' + times + '</div>' + body + '</div></div></div>';
}
function monthHtml() {
  const first = monthStart(S.cal.date), fd = parseYmd(first).getDay(), weeks = Math.ceil((fd + daysIn(first)) / 7);
  const start = addDays(first, -fd), end = addDays(start, weeks * 7 - 1), today = todayStr();
  const by = {}; calEvents(start, end).forEach(b => { (by[b.date] = by[b.date] || []).push(b); });
  let h = '<div class="mg-h">' + WD_MINI.map(w => '<div>' + w + '</div>').join('') + '</div><div class="mg">';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), list = (by[d] || []).sort(byTime), show = list.slice(0, 3), more = list.length - show.length;
    h += '<div class="mcell' + (d.slice(0, 7) !== first.slice(0, 7) ? ' out' : '') + (d === today ? ' today' : '') + (d < today ? ' past' : '') + '">' +
      '<button type="button" class="mnum" data-act="goto-day" data-date="' + d + '" aria-label="' + esc(fmtLong(d)) + '">' + dayNum(d) + '</button>' +
      show.map(b => b.slot ? '<span class="mchip slot ' + roomClass(b.roomId) + '" title="ไม่ว่าง ' + b.start + ' ถึง ' + b.end + '">' + b.start + ' ไม่ว่าง</span>' : '<button type="button" class="mchip ' + roomClass(b.roomId) + '" data-act="detail" data-key="' + esc(bkey(b)) + '" title="' + esc(b.title + ' ' + b.start + ' ถึง ' + b.end + ' ' + roomName(b.roomId)) + '">' + b.start + ' ' + esc(b.title) + '</button>').join('') +
      (more > 0 ? '<button type="button" class="mmore" data-act="goto-day" data-date="' + d + '">อีก ' + more + ' รายการ</button>' : '') + '</div>';
  }
  return h + '</div>';
}
const dayNum = s => parseYmd(s).getDate();
function miniHtml() {
  const first = S.miniMonth, fd = parseYmd(first).getDay(), weeks = Math.ceil((fd + daysIn(first)) / 7);
  const start = addDays(first, -fd), end = addDays(start, weeks * 7 - 1), today = todayStr(), c = S.cal;
  const has = {}; calEvents(start, end).forEach(b => { has[b.date] = 1; });
  let selA = c.date, selB = c.date;
  if (c.view === 'week') { selA = startOfWeek(c.date); selB = addDays(selA, 6); } else if (c.view === 'month') { selA = selB = ''; }
  let h = '<div class="mini-h"><b>' + esc(fmtMonthYear(first)) + '</b><span><button type="button" class="icon-btn" data-act="mini-prev" data-fk="mini-prev" aria-label="เดือนก่อนหน้า">' + ic('left') + '</button><button type="button" class="icon-btn" data-act="mini-next" data-fk="mini-next" aria-label="เดือนถัดไป">' + ic('right') + '</button></span></div><div class="mini-g">' +
    WD_MINI.map(w => '<small>' + w + '</small>').join('');
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    h += '<button type="button" class="mday' + (d.slice(0, 7) !== first.slice(0, 7) ? ' out' : '') + (selA && d >= selA && d <= selB ? ' sel' : '') + (d === today ? ' today' : '') + (has[d] ? ' has' : '') + '" data-act="goto-date" data-date="' + d + '" data-fk="mday-' + d + '" aria-label="' + esc(fmtLong(d)) + '">' + dayNum(d) + '</button>';
  }
  return h + '</div>';
}
function sideHtml() {
  const open = S.rooms.filter(r => r.status !== 'closed');
  const free = open.filter(r => roomStatus(r).state === 'free').length;
  const items = '<button type="button" class="ritem all" data-act="pick-room" data-room="all" data-fk="room-all" aria-pressed="' + (S.cal.room === 'all') + '"><span class="rdot"></span><span class="rname"><b>ทุกห้อง</b><small>' + S.rooms.length + ' ห้อง</small></span><span class="rstat ' + (free ? 'free' : 'busy') + '">ว่าง ' + free + '/' + open.length + '</span></button>' +
    S.rooms.map(r => {
      const bd = roomBadge(r);
      return '<button type="button" class="ritem ' + roomClass(r.id) + '" data-act="pick-room" data-room="' + esc(r.id) + '" data-fk="room-' + esc(r.id) + '" aria-pressed="' + (S.cal.room === r.id) + '"><span class="rdot"></span><span class="rname"><b>' + esc(r.name) + '</b><small>' + (r.capacity || '-') + ' ที่นั่ง</small></span><span class="rstat ' + bd.cls + '" title="' + esc(bd.tip) + '">' + bd.txt + '</span></button>';
    }).join('');
  return '<aside class="side"><button type="button" class="btn primary big side-cta" data-act="book-new"' + (S.canBook ? '' : ' disabled') + '>' + ic('plus') + 'จองห้อง</button>' +
    '<section class="mini" aria-label="ปฏิทินย่อ">' + miniHtml() + '</section>' +
    '<section class="rlist"><h2>ห้องประชุม (สถานะตอนนี้)</h2><div class="ritems">' + items + '</div></section></aside>';
}
function viewCalendar() {
  const c = S.cal;
  if (c.room !== 'all' && !roomOf(c.room)) c.room = 'all';
  if (!S.loaded.rooms) return '<div class="skel" style="height:460px"></div>';
  if (!S.rooms.length) return emptyState('ยังไม่มีห้องประชุม', S.isAdmin ? 'เริ่มจากเพิ่มห้องแรก ระบุจำนวนที่นั่งและอุปกรณ์ในห้อง แล้วปฏิทินจะแสดงที่นี่' : 'ผู้ดูแลยังไม่ได้เพิ่มห้องประชุมเข้าระบบ',
    S.isAdmin ? '<button type="button" class="btn primary" data-act="room-new">' + ic('plus') + 'เพิ่มห้องประชุม</button>' : '');
  let body;
  if (c.view === 'month') body = monthHtml();
  else if (c.view === 'week') {
    const a = startOfWeek(c.date), evs = calEvents(a, addDays(a, 6));
    const cols = [0, 1, 2, 3, 4, 5, 6].map(i => { const d = addDays(a, i); return { date: d, roomId: c.room === 'all' ? null : c.room, closed: false, showRoom: c.room === 'all', evs: evs.filter(b => b.date === d), head: dayHead(d) }; });
    body = timeGridHtml(cols, evs);
  } else {
    const evs = calEvents(c.date, c.date);
    body = timeGridHtml(calRooms().map(r => ({ date: c.date, roomId: r.id, closed: r.status === 'closed', showRoom: false, evs: evs.filter(b => b.roomId === r.id), head: roomHead(r, c.date) })), evs);
  }
  const seg = [['day', 'วัน'], ['week', 'สัปดาห์'], ['month', 'เดือน']].map(v => '<button type="button" data-act="cal-view" data-v="' + v[0] + '" data-fk="view-' + v[0] + '" aria-pressed="' + (c.view === v[0]) + '">' + v[1] + '</button>').join('');
  const bar = '<div class="cal-bar"><button type="button" class="btn sm" data-act="cal-today" data-fk="cal-today">วันนี้</button>' +
    '<button type="button" class="icon-btn" data-act="cal-prev" data-fk="cal-prev" aria-label="ก่อนหน้า">' + ic('left') + '</button><button type="button" class="icon-btn" data-act="cal-next" data-fk="cal-next" aria-label="ถัดไป">' + ic('right') + '</button>' +
    '<h1 class="cal-title">' + esc(calTitle()) + '</h1><span class="grow"></span>' +
    '<input type="date" class="cal-date" id="cal-date" value="' + esc(c.date) + '" aria-label="ไปยังวันที่" data-fk="cal-date"><div class="seg" role="group" aria-label="มุมมองปฏิทิน">' + seg + '</div></div>';
  const note = '<div class="cal-note"><span>แตะช่องว่างเพื่อจอง ช่องละ 1 ชั่วโมง จองได้ ' + minToStr(DAY_START) + ' ถึง ' + minToStr(DAY_END) + ' น.</span>' +
    (c.view === 'day' && c.room === 'all' ? '<span>แยกคอลัมน์ตามห้อง</span>' : (c.room === 'all' ? '<span>สีของแต่ละห้องตรงกับรายการด้านซ้าย</span>' : '')) + '</div>';
  return '<div class="calpage">' + sideHtml() + '<section class="cal" aria-label="ปฏิทินการจองห้องประชุม">' + bar + body + note + '</section></div>';
}

function cancelTag(b) {
  if (b.cancelReason === 'conflict') return 'ยกเลิกโดยระบบ (เวลาชนกับผู้จองก่อนหน้า)';
  if (b.cancelledBy && b.cancelledBy !== 'requester') return 'ยกเลิกโดยผู้ดูแล';
  return 'ยกเลิกแล้ว';
}
function canCancel(b) { return b.status === 'active' && !isPast(b) && (isMine(b) || S.isAdmin); }

function bookingCard(b, opts) {
  opts = opts || {};
  const ctc = S.contacts.get(bkey(b));
  const d = parseYmd(b.date), today = b.date === todayStr();
  const live = b.status === 'active' && today && b.s <= nowMin() && nowMin() < b.e;
  let tag = '';
  if (b.status === 'cancelled') tag = '<span class="status-tag bad">' + esc(cancelTag(b)) + '</span>';
  else if (live) tag = '<span class="status-tag live">กำลังใช้งาน</span>';
  else if (isPast(b)) tag = '<span class="status-tag">เสร็จสิ้นแล้ว</span>';
  else if (b.prepared) tag = '<span class="status-tag ok">' + ic('check') + 'ผู้ดูแลเตรียมแล้ว</span>';
  const acts = [];
  if (opts.ops && b.status === 'active' && !isPast(b)) acts.push('<label class="check"><input type="checkbox" data-act="prepared" data-key="' + esc(bkey(b)) + '"' + (b.prepared ? ' checked' : '') + '>เตรียมพร้อมแล้ว</label>');
  acts.push('<button type="button" class="btn sm" data-act="detail" data-key="' + esc(bkey(b)) + '">รายละเอียด</button>');
  if (canCancel(b)) acts.push('<button type="button" class="btn sm" data-act="edit" data-key="' + esc(bkey(b)) + '">แก้ไข</button>');
  if (canCancel(b)) acts.push('<button type="button" class="btn sm danger" data-act="cancel" data-key="' + esc(bkey(b)) + '">ยกเลิกการจอง</button>');
  if (b.mine && b.code && (b.status === 'cancelled' || isPast(b))) acts.push('<button type="button" class="btn sm" data-act="forget-code" data-code="' + esc(b.code) + '">ลบออกจากรายการ</button>');
  return '<li class="bk' + (b.status === 'cancelled' ? ' cancelled' : '') + '"><div class="bk-date' + (today ? ' today' : '') + '"><small>' + esc(d.toLocaleDateString('th-TH', { weekday: 'short' })) + '</small><b>' + d.getDate() + '</b><small>' + esc(d.toLocaleDateString('th-TH', { month: 'short' })) + '</small></div>' +
    '<div><h3>' + esc(b.title) + '</h3><p>' + esc(roomName(b.roomId)) + ' เวลา ' + b.start + ' ถึง ' + b.end + ' น.</p>' +
    (opts.ops ? '<p>ผู้จอง ' + esc(b.bookerName || '-') + (b.agency || b.contact ? ' (' + esc(b.agency || b.contact) + ')' : '') + (b.attendees > 0 ? ', ผู้เข้าร่วม ' + b.attendees + ' คน' : '') + '</p>' + (ctc && (ctc.phone || ctc.email) ? '<p>' + (ctc.phone ? 'โทร ' + esc(ctc.phone) : '') + (ctc.phone && ctc.email ? ', ' : '') + (ctc.email ? 'อีเมล ' + esc(ctc.email) : '') + '</p>' : '') : '') +
    (tag ? '<div style="margin-top:6px">' + tag + '</div>' : '') + chipsOf(b.mode ? [MODES[b.mode]] : [], '') + chipsOf(b.needs, 'need') +
    (b.note ? '<p class="small" style="margin-top:6px">หมายเหตุ ' + esc(b.note) + '</p>' : '') + '</div>' +
    '<div class="bk-act">' + acts.join('') + '</div></li>';
}

function viewMine() {
  let h = '<div class="page-head"><div><h1 class="page-title">การจองของฉัน</h1><p class="muted">ไม่ต้องล็อกอิน ใช้ "รหัสการจอง" ที่ได้ตอนจองเพื่อยกเลิกหรือแก้ไข การจองที่ทำจากเครื่องนี้จะแสดงที่นี่</p></div></div>';
  const mine = S.bookings.filter(isMine);
  const up = mine.filter(b => b.status === 'active' && !isPast(b)).sort(byTime);
  const hist = mine.filter(b => !(b.status === 'active' && !isPast(b))).sort((a, b) => byTime(b, a)).slice(0, 30);
  h += '<h2 class="sec-title" style="margin-top:8px">ที่กำลังจะถึง</h2>';
  h += up.length ? '<ul class="list">' + up.map(b => bookingCard(b)).join('') + '</ul>' : emptyState('ยังไม่มีการจองที่กำลังจะถึงในเครื่องนี้', 'จองห้องได้ทันทีโดยไม่ต้องสมัครสมาชิก หรือกรอกรหัสการจองด้านล่างถ้าคุณจองจากเครื่องอื่น', '<button type="button" class="btn primary" data-act="book-new">' + ic('plus') + 'จองห้อง</button>');
  if (hist.length) h += '<details class="hist" style="margin-top:24px"' + (S.showHist ? ' open' : '') + '><summary class="sec-title" style="cursor:pointer;display:inline-block;margin:0 0 12px">ประวัติและรายการที่ยกเลิก (' + hist.length + ')</summary><ul class="list">' + hist.map(b => bookingCard(b)).join('') + '</ul></details>';
  h += '<div class="cfg" style="margin-top:28px"><div class="cfg-box"><h3>มีรหัสการจอง?</h3><p class="muted small">วางรหัสหรือลิงก์ที่ได้รับ เพื่อดู แก้ไข หรือยกเลิกการจองจากเครื่องนี้</p>' +
    '<form id="code-form" class="inline-form" novalidate><input type="text" id="mc-code" placeholder="เช่น A1B2-C3D4-..." autocomplete="off" aria-label="รหัสการจอง"><button type="submit" class="btn">ค้นหา</button></form><div class="err" id="mc-err" role="alert"></div></div>' +
    '<div class="cfg-box"><h3>ลืมรหัส?</h3><p class="muted small">กรอกอีเมลที่ใช้จอง ระบบจะส่งลิงก์ใหม่ของการจองที่ยังไม่ถึงวันไปให้ (รหัสเดิมจะใช้ไม่ได้) ใช้ได้เมื่อหน่วยงานเปิดการส่งอีเมลแล้ว</p>' +
    '<form id="links-form" class="inline-form" novalidate><input type="email" id="ml-email" placeholder="อีเมลที่ใช้จอง" autocomplete="email" aria-label="อีเมลที่ใช้จอง"><button type="submit" class="btn">ส่งลิงก์</button></form><div class="err" id="ml-err2" role="alert"></div></div></div>';
  return h;
}
function viewOps() {
  const today = todayStr();
  const limit = addDays(today, 60);
  let list = S.bookings.filter(b => b.status === 'active' && !isPast(b) && b.date <= limit).sort(byTime);
  const pending = list.filter(b => (b.needs.length || b.note) && !b.prepared).length;
  if (S.opsOnlyNeeds) list = list.filter(b => b.needs.length || b.note);
  let h = '<div class="page-head"><div><h1 class="page-title">งานผู้ดูแล</h1><p class="muted">การจองที่กำลังจะถึงใน 60 วัน พร้อมความต้องการที่ผู้จองแจ้งไว้ ' + (pending ? '(รอเตรียม ' + pending + ' รายการ)' : '') + '</p></div></div>';
  h += '<div class="bar"><label class="check"><input type="checkbox" data-filter="opsOnlyNeeds" data-fk="ops-needs"' + (S.opsOnlyNeeds ? ' checked' : '') + '>แสดงเฉพาะรายการที่มีความต้องการ</label></div>';
  if (!list.length) return h + emptyState('ไม่มีรายการ', S.opsOnlyNeeds ? 'ยังไม่มีการจองที่ระบุความต้องการ' : 'ยังไม่มีการจองที่กำลังจะถึง');
  let cur = '';
  h += list.map(b => {
    let head = '';
    if (b.date !== cur) { cur = b.date; head = '</ul><h2 class="sec-title">' + esc(fmtLong(b.date)) + (b.date === today ? ' (วันนี้)' : '') + '</h2><ul class="list">'; }
    return head + bookingCard(b, { ops: true });
  }).join('');
  return h.replace('</ul><h2', '<h2') + '</ul>';
}

function viewRooms() {
  let h = '<div class="page-head"><div><h1 class="page-title">จัดการห้องประชุม</h1><p class="muted">แก้ไขรายละเอียดห้อง จำนวนที่นั่ง อุปกรณ์ และเปิดหรือปิดการจอง</p></div>' +
    '<button type="button" class="btn primary" data-act="room-new">' + ic('plus') + 'เพิ่มห้อง</button></div>';
  if (!S.loaded.rooms) return h + '<div class="skel"></div>';
  h += S.rooms.length ? '<div class="list" style="margin-top:14px">' + S.rooms.map(r =>
    '<div class="tbl-room"><div class="thumb">' + photoInner(r, '') + '</div><div><h3>' + esc(r.name) + (r.status === 'closed' ? ' <span class="status-tag bad">ปิดใช้งาน</span>' : '') + '</h3>' +
    '<p class="muted small">' + (r.location ? esc(r.location) + ', ' : '') + (r.capacity || '-') + ' ที่นั่ง</p>' +
    (r.description ? '<p class="small" style="margin-top:4px">' + esc(r.description) + '</p>' : '') + chipsOf(r.equipment) + '</div>' +
    '<div class="tbl-act"><button type="button" class="btn sm" data-act="room-edit" data-room="' + esc(r.id) + '">' + ic('edit') + 'แก้ไข</button>' +
    '<button type="button" class="btn sm danger" data-act="room-delete" data-room="' + esc(r.id) + '">' + ic('trash') + 'ลบ</button></div></div>').join('') + '</div>'
    : '<div style="margin-top:14px">' + emptyState('ยังไม่มีห้องประชุม', 'กดเพิ่มห้องเพื่อเริ่มใช้งาน') + '</div>';
  const cfgBox = (key, title, desc) => '<div class="cfg-box"><h3>' + title + '</h3><p class="muted small">' + desc + '</p><div class="chips" style="margin-top:10px">' +
    S.config[key].map((x, i) => '<span class="tag">' + esc(x) + '<button type="button" data-act="cfg-del" data-key="' + key + '" data-i="' + i + '" aria-label="ลบ ' + esc(x) + '">' + ic('x') + '</button></span>').join('') + '</div>' +
    '<div class="cfg-add"><input type="text" id="cfg-' + key + '" maxlength="60" placeholder="เพิ่มรายการใหม่" aria-label="เพิ่มรายการ ' + esc(title) + '" data-fk="cfg-' + key + '"><button type="button" class="btn" data-act="cfg-add" data-key="' + key + '">' + ic('plus') + 'เพิ่ม</button></div></div>';
  h += '<h2 class="sec-title">ตัวเลือกที่ใช้ในระบบ</h2><div class="cfg">' +
    cfgBox('needs', 'ความต้องการที่ผู้จองเลือกได้', 'แสดงเป็นตัวเลือกตอนจองห้อง เพื่อแจ้งให้ผู้ดูแลเตรียมการ') +
    cfgBox('equipment', 'รายการอุปกรณ์ในห้อง', 'ใช้เป็นตัวเลือกตอนแก้ไขห้อง และเป็นตัวกรองในหน้าสถานะห้อง') + '</div>';
  return h + mailCard();
}

/* ================= rendering: shell ================= */
const TABS = [
  { id: 'calendar', label: 'ปฏิทิน' }, { id: 'overview', label: 'สถานะห้อง' }, { id: 'mine', label: 'การจองของฉัน', pub: true },
  { id: 'ops', label: 'งานผู้ดูแล', admin: true }, { id: 'rooms', label: 'จัดการห้อง', admin: true }, { id: 'users', label: 'บัญชีผู้ดูแล', admin: true }
];
function renderTabs() {
  const live = S.mode === 'live';
  const tabs = live ? TABS.filter(t => t.admin ? S.isAdmin : (!t.pub || !S.isAdmin)) : [];
  if (live && !tabs.some(t => t.id === S.tab)) S.tab = 'calendar';
  $('#tabs').innerHTML = tabs.map(t => '<button type="button" class="tab" data-act="tab" data-tab="' + t.id + '"' + (S.tab === t.id ? ' aria-current="page"' : '') + '>' + t.label + '</button>').join('');
  $('#navbar').hidden = !tabs.length;
}
function renderTop() {
  const p = new Date(S.now);
  $('#clock').textContent = fmtMid(ymd(p)) + '  ' + pad(p.getHours()) + ':' + pad(p.getMinutes()) + ' น.';
  const live = S.mode === 'live', adm = live && S.isAdmin;
  const c = $('#conn'), r = $('#role'), u = $('#user-btn'), bell = $('#bell');
  c.hidden = !live; r.hidden = u.hidden = !adm; $('#admin-link').hidden = !live || !!S.uid;
  $('#cta-top').hidden = $('#cta-fab').hidden = !live;
  if (!live) { bell.hidden = true; return; }
  let cls = 'pill', txt;
  if (S.timedOut) { cls += ' warn'; txt = 'เชื่อมต่อไม่ได้'; }
  else if (S.fresh && S.rt) { cls += ' live'; txt = 'ซิงค์สด'; }
  else if (S.fresh) txt = 'รีเฟรชอัตโนมัติ';
  else txt = 'กำลังเชื่อมต่อ';
  c.className = cls; c.innerHTML = '<i class="dot"></i><span>' + txt + '</span>';
  $('#cta-top').innerHTML = ic('plus') + 'จองห้อง'; $('#cta-fab').innerHTML = ic('plus') + 'จองห้อง';
  if (!adm) { bell.hidden = true; return; }
  r.textContent = 'ผู้ดูแล';
  u.innerHTML = ic('user') + '<span>' + esc(S.myName || (S.profile && S.profile.email) || 'บัญชีของฉัน') + '</span>';
  const n = noticeList().filter(x => x.ev.at > S.seenAt).length, bn = $('#bell-n');
  bell.hidden = false; bn.hidden = !n; bn.textContent = n > 99 ? '99+' : String(n);
  bell.setAttribute('aria-label', 'การแจ้งเตือน' + (n ? ' ยังไม่ได้อ่าน ' + n + ' รายการ' : ''));
}
function bannerHtml() {
  if (S.mode !== 'live') return '';
  if (S.timedOut) return '<div class="banner">' + ic('alert') + '<div>เชื่อมต่อฐานข้อมูลไม่ได้ในขณะนี้ ข้อมูลที่เห็นอาจไม่เป็นปัจจุบัน ระบบจะลองใหม่ให้เอง</div></div>';
  return '';
}
function renderMain() {
  const a = document.activeElement, fk = a && a.dataset ? a.dataset.fk : null;
  const views = { calendar: viewCalendar, overview: viewOverview, mine: viewMine, ops: viewOps, rooms: viewRooms, users: viewUsers };
  const main = $('#main');
  main.innerHTML = bannerHtml() + (S.mode === 'boot' ? '<div class="rooms"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>' : S.mode === 'setup' ? viewSetup() : S.showAuth ? viewAuth() : (views[S.tab] || viewCalendar)());
  if (fk) { const n = main.querySelector('[data-fk="' + fk + '"]'); if (n && n !== document.activeElement) n.focus({ preventScroll: true }); }
}
function render() { renderTop(); renderTabs(); renderMain(); }
function safeRender(force) {
  const a = document.activeElement;
  if (!force && a && $('#main').contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.dataset.fk && a.dataset.fk.indexOf('cfg-') === 0) { S.dirty = true; return; }
  S.dirty = false; renderMain();
}
function afterData() { renderTop(); renderTabs(); safeRender(); if ($('#bk-form')) updateBkPreview(); checkNewNotices(); }

function toast(msg, kind) {
  const t = document.createElement('div'); t.className = 'toast' + (kind ? ' ' + kind : ''); t.textContent = msg;
  $('#toast').appendChild(t); setTimeout(() => t.remove(), 4200);
}

/* ================= in-app notifications =================
   Every booking keeps a short change log. People see the events other people (or the system) added to bookings that
   concern them: their own bookings for everyone, all bookings for admins. Seen-state is stored per person. */
const NOTICE_DAYS = 30;
function noticeList() {
  if (!S.isAdmin) return [];
  const horizon = Date.now() - NOTICE_DAYS * 86400000, out = [];
  S.bookings.forEach(b => b.log.forEach(ev => { if (ev.by === S.uid || ev.at < horizon || ev.k === 'prepared') return; out.push({ b, ev, own: false }); }));
  return out.sort((x, y) => y.ev.at - x.ev.at);
}
const noticeId = n => bkey(n.b) + '|' + n.ev.at + '|' + n.ev.k;
function noticeTitle(n) {
  const req = n.ev.by === 'requester', who = req ? 'ผู้จอง' : 'ผู้ดูแลอีกคน';
  return { created: req ? 'มีการจองใหม่' : 'ผู้ดูแลอีกคนจองแทนผู้อื่น', edited: who + 'แก้ไขการจอง', moved: who + 'ย้ายเวลาหรือห้อง', cancelled: who + 'ยกเลิกการจอง' }[n.ev.k] || 'มีการเปลี่ยนแปลง';
}
function relTime(ms) {
  const d = Date.now() - ms, m = Math.floor(d / 60000);
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return m + ' นาทีที่แล้ว';
  if (m < 1440) return Math.floor(m / 60) + ' ชั่วโมงที่แล้ว';
  const dt = new Date(ms);
  return fmtMid(ymd(dt)) + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes()) + ' น.';
}
function markSeen() {
  const top = noticeList()[0], t = Math.max(S.seenAt, top ? top.ev.at : 0);
  if (t === S.seenAt) return;
  S.seenAt = t; renderTop();
  rpc('mark_notices_seen').catch(() => { /* seen-state is a convenience */ });
}
function checkNewNotices() {
  if (!S.seenLoaded || !S.loaded.bookings || !S.uid) return;
  const unread = noticeList().filter(n => n.ev.at > S.seenAt), ids = new Set(unread.map(noticeId));
  if (!S.noticeInit) { S.noticeInit = true; S.knownNotices = ids; return; }
  const fresh = unread.filter(n => !S.knownNotices.has(noticeId(n)) && !(n.ev.by === 'system' && n.own));   /* the person whose booking yielded was already told */
  S.knownNotices = ids;
  if (!fresh.length) return;
  toast(fresh.length === 1 ? noticeTitle(fresh[0]) + ': ' + fresh[0].b.title : 'มีการแจ้งเตือนใหม่ ' + fresh.length + ' รายการ', fresh.some(n => n.ev.k === 'conflict' || n.ev.k === 'cancelled') ? 'bad' : '');
}
function openNotices() {
  const list = noticeList().slice(0, 50);
  const items = list.map(n => {
    const b = n.b, un = n.ev.at > S.seenAt;
    return '<li class="notice' + (un ? ' unread' : '') + '"><i class="ndot" aria-hidden="true"></i><div><b>' + esc(noticeTitle(n)) + (un ? ' <span class="sr">(ใหม่)</span>' : '') + '</b>' +
      (n.ev.x ? '<p>' + esc(n.ev.x) + '</p>' : '') +
      '<p class="small">' + esc(roomName(b.roomId)) + ' ' + esc(fmtMid(b.date)) + ' ' + b.start + '–' + b.end + ' น. ' + esc(b.title) + (n.own ? '' : ' โดย ' + esc(b.bookerName || '-') + (b.agency ? ' (' + esc(b.agency) + ')' : '')) + '</p>' +
      '<time class="small muted">' + esc(relTime(n.ev.at)) + '</time></div><button type="button" class="btn sm" data-act="detail" data-key="' + esc(bkey(b)) + '">ดู</button></li>';
  }).join('');
  showDlg('<div class="dlg-wrap">' + dlgHead('การแจ้งเตือน') + '<div class="dlg-body">' +
    (list.length ? '<ul class="list" style="margin-top:6px">' + items + '</ul>' : '<div class="empty" style="margin-top:8px">' + ic('cal', '') + '<h2>ยังไม่มีการแจ้งเตือน</h2><p>จะแสดงเมื่อมีการจองใหม่ แก้ไข ยกเลิก หรือชนกันในช่วง ' + NOTICE_DAYS + ' วันที่ผ่านมา</p></div>') +
    '<p class="hint" style="margin-top:12px">การแจ้งเตือนนี้เห็นเมื่อเปิดหน้านี้ ยังไม่ได้ส่งทางอีเมลหรือ LINE</p></div>' +
    '<div class="dlg-foot"><div class="btns"><button type="button" class="btn" data-act="close">ปิด</button></div></div></div>');
  markSeen();
}

/* ================= dialogs ================= */
const dlg = $('#dlg');
let dlgDown = null;
function showDlg(html) { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); }
function closeDlg() { if (dlg.open) dlg.close(); }
dlg.addEventListener('mousedown', e => { dlgDown = e.target; });
dlg.addEventListener('click', e => { if (e.target === dlg && dlgDown === dlg) closeDlg(); });
dlg.addEventListener('close', () => { dlg.innerHTML = ''; BK.own = null; });
const closeBtn = '<button type="button" class="icon-btn" data-act="close" aria-label="ปิดหน้าต่าง">' + ic('x') + '</button>';
const dlgHead = t => '<div class="dlg-head"><h2 id="dlg-title">' + esc(t) + '</h2>' + closeBtn + '</div>';

/* ---- booking dialog: create or edit; pick one or more consecutive one-hour slots ---- */
function openBooking(pre) {
  pre = pre || {};
  BK.pend = null;
  const ed = pre.edit || null, ct = ed ? S.contacts.get(bkey(ed)) : null;
  if (!S.canBook) { toast('บัญชีนี้ยังจองห้องไม่ได้ ให้ผู้ดูแลเพิ่มสิทธิ์ผู้ร่วมใช้งานก่อน', 'bad'); return; }
  const rooms = S.rooms.filter(r => r.status !== 'closed' || (ed && r.id === ed.roomId));
  if (!rooms.length) { toast('ยังไม่มีห้องที่เปิดให้จอง', 'bad'); return; }
  const today = todayStr();
  let date = ed ? ed.date : (pre.date && pre.date >= today ? pre.date : (S.tab === 'calendar' && S.cal.date >= today ? S.cal.date : today));
  if (!ed && date === today && floorStep(nowMin()) >= DAY_END) date = addDays(today, 1);
  const roomId = ed ? ed.roomId : (rooms.some(r => r.id === pre.roomId) ? pre.roomId : (S.tab === 'calendar' && rooms.some(r => r.id === S.cal.room) ? S.cal.room : rooms[0].id));
  if (ed) { BK.s = ed.s; BK.e = ed.e; BK.own = { key: bkey(ed), roomId: ed.roomId, date: ed.date, s: ed.s, e: ed.e }; }
  else { BK.s = pre.start != null ? pre.start : null; BK.e = pre.start != null ? pre.start + STEP : null; BK.own = null; }
  const prof = ed ? { name: ed.bookerName, phone: ct ? ct.phone : '', agency: ed.agency, email: ct ? ct.email : '' } : (S.isAdmin ? {} : loadProfile());
  const name = prof.name || '';
  const roomOpts = rooms.map(r => '<option value="' + esc(r.id) + '"' + (r.id === roomId ? ' selected' : '') + '>' + esc(r.name) + ' (' + (r.capacity || '-') + ' ที่นั่ง)</option>').join('');
  const needList = uniq(S.config.needs.concat(ed ? ed.needs : []));
  const needs = needList.map(n => '<label class="cc"><input type="checkbox" name="need" value="' + esc(n) + '"' + (ed && ed.needs.indexOf(n) >= 0 ? ' checked' : '') + '><span>' + esc(n) + '</span></label>').join('');
  const modes = Object.keys(MODES).map(k => '<label class="cc"><input type="radio" name="bk-mode" id="bk-mode-' + k + '" value="' + k + '"' + (ed && ed.mode === k ? ' checked' : '') + '><span>' + esc(MODES[k]) + '</span></label>').join('');
  const req = '<span class="req" aria-hidden="true">*</span>';
  showDlg('<form id="bk-form" novalidate' + (ed ? ' data-edit="' + esc(bkey(ed)) + '"' : '') + '>' + dlgHead(ed ? 'แก้ไขการจอง' : 'จองห้องประชุม') + '<div class="dlg-body">' +
    '<p class="form-note">' + req + ' หมายถึงต้องกรอก' + (ed ? ' ถ้าเปลี่ยนวัน เวลา หรือห้อง ระบบจะตรวจว่าว่างก่อนบันทึก และแจ้งผู้ดูแล' : '') + '</p>' +
    '<h3 class="form-sec first">วัน เวลา และห้อง</h3>' +
    '<div class="row-eq stack"><div class="field"><label for="bk-room">ห้องประชุม ' + req + '</label><select id="bk-room">' + roomOpts + '</select></div>' +
    '<div class="field"><label for="bk-date">วันที่ประชุม ' + req + '</label><input type="date" id="bk-date" value="' + date + '" min="' + (ed && ed.date < today ? ed.date : today) + '"></div></div>' +
    '<p class="slot-room" id="bk-room-info"></p>' +
    '<div class="field"><span class="lbl" id="bk-slots-l">เวลา ' + req + '</span><div class="presets" id="bk-presets" role="group" aria-label="เลือกอย่างเร็ว"></div>' +
    '<span class="hint">หรือเลือกเป็นรายชั่วโมง (ช่องละ 1 ชั่วโมง) แตะช่วงที่อยู่ติดกันเพิ่มเพื่อจองหลายชั่วโมง แตะซ้ำเพื่อยกเลิกการเลือก</span>' +
    '<div class="slots-grid" id="bk-slots" role="group" aria-labelledby="bk-slots-l"></div><div class="sum" id="bk-sum" aria-live="polite"></div><div id="bk-msg"></div></div>' +
    '<h3 class="form-sec">ข้อมูลผู้จอง</h3>' +
    '<div class="field"><label for="bk-name">ชื่อผู้จอง ' + req + '</label><input type="text" id="bk-name" maxlength="80" autocomplete="name" value="' + esc(name) + '"></div>' +
    '<div class="row-eq stack"><div class="field"><label for="bk-phone">หมายเลขโทรศัพท์ ' + req + '</label><input type="tel" id="bk-phone" maxlength="30" inputmode="tel" autocomplete="tel" value="' + esc(prof.phone || '') + '"></div>' +
    '<div class="field"><label for="bk-agency">หน่วยงาน ' + req + '</label><input type="text" id="bk-agency" maxlength="100" autocomplete="organization" value="' + esc(prof.agency || '') + '"></div></div>' +
    '<div class="field"><label for="bk-email">อีเมล ' + req + '</label><input type="email" id="bk-email" maxlength="120" autocomplete="email" inputmode="email" value="' + esc(prof.email || '') + '"><span class="hint">ใช้สำหรับติดต่อกลับเรื่องการจองนี้เท่านั้น</span></div>' +
    '<h3 class="form-sec">รายละเอียดการประชุม</h3>' +
    '<div class="field"><label for="bk-title">เรื่อง/หัวข้อการประชุม ' + req + '</label><input type="text" id="bk-title" maxlength="120" autocomplete="off" placeholder="เช่น ประชุมติดตามผลการดำเนินงาน" value="' + esc(ed ? ed.title : '') + '"></div>' +
    '<fieldset class="field"><legend>รูปแบบการประชุม ' + req + '</legend><div class="ccs">' + modes + '</div></fieldset>' +
    '<div class="field"><label for="bk-att">จำนวนผู้เข้าร่วม <span class="hint">(ไม่บังคับ)</span></label><input type="number" id="bk-att" inputmode="numeric" min="1" max="999" placeholder="เช่น 8" value="' + (ed && ed.attendees > 0 ? ed.attendees : '') + '"></div>' +
    '<fieldset class="field"><legend>ความต้องการสำหรับผู้ดูแล <span class="hint">(เลือกได้หลายข้อ)</span></legend>' +
    (needs ? '<div class="ccs">' + needs + '</div>' : '') +
    '<textarea id="bk-note" maxlength="500" placeholder="หมายเหตุเพิ่มเติมถึงผู้ดูแล (ถ้ามี)" aria-label="หมายเหตุเพิ่มเติมถึงผู้ดูแล">' + esc(ed ? ed.note : '') + '</textarea></fieldset>' +
    (ed ? '' : '<label class="consent"><input type="checkbox" id="bk-consent"><span>ข้าพเจ้ายอมรับให้เก็บและใช้ชื่อ เบอร์โทรศัพท์ อีเมล และหน่วยงาน เพื่อการจองห้องประชุมและการติดต่อกลับ ' + req + '</span></label>' + (S.isAdmin ? '' : '<label class="consent"><input type="checkbox" id="bk-remember" checked><span>จำข้อมูลผู้จองนี้ไว้ในเครื่องนี้ เพื่อกรอกให้อัตโนมัติครั้งต่อไป</span></label>')) +
    '<div class="hp" aria-hidden="true"><label>เว็บไซต์<input type="text" id="bk-hp" tabindex="-1" autocomplete="off"></label></div>' +
    '</div><div class="dlg-foot"><div class="err" id="bk-err" role="alert"></div><div class="btns"><button type="button" class="btn" data-act="close">ปิด</button><button type="submit" class="btn primary" id="bk-submit">' + (ed ? 'บันทึกการแก้ไข' : 'ยืนยันการจอง') + '</button></div></div></form>');
  updateBkPreview();
  setTimeout(() => { const f = ed ? $('#bk-title') : pre.start != null ? (name ? ($('#bk-phone') && !prof.phone ? $('#bk-phone') : $('#bk-title')) : $('#bk-name')) : ($('#bk-presets .preset:not(:disabled)') || $('#bk-slots .slotbtn:not(:disabled)')); if (f) f.focus({ preventScroll: true }); }, 30);
}
function readBk() {
  const form = $('#bk-form'), mode = $('input[name="bk-mode"]:checked', form);
  return {
    roomId: $('#bk-room').value, date: $('#bk-date').value, s: BK.s, e: BK.e,
    title: $('#bk-title').value.trim(), name: $('#bk-name').value.trim(), phone: $('#bk-phone').value.trim(), agency: $('#bk-agency').value.trim(), email: $('#bk-email').value.trim(),
    mode: mode ? mode.value : '', attRaw: $('#bk-att').value.trim(), att: Math.floor(Number($('#bk-att').value)), note: $('#bk-note').value.trim(),
    needs: $$('input[name="need"]:checked', form).map(i => i.value)
  };
}
const rangeFree = (roomId, date, s, e) => { for (let m = s; m < e; m += STEP) if (slotState(roomId, date, m, BK.own).k !== 'free') return false; return true; };
function validateSelection(roomId, date) {
  if (BK.s == null) return;
  if (!rangeFree(roomId, date, BK.s, BK.e)) BK.s = BK.e = null;
}
function pickSlot(m) {
  if (BK.s == null) { BK.s = m; BK.e = m + STEP; }
  else if (m >= BK.s && m < BK.e) {
    if (BK.e - BK.s === STEP) { BK.s = BK.e = null; }
    else if (m === BK.s) BK.s += STEP;
    else if (m === BK.e - STEP) BK.e -= STEP;
    else { BK.s = m; BK.e = m + STEP; }
  }
  else if (m === BK.e) BK.e += STEP;
  else if (m + STEP === BK.s) BK.s = m;
  else { BK.s = m; BK.e = m + STEP; }
}
function slotGridHtml(roomId, date) {
  let h = '';
  for (let m = DAY_START; m < DAY_END; m += STEP) {
    const st = slotState(roomId, date, m, BK.own), sel = BK.s != null && m >= BK.s && m < BK.e;
    const label = sel ? 'เลือกแล้ว' : st.k === 'free' ? 'ว่าง' : st.k === 'busy' ? 'ถูกจองแล้ว' : 'ผ่านไปแล้ว';
    h += '<button type="button" class="slotbtn ' + (sel ? 'sel' : st.k) + '" data-act="slot-pick" data-m="' + m + '"' + (st.k !== 'free' ? ' disabled' : '') + ' aria-pressed="' + sel + '"' +
      (st.b ? ' title="' + esc(st.b.title) + '"' : '') + '><b>' + minToStr(m) + '–' + minToStr(m + STEP) + '</b><small>' + label + '</small></button>';
  }
  return h;
}
const presetOk = (roomId, date, p) => rangeFree(roomId, date, p.s, p.e);
function presetsHtml(roomId, date) {
  return PRESETS.map(p => {
    const ok = presetOk(roomId, date, p), on = BK.s === p.s && BK.e === p.e;
    return '<button type="button" class="preset' + (on ? ' on' : '') + '" data-act="preset" data-id="' + p.id + '" aria-pressed="' + on + '"' + (ok ? '' : ' disabled title="มีช่วงที่ไม่ว่างหรือผ่านไปแล้ว"') + '><b>' + p.label + '</b><small>' + minToStr(p.s) + '–' + minToStr(p.e) + ' น.</small></button>';
  }).join('');
}
const sameSched = v => !!BK.own && BK.own.roomId === v.roomId && BK.own.date === v.date && BK.own.s === v.s && BK.own.e === v.e;
function slotProblems(v, list) {
  const p = [], today = todayStr();
  if (v.s == null) { p.push('เลือกช่วงเวลาอย่างน้อย 1 ชั่วโมง'); return p; }
  if (!v.date) p.push('เลือกวันที่ต้องการจอง');
  else if (!sameSched(v)) {
    if (v.date < today) p.push('ไม่สามารถจองย้อนหลังได้');
    else if (v.date === today && v.s < floorStep(nowMin())) p.push('ช่วงเวลานี้ผ่านไปแล้ว');
  }
  if (v.date) {
    const c = findConflict(v.roomId, v.date, v.s, v.e, BK.own ? BK.own.key : null, list);
    if (c) p.push('ช่วงเวลานี้ไม่ว่าง ห้องถูกจอง ' + c.start + ' ถึง ' + c.end + ' น.' + (c.slot ? '' : ' (' + c.title + ')'));
  }
  return p;
}
const altRooms = v => S.rooms.filter(r => r.status !== 'closed' && r.id !== v.roomId && v.s != null && v.date && rangeFree(r.id, v.date, v.s, v.e));
function updateBkPreview() {
  if (!$('#bk-form')) return;
  const roomId = $('#bk-room').value, date = $('#bk-date').value;
  validateSelection(roomId, date);
  const v = readBk(), r = roomOf(roomId);
  const act = document.activeElement, keepM = act && act.closest && act.closest('#bk-slots') ? act.dataset.m : null;
  $('#bk-room-info').innerHTML = r ? ic('users') + ' รองรับ ' + (r.capacity || '-') + ' ที่นั่ง' + (r.equipment.length ? ', มี ' + esc(r.equipment.join(', ')) : '') : '';
  const keepP = act && act.closest && act.closest('#bk-presets') ? act.dataset.id : null;
  $('#bk-presets').innerHTML = presetsHtml(roomId, date);
  if (keepP) { const n = $('#bk-presets [data-id="' + keepP + '"]'); if (n && !n.disabled) n.focus({ preventScroll: true }); }
  $('#bk-slots').innerHTML = slotGridHtml(roomId, date);
  if (keepM) { const n = $('#bk-slots [data-m="' + keepM + '"]'); if (n && !n.disabled) n.focus({ preventScroll: true }); }
  const hrs = v.s == null ? 0 : (v.e - v.s) / 60;
  $('#bk-sum').innerHTML = v.s == null ? '<span class="muted">ยังไม่ได้เลือกช่วงเวลา</span>' : ic('check') + ' <strong>' + minToStr(v.s) + ' ถึง ' + minToStr(v.e) + ' น.</strong> รวม ' + hrs + ' ชั่วโมง';
  const probs = v.s == null ? [] : slotProblems(v);
  const alts = probs.length && v.s != null ? altRooms(v) : [];
  $('#bk-msg').innerHTML = probs.length ? '<div class="callout bad">' + ic('alert') + '<div>' + probs.map(esc).join('<br>') + '</div></div>' +
    (v.s != null && v.date && findConflict(roomId, date, v.s, v.e, BK.own ? BK.own.key : null) ? '<div class="alt">' + (alts.length ? 'ห้องที่ว่างในช่วงเวลานี้: ' + alts.map(a => '<button type="button" class="btn sm" data-act="switch-room" data-room="' + esc(a.id) + '">' + esc(a.name) + '</button>').join('') : 'ไม่มีห้องอื่นว่างในช่วงนี้ ลองเลือกช่วงเวลาอื่น') + '</div>' : '') : '';
}
async function submitBooking() {
  const form = $('#bk-form'), errBox = $('#bk-err'), btn = $('#bk-submit');
  const editing = form.dataset.edit ? findBooking(form.dataset.edit) : null, btnText = form.dataset.edit ? 'บันทึกการแก้ไข' : 'ยืนยันการจอง';
  if (form.dataset.edit && !editing) { errBox.innerHTML = '<ul><li>การจองนี้ถูกยกเลิกหรือถูกลบไปแล้ว</li></ul>'; return; }
  const v = readBk(), errs = [], bad = [];
  if ($('#bk-hp') && $('#bk-hp').value) { closeDlg(); toast('บันทึกแล้ว'); return; }   /* hidden trap field: only bots fill it */
  $$('[aria-invalid]', form).forEach(n => n.removeAttribute('aria-invalid'));
  const need = (cond, id, msg) => { if (cond) { errs.push(msg); bad.push(id); } };
  const room = roomOf(v.roomId), phoneDigits = v.phone.replace(/[\s\-().]/g, '');
  need(!room || (room.status === 'closed' && !(editing && editing.roomId === room.id)), 'bk-room', 'ห้องนี้ปิดใช้งานหรือถูกลบแล้ว กรุณาเลือกห้องอื่น');
  slotProblems(v).forEach(m => { errs.push(m); bad.push('slots'); });
  need(!v.name, 'bk-name', 'กรอกชื่อผู้จอง');
  if (!v.phone) need(true, 'bk-phone', 'กรอกหมายเลขโทรศัพท์'); else need(!/^\+?\d{9,12}$/.test(phoneDigits), 'bk-phone', 'หมายเลขโทรศัพท์ต้องเป็นตัวเลข 9 ถึง 12 หลัก');
  need(!v.agency, 'bk-agency', 'กรอกหน่วยงาน');
  if (!v.email) need(true, 'bk-email', 'กรอกอีเมล'); else need(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email), 'bk-email', 'รูปแบบอีเมลไม่ถูกต้อง');
  need(!v.title, 'bk-title', 'กรอกเรื่อง/หัวข้อการประชุม');
  need(!v.mode, 'bk-mode-normal', 'เลือกรูปแบบการประชุม');
  need(!editing && !$('#bk-consent').checked, 'bk-consent', 'ติ๊กยอมรับการเก็บและใช้ข้อมูล');
  if (v.attRaw !== '') {
    need(!(v.att >= 1), 'bk-att', 'จำนวนผู้เข้าร่วมต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป');
    if (room && v.att >= 1 && room.capacity && v.att > room.capacity) need(true, 'bk-att', 'ห้องนี้รองรับได้ ' + room.capacity + ' ที่นั่ง แต่ระบุผู้เข้าร่วม ' + v.att + ' คน');
  }
  if (errs.length) {
    errBox.innerHTML = '<ul>' + uniq(errs).map(m => '<li>' + esc(m) + '</li>').join('') + '</ul>';
    uniq(bad).forEach(id => { const n = id === 'slots' ? null : $('#' + id); if (n && id !== 'bk-mode-normal') n.setAttribute('aria-invalid', 'true'); });
    const first = bad[0] === 'slots' ? ($('#bk-presets .preset:not(:disabled)') || $('#bk-slots .slotbtn:not(:disabled)')) : $('#' + bad[0]); if (first) first.focus();
    return;
  }
  errBox.textContent = ''; btn.disabled = true; btn.textContent = 'กำลังบันทึก';
  const ownKey = editing ? bkey(editing) : null, ns = minToStr(v.s), ne = minToStr(v.e), att = v.att >= 1 ? v.att : null;
  const payload = extra => Object.assign({ p_room: v.roomId, p_day: v.date, p_start: v.s, p_end: v.e, p_title: v.title, p_name: v.name, p_agency: v.agency, p_mode: v.mode,
    p_attendees: att, p_needs: v.needs, p_note: v.note, p_phone: v.phone, p_email: v.email }, extra || {});
  let okMsg = '', newCode = '';
  try {
    if (!editing) {
      newCode = await rpc(S.isAdmin ? 'admin_create_booking' : 'create_booking_public', payload());
      okMsg = 'จอง ' + room.name + ' วันที่ ' + fmtMid(v.date) + ' เวลา ' + ns + ' ถึง ' + ne + ' น. เรียบร้อย';
    } else {
      const oldCt = S.contacts.get(ownKey) || {};
      const schedChanged = editing.roomId !== v.roomId || editing.date !== v.date || editing.start !== ns || editing.end !== ne;
      const labels = [];
      const chg = (cond, label) => { if (cond) labels.push(label); };
      chg(editing.title !== v.title, 'หัวข้อ'); chg(editing.bookerName !== v.name, 'ชื่อผู้จอง'); chg((editing.agency || '') !== v.agency, 'หน่วยงาน');
      chg(editing.mode !== v.mode, 'รูปแบบการประชุม'); chg(editing.attendees !== (att || 0), 'จำนวนผู้เข้าร่วม'); chg(editing.note !== v.note, 'หมายเหตุ');
      chg(JSON.stringify(editing.needs.slice().sort()) !== JSON.stringify(v.needs.slice().sort()), 'ความต้องการ');
      chg((oldCt.phone || '') !== v.phone || (oldCt.email || '') !== v.email, 'ข้อมูลติดต่อ');
      if (!schedChanged && !labels.length) { closeDlg(); toast('ไม่มีการเปลี่ยนแปลง'); return; }
      const parts = [];
      if (schedChanged) {
        const mv = [];
        if (editing.roomId !== v.roomId) mv.push('เปลี่ยนห้องจาก ' + roomName(editing.roomId) + ' เป็น ' + room.name);
        if (editing.date !== v.date) mv.push('เปลี่ยนวันจาก ' + fmtMid(editing.date) + ' เป็น ' + fmtMid(v.date));
        if (editing.start !== ns || editing.end !== ne) mv.push('เปลี่ยนเวลาจาก ' + editing.start + '–' + editing.end + ' เป็น ' + ns + '–' + ne + ' น.');
        parts.push(mv.join(', '));
      }
      if (labels.length) parts.push('แก้ไข: ' + labels.join(', '));
      const args = payload({ p_summary: parts.join(' · ') });
      if (editing.code) await rpc('update_booking_by_code', Object.assign({ p_code: editing.code }, args));
      else await rpc('update_booking', Object.assign({ p_id: editing.id }, args));
      okMsg = 'บันทึกการแก้ไขแล้ว' + (schedChanged ? ' ย้ายไป ' + room.name + ' ' + fmtMid(v.date) + ' ' + ns + ' ถึง ' + ne + ' น.' : '');
    }
  } catch (e) {
    if (String((e && e.message) || '').indexOf('slot_taken') >= 0) {
      await loadAll().catch(() => {});
      const c = findConflict(v.roomId, v.date, v.s, v.e, ownKey), alts = altRooms(v);
      BK.pend = { s: v.s, e: v.e };   /* so "switch room" can keep the hours the person had chosen */
      errBox.innerHTML = '<ul><li>มีผู้จองช่วงเวลานี้ไปแล้ว' + (c ? ' (' + esc(c.start) + ' ถึง ' + esc(c.end) + ' น.)' : '') + ' กรุณาเลือกช่วงอื่น' + (alts.length ? ' หรือสลับไปห้องที่ว่างในช่วงนี้' : '') + '</li></ul>' +
        (alts.length ? '<div class="alt">' + alts.map(a => '<button type="button" class="btn sm" data-act="switch-room" data-room="' + esc(a.id) + '">' + esc(a.name) + '</button>').join('') + '</div>' : '');
      updateBkPreview();
    } else errBox.innerHTML = '<ul><li>' + esc(errMsg(e)) + '</li></ul>';
    btn.disabled = false; btn.textContent = btnText; return;
  }
  if (!editing && !S.isAdmin) {
    if ($('#bk-remember') && $('#bk-remember').checked) saveRequester({ name: v.name, phone: v.phone, agency: v.agency, email: v.email });
    if (newCode) rememberCode(newCode);
  }
  closeDlg();
  S.cal.date = v.date; S.miniMonth = monthStart(v.date);
  await loadAll().catch(onLoadError);
  if (newCode) openCodeDialog(newCode, okMsg); else toast(okMsg);
}

/* ---- booking detail / cancel ---- */
function openDetail(key) {
  const b = findBooking(key); if (!b) { toast('ไม่พบรายการจองนี้', 'bad'); return; }
  const r = roomOf(b.roomId), ct = S.contacts.get(bkey(b));
  const row = (k, v) => '<dt>' + k + '</dt><dd>' + v + '</dd>';
  showDlg('<div class="dlg-wrap">' + dlgHead('รายละเอียดการจอง') + '<div class="dlg-body"><dl class="kv">' +
    row('หัวข้อ', '<strong>' + esc(b.title) + '</strong>') +
    row('ห้อง', esc(r ? r.name : 'ห้องที่ถูกลบแล้ว') + (r && r.location ? '<br><span class="muted small">' + esc(r.location) + '</span>' : '')) +
    row('วันที่', esc(fmtLong(b.date))) + row('เวลา', b.start + ' ถึง ' + b.end + ' น.') +
    row('ผู้จอง', esc(b.bookerName || '-')) +
    (b.agency ? row('หน่วยงาน', esc(b.agency)) : '') +
    (b.contact ? row('ติดต่อ', esc(b.contact)) : '') +
    (ct && ct.phone ? row('โทรศัพท์', esc(ct.phone)) : '') + (ct && ct.email ? row('อีเมล', esc(ct.email)) : '') +
    (b.mode ? row('รูปแบบ', esc(MODES[b.mode])) : '') +
    (b.attendees > 0 ? row('ผู้เข้าร่วม', b.attendees + ' คน') : '') +
    row('ความต้องการ', b.needs.length ? chipsOf(b.needs, 'need') : '<span class="muted">ไม่มี</span>') +
    (b.note ? row('หมายเหตุ', esc(b.note)) : '') +
    row('สถานะ', b.status === 'cancelled' ? '<span class="status-tag bad">' + esc(cancelTag(b)) + '</span>' : (isPast(b) ? '<span class="status-tag">เสร็จสิ้นแล้ว</span>' : (b.prepared ? '<span class="status-tag ok">' + ic('check') + 'ผู้ดูแลเตรียมแล้ว</span>' : '<span class="status-tag">จองแล้ว</span>'))) +
    (b.mine && b.code ? row('รหัสการจอง', '<code class="code">' + esc(prettyCode(b.code)) + '</code>') : '') +
    '</dl></div><div class="dlg-foot"><div class="btns">' +
    (canCancel(b) ? '<button type="button" class="btn" data-act="edit" data-key="' + esc(key) + '">แก้ไขการจอง</button><button type="button" class="btn danger" data-act="cancel" data-key="' + esc(key) + '">ยกเลิกการจอง</button>' : '') +
    '<button type="button" class="btn" data-act="close">ปิด</button></div></div></div>');
}
function openCancel(key) {
  const b = findBooking(key); if (!b) return;
  showDlg('<div class="dlg-wrap">' + dlgHead('ยกเลิกการจองนี้หรือไม่') + '<div class="dlg-body"><p class="confirm-text">' + esc(b.title) + '<br>' + esc(roomName(b.roomId)) + ' วันที่ ' + esc(fmtMid(b.date)) + ' เวลา ' + b.start + ' ถึง ' + b.end + ' น.</p><p class="muted">เมื่อยกเลิก ห้องจะกลับมาว่างในช่วงเวลานี้ทันที</p>' + (S.isAdmin && !b.mine ? '<div class="field"><label for="cx-reason">เหตุผล (แจ้งให้เจ้าของการจองทราบ)</label><textarea id="cx-reason" maxlength="200"></textarea></div>' : '') + '</div>' +
    '<div class="dlg-foot"><div class="err" id="cx-err" role="alert"></div><div class="btns"><button type="button" class="btn" data-act="close">เก็บการจองไว้</button><button type="button" class="btn danger" data-act="cancel-do" data-key="' + esc(key) + '">ยกเลิกการจอง</button></div></div></div>');
}
async function doCancel(key, btn) {
  const b = findBooking(key); if (!b) { closeDlg(); return; }
  btn.disabled = true;
  const rs = $('#cx-reason');
  try {
    if (b.code) await rpc('cancel_booking_by_code', { p_code: b.code, p_reason: '' });
    else await rpc('cancel_booking', { p_id: b.id, p_reason: rs ? rs.value.trim() : '' });
    closeDlg(); toast('ยกเลิกการจองแล้ว ห้องกลับมาว่างในช่วงเวลานี้'); await loadAll();
  } catch (e) { btn.disabled = false; const x = $('#cx-err'); if (x) x.textContent = errMsg(e); }
}

/* ---- room editor ---- */
function openRoomEdit(id) {
  const r = id ? roomOf(id) : null;
  if (id && !r) return;
  RP = { blob: null, preview: '', remove: false, room: r };
  const eqs = uniq(S.config.equipment.concat(r ? r.equipment : []));
  const eqH = eqs.map(x => '<label class="cc"><input type="checkbox" name="eq" value="' + esc(x) + '"' + (r && r.equipment.indexOf(x) >= 0 ? ' checked' : '') + '><span>' + esc(x) + '</span></label>').join('');
  showDlg('<form id="room-form" novalidate data-id="' + esc(id || '') + '">' + dlgHead(r ? 'แก้ไขห้องประชุม' : 'เพิ่มห้องประชุม') + '<div class="dlg-body">' +
    '<div class="field"><label for="rm-name">ชื่อห้อง</label><input type="text" id="rm-name" maxlength="80" value="' + esc(r ? r.name : '') + '" placeholder="เช่น ห้องประชุมใหญ่"></div>' +
    '<div class="field"><span class="lbl">รูปห้องประชุม <span class="hint">(แสดงที่หน้าสถานะห้อง)</span></span><div class="photo-row"><div class="photo-prev" id="rm-prev"></div><div class="photo-act"><div class="photo-btns">' +
    '<button type="button" class="btn sm" id="rm-photo-pick" data-act="rm-photo-pick">' + ic('plus') + 'เลือกรูป</button><button type="button" class="btn sm danger" id="rm-photo-clear" data-act="rm-photo-clear">' + ic('trash') + 'ลบรูป</button></div>' +
    '<span class="hint" id="rm-photo-hint"></span></div><input type="file" id="rm-photo" accept="image/*" hidden></div></div>' +
    '<div class="row-eq"><div class="field"><label for="rm-cap">จำนวนที่นั่งที่รองรับ</label><input type="number" id="rm-cap" inputmode="numeric" min="1" max="999" value="' + (r && r.capacity ? r.capacity : '') + '"></div>' +
    '<div class="field"><label for="rm-status">สถานะการให้จอง</label><select id="rm-status"><option value="open"' + (!r || r.status === 'open' ? ' selected' : '') + '>เปิดให้จอง</option><option value="closed"' + (r && r.status === 'closed' ? ' selected' : '') + '>ปิดใช้งานชั่วคราว</option></select></div></div>' +
    '<div class="field"><label for="rm-loc">ที่ตั้ง <span class="hint">(อาคาร ชั้น)</span></label><input type="text" id="rm-loc" maxlength="120" value="' + esc(r ? r.location : '') + '" placeholder="เช่น อาคาร A ชั้น 3"></div>' +
    '<fieldset class="field"><legend>อุปกรณ์อำนวยความสะดวกในห้อง</legend><div class="ccs" id="rm-eqs">' + eqH + '</div>' +
    '<div class="cfg-add"><input type="text" id="rm-eq-new" maxlength="60" placeholder="เพิ่มอุปกรณ์อื่น" aria-label="เพิ่มอุปกรณ์อื่น"><button type="button" class="btn" data-act="rm-eq-add">' + ic('plus') + 'เพิ่ม</button></div></fieldset>' +
    '<div class="field"><label for="rm-desc">รายละเอียดเพิ่มเติม</label><textarea id="rm-desc" maxlength="500" placeholder="เช่น รูปแบบการจัดโต๊ะ ข้อควรทราบ หรือเหตุผลที่ปิดใช้งาน">' + esc(r ? r.description : '') + '</textarea></div>' +
    '</div><div class="dlg-foot"><div class="err" id="rm-err" role="alert"></div><div class="btns"><button type="button" class="btn" data-act="close">ปิด</button><button type="submit" class="btn primary" id="rm-submit">บันทึกห้อง</button></div></div></form>');
  renderPhotoPrev();
  setTimeout(() => $('#rm-name') && $('#rm-name').focus({ preventScroll: true }), 30);
}
const PHOTO_HINT = 'รองรับ JPG, PNG, WebP ระบบจะย่อและตัดรูปเป็นสัดส่วน 4:3 (แนวนอน) ตรงกลางให้อัตโนมัติ';
const canUpload = () => S.isAdmin;
function renderPhotoPrev() {
  const box = $('#rm-prev'); if (!box) return;
  const cur = RP.preview || (!RP.remove && RP.room ? photoSrc(RP.room) : '');
  box.innerHTML = '<span class="ph">' + ic('image') + '</span>' + (cur ? '<img data-ph src="' + esc(cur) + '" alt="ตัวอย่างรูปห้อง">' : '');
  const clr = $('#rm-photo-clear'), pick = $('#rm-photo-pick'), hint = $('#rm-photo-hint');
  if (clr) clr.disabled = !cur;
  if (pick) pick.disabled = !canUpload();
  if (hint && !hint.dataset.msg) { hint.className = 'hint'; hint.textContent = canUpload() ? PHOTO_HINT : 'บัญชีนี้ยังอัปโหลดรูปไม่ได้ในมุมมองนี้'; }
}
function photoMsg(text, bad) { const h = $('#rm-photo-hint'); if (!h) return; h.dataset.msg = text ? '1' : ''; h.className = 'hint' + (bad ? ' bad' : ''); h.textContent = text || PHOTO_HINT; }
const blobToDataUrl = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => rej(f.error); f.readAsDataURL(b); });
/* shrink and centre-crop to a 4:3 JPEG so uploads stay small and fit the card photo */
async function prepPhoto(file) {
  let src, w, h;
  if (typeof window.createImageBitmap === 'function') { src = await window.createImageBitmap(file); w = src.width; h = src.height; }
  else {
    const url = await blobToDataUrl(file);
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode')); i.src = url; });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  if (!w || !h) throw new Error('empty');
  const cw = Math.min(w, h * 4 / 3), ch = cw * 3 / 4;
  const ow = Math.round(Math.min(960, cw)), oh = Math.round(ow * 3 / 4), c = document.createElement('canvas'); c.width = ow; c.height = oh;
  c.getContext('2d').drawImage(src, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, ow, oh);
  if (src.close) src.close();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  if (!blob) throw new Error('encode');
  return blob;
}
async function handlePhotoPick(inp) {
  const f = inp.files && inp.files[0]; inp.value = '';
  if (!f) return;
  if (!/^image\//.test(f.type)) { photoMsg('เลือกไฟล์รูปภาพเท่านั้น (JPG, PNG, WebP)', true); return; }
  photoMsg('กำลังเตรียมรูป');
  try {
    const blob = await prepPhoto(f);
    RP.blob = blob; RP.remove = false; RP.preview = await blobToDataUrl(blob);
    photoMsg(''); renderPhotoPrev();
  } catch (e) { photoMsg('อ่านไฟล์รูปนี้ไม่ได้ ลองใช้ไฟล์ JPG หรือ PNG', true); }
}
async function submitRoom() {
  const form = $('#room-form'), id = form.dataset.id, old = id ? roomOf(id) : null, err = $('#rm-err'), btn = $('#rm-submit');
  const name = $('#rm-name').value.trim(), cap = Math.floor(Number($('#rm-cap').value));
  const problems = [];
  if (!name) problems.push('กรอกชื่อห้อง');
  if (!(cap >= 1 && cap <= 999)) problems.push('จำนวนที่นั่งต้องเป็นตัวเลข 1 ถึง 999');
  if (problems.length) { err.innerHTML = '<ul>' + problems.map(m => '<li>' + esc(m) + '</li>').join('') + '</ul>'; return; }
  const rec = {
    name, capacity: cap, status: $('#rm-status').value, location: $('#rm-loc').value.trim(), description: $('#rm-desc').value.trim(),
    equipment: $$('input[name="eq"]:checked', form).map(i => i.value),
    sort_order: old ? old.order : (S.rooms.reduce((m, r) => Math.max(m, r.order), 0) + 1), photo_path: old && old.photo ? old.photo : null
  };
  btn.disabled = true; btn.textContent = 'กำลังบันทึก';
  const store = SB.storage.from('room-photos');
  let uploaded = '', dropOld = '';
  try {
    if (RP.remove && !RP.blob) { rec.photo_path = null; dropOld = old ? old.photo : ''; }
    if (RP.blob) {
      const path = ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)) + '.jpg';
      const up = await store.upload(path, RP.blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
      if (up && up.error) throw up.error;
      uploaded = path; rec.photo_path = path; dropOld = old ? old.photo : '';
    }
    if (old) await must(SB.from('rooms').update(rec).eq('id', old.id)); else await must(SB.from('rooms').insert(rec));
  } catch (e) {
    if (uploaded) { try { await store.remove([uploaded]); } catch (x) { /* nothing points at it */ } }
    err.innerHTML = '<ul><li>' + esc(errMsg(e)) + '</li></ul>'; btn.disabled = false; btn.textContent = 'บันทึกห้อง'; return;
  }
  if (dropOld && dropOld !== rec.photo_path) { try { await store.remove([dropOld]); } catch (x) { /* ignore */ } }
  closeDlg(); toast(old ? 'บันทึกข้อมูลห้องแล้ว' : 'เพิ่มห้อง ' + name + ' แล้ว');
  await loadAll().catch(onLoadError);
}
function openRoomDelete(id) {
  const r = roomOf(id); if (!r) return;
  const n = S.bookings.filter(b => b.roomId === id && b.status === 'active' && !isPast(b)).length;
  if (n) {
    showDlg('<div class="dlg-wrap">' + dlgHead('ยังลบห้องนี้ไม่ได้') + '<div class="dlg-body"><p class="confirm-text">' + esc(r.name) + ' ยังมีการจองที่กำลังจะถึง ' + n + ' รายการ</p><p class="muted">ยกเลิกการจองเหล่านั้นก่อน หรือเปลี่ยนสถานะห้องเป็นปิดใช้งานชั่วคราวแทน</p></div><div class="dlg-foot"><div class="btns"><button type="button" class="btn" data-act="close">ตกลง</button></div></div></div>');
    return;
  }
  showDlg('<div class="dlg-wrap">' + dlgHead('ลบห้องประชุมนี้หรือไม่') + '<div class="dlg-body"><p class="confirm-text">' + esc(r.name) + '</p><p class="muted">ลบได้เฉพาะห้องที่ยังไม่เคยมีการจอง ถ้าเคยมีการจองแล้ว ให้ปิดใช้งานห้องแทน</p></div><div class="dlg-foot"><div class="err" id="rd-err" role="alert"></div><div class="btns"><button type="button" class="btn" data-act="close">ไม่ลบ</button><button type="button" class="btn danger" data-act="room-delete-do" data-room="' + esc(id) + '">ลบห้อง</button></div></div></div>');
}

/* ================= events ================= */
const ACT = {
  tab: t => { S.tab = t.dataset.tab; S.focusRoom = ''; render(); window.scrollTo({ top: 0 }); },
  'book-new': () => openBooking({}),
  book: t => openBooking({ roomId: t.dataset.room }),
  'goto-schedule': t => { S.tab = 'calendar'; S.cal.room = t.dataset.room || 'all'; S.cal.view = 'week'; S.cal.date = todayStr(); S.miniMonth = monthStart(S.cal.date); render(); window.scrollTo({ top: 0 }); },
  'cal-view': t => { S.cal.view = t.dataset.v; renderMain(); },
  'cal-today': () => { S.cal.date = todayStr(); S.miniMonth = monthStart(S.cal.date); renderMain(); },
  'cal-prev': () => calShift(-1),
  'cal-next': () => calShift(1),
  'pick-room': t => { S.cal.room = t.dataset.room; renderMain(); },
  'goto-day': t => { S.cal.view = 'day'; S.cal.date = t.dataset.date; S.miniMonth = monthStart(S.cal.date); renderMain(); },
  'goto-date': t => { S.cal.date = t.dataset.date; S.miniMonth = monthStart(S.cal.date); renderMain(); },
  'mini-prev': () => { S.miniMonth = addMonths(S.miniMonth, -1); renderMain(); },
  'mini-next': () => { S.miniMonth = addMonths(S.miniMonth, 1); renderMain(); },
  'reset-filters': () => { S.filter = { minCap: 0, freeOnly: false, equip: '' }; renderMain(); },
  detail: t => openDetail(t.dataset.key),
  cancel: t => openCancel(t.dataset.key),
  'cancel-do': t => doCancel(t.dataset.key, t),
  close: () => closeDlg(),
  notices: () => openNotices(),
  edit: t => {
    const b = findBooking(t.dataset.key);
    if (!b || !canCancel(b)) { toast('การจองนี้แก้ไขไม่ได้แล้ว', 'bad'); return; }
    openBooking({ edit: b });
  },
  'switch-room': t => {
    const sel = $('#bk-room'); if (!sel) return;
    sel.value = t.dataset.room;
    const pend = BK.pend; BK.pend = null;
    if (pend && rangeFree(sel.value, $('#bk-date').value, pend.s, pend.e)) { BK.s = pend.s; BK.e = pend.e; }
    updateBkPreview();
  },
  preset: t => {
    const pr = PRESETS.find(x => x.id === t.dataset.id); if (!pr) return;
    if (BK.s === pr.s && BK.e === pr.e) { BK.s = BK.e = null; } else { BK.s = pr.s; BK.e = pr.e; }
    updateBkPreview();
  },
  'slot-pick': t => { pickSlot(Number(t.dataset.m)); updateBkPreview(); },
  cell: t => {
    const date = t.dataset.date, m = Number(t.dataset.m);
    let roomId = t.dataset.room;
    if (!roomId) {
      const r = S.rooms.find(x => x.status !== 'closed' && slotState(x.id, date, m).k === 'free');
      if (!r) { toast('ช่วงเวลานี้ไม่มีห้องว่าง', 'bad'); return; }
      roomId = r.id;
    }
    openBooking({ roomId, date, start: m });
  },
  'room-new': () => openRoomEdit(null),
  'room-edit': t => openRoomEdit(t.dataset.room),
  'room-delete': t => openRoomDelete(t.dataset.room),
  'room-delete-do': async t => {
    t.disabled = true;
    try {
      const name = roomName(t.dataset.room);
      const path = await rpc('delete_room', { p_id: t.dataset.room });
      if (path) { try { await SB.storage.from('room-photos').remove([path]); } catch (x) { /* ignore */ } }
      closeDlg(); toast('ลบ ' + name + ' แล้ว'); await loadAll();
    } catch (e) { t.disabled = false; const x = $('#rd-err'); if (x) x.textContent = errMsg(e); }
  },
  'rm-photo-pick': () => { const f = $('#rm-photo'); if (f) f.click(); },
  'rm-photo-clear': () => { RP.blob = null; RP.preview = ''; RP.remove = true; photoMsg(''); renderPhotoPrev(); },
  'rm-eq-add': () => {
    const inp = $('#rm-eq-new'), v = inp.value.trim().slice(0, 60); if (!v) return;
    const exists = $$('input[name="eq"]', $('#room-form')).find(i => i.value === v);
    if (exists) exists.checked = true;
    else {
      const l = document.createElement('label'); l.className = 'cc';
      const i = document.createElement('input'); i.type = 'checkbox'; i.name = 'eq'; i.value = v; i.checked = true;
      const s = document.createElement('span'); s.textContent = v; l.append(i, s); $('#rm-eqs').appendChild(l);
    }
    inp.value = ''; inp.focus();
  },
  'cfg-add': async t => {
    const key = t.dataset.key, inp = $('#cfg-' + key), v = inp.value.trim().slice(0, 60); if (!v) return;
    if (S.config[key].indexOf(v) >= 0) { toast('มีรายการนี้อยู่แล้ว', 'bad'); return; }
    if (S.config[key].length >= 40) { toast('เพิ่มได้สูงสุด 40 รายการ', 'bad'); return; }
    const kind = key === 'needs' ? 'need' : 'equipment';
    try { await must(SB.from('options').insert({ kind, name: v, sort_order: S.optionRows.filter(o => o.kind === kind).reduce((m, o) => Math.max(m, o.sort_order), 0) + 1 })); inp.value = ''; await loadAll(); }
    catch (e) { toast(errMsg(e), 'bad'); }
  },
  'cfg-del': async t => {
    const key = t.dataset.key, name = S.config[key][Number(t.dataset.i)]; if (name == null) return;
    try { await must(SB.from('options').delete().eq('kind', key === 'needs' ? 'need' : 'equipment').eq('name', name)); await loadAll(); }
    catch (e) { toast(errMsg(e), 'bad'); }
  },
  'admin-login': () => { S.showAuth = true; S.authView = 'login'; renderMain(); window.scrollTo({ top: 0 }); },
  'auth-cancel': () => { S.showAuth = false; renderMain(); },
  'forget-code': t => { forgetCode(t.dataset.code); loadAll().catch(onLoadError); },
  'copy-code': t => copyText(t.dataset.v),
  'goto-mine': () => { closeDlg(); S.tab = 'mine'; render(); },
  profile: () => openProfile(),
  logout: async () => { closeDlg(); try { await SB.auth.signOut(); } catch (e) { onAuth('SIGNED_OUT', null); } },
  'auth-go': t => { S.authView = t.dataset.v; S.authNotice = ''; renderMain(); },
  'user-role': async t => {
    t.disabled = true;
    try { await rpc('set_user_role', { p_user: t.dataset.user, p_role: t.dataset.role }); toast('บันทึกสิทธิ์แล้ว'); await loadAll(); }
    catch (e) { t.disabled = false; toast(errMsg(e), 'bad'); }
  }
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || t.tagName === 'INPUT') return;
  const fn = ACT[t.dataset.act]; if (fn) fn(t, e);
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'rm-photo') { handlePhotoPick(t); return; }
  if (t.dataset && t.dataset.act === 'prepared') {
    const b = findBooking(t.dataset.key); if (!b) return;
    const val = t.checked;
    try { await rpc('set_prepared', { p_id: b.id, p_value: val }); await loadAll(); }
    catch (err) { t.checked = !val; toast(errMsg(err), 'bad'); }
    return;
  }
  if (t.dataset && t.dataset.filter) {
    const k = t.dataset.filter;
    if (k === 'minCap') S.filter.minCap = Number(t.value);
    else if (k === 'equip') S.filter.equip = t.value;
    else if (k === 'freeOnly') S.filter.freeOnly = t.checked;
    else if (k === 'opsOnlyNeeds') S.opsOnlyNeeds = t.checked;
    renderMain(); return;
  }
  if (t.id === 'cal-date') { if (t.value) { S.cal.date = t.value; S.miniMonth = monthStart(t.value); renderMain(); } return; }
  if (t.id === 'bk-room' || t.id === 'bk-date') updateBkPreview();
});
document.addEventListener('input', e => {
  if (e.target.id === 'bk-date') updateBkPreview();
  if (e.target.id === 'bk-att') e.target.removeAttribute('aria-invalid');
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'bk-form') submitBooking();
  else if (id === 'room-form') submitRoom();
  else if (id === 'profile-form') submitProfile();
  else if (/^auth-/.test(id)) submitAuth(id);
  else if (id === 'code-form') submitCodeForm();
  else if (id === 'links-form') submitLinksForm();
  else if (id === 'mail-form') submitMailForm();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'rm-eq-new') { e.preventDefault(); ACT['rm-eq-add'](); }
  if (e.key === 'Enter' && e.target.dataset && /^cfg-/.test(e.target.dataset.fk || '')) { e.preventDefault(); const k = e.target.id.replace('cfg-', ''); ACT['cfg-add']({ dataset: { key: k } }); }
});
document.addEventListener('error', e => { const t = e.target; if (t && t.tagName === 'IMG' && t.dataset && t.dataset.ph !== undefined) t.remove(); }, true);
document.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('hist')) S.showHist = e.target.open; }, true);
document.addEventListener('focusout', () => { setTimeout(() => { if (S.dirty) safeRender(); }, 0); });

/* ================= sign-in, registration, profile, users ================= */
const PHONE_RE = /^\+?\d{9,12}$/, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function authErrMsg(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  const map = [
    ['Invalid login credentials', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'], ['Email not confirmed', 'ยังไม่ได้ยืนยันอีเมล กรุณาเปิดอีเมลและกดลิงก์ยืนยันก่อน'],
    ['already registered', 'อีเมลนี้ลงทะเบียนแล้ว ลองเข้าสู่ระบบหรือกด "ลืมรหัสผ่าน"'], ['at least', 'รหัสผ่านสั้นเกินไป ต้องมีอย่างน้อย 8 ตัวอักษร'],
    ['rate limit', 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'], ['Failed to fetch', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง'],
    ['same password', 'รหัสผ่านใหม่ต้องไม่เหมือนรหัสผ่านเดิม'], ['weak', 'รหัสผ่านเดาง่ายเกินไป ลองใช้รหัสที่ยาวและไม่ซ้ำกับที่อื่น']
  ];
  for (let i = 0; i < map.length; i++) if (m.toLowerCase().indexOf(map[i][0].toLowerCase()) >= 0) return map[i][1];
  return 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง';
}
function authCard(inner) {
  return '<div class="auth"><div class="auth-card"><img class="auth-logo" src="assets/logo.png" alt="ตราจังหวัดสกลนคร" width="72" height="72">' +
    '<h1 class="auth-title">ระบบจองห้องประชุม<br>จังหวัดสกลนคร</h1>' + inner + '</div></div>';
}
const authField = (id, label, type, extra) => '<div class="field"><label for="au-' + id + '">' + label + '</label><input id="au-' + id + '" type="' + type + '" ' + (extra || '') + '></div>';
function viewSetup() {
  return '<div class="auth"><div class="auth-card"><h1 class="auth-title">ยังไม่ได้ตั้งค่า Supabase</h1><p class="auth-sub">เปิดไฟล์ <b>web/config.js</b> แล้วใส่ <b>SUPABASE_URL</b> และ <b>SUPABASE_ANON_KEY</b> ของโปรเจกต์คุณ ขั้นตอนอยู่ใน README.md</p></div></div>';
}
function viewAuth() {
  const v = S.authView, err = '<div class="err" id="au-err" role="alert"></div>';
  const back = '<div class="auth-links"><button type="button" class="linkbtn" data-act="auth-cancel">← กลับไปหน้าจองห้อง</button></div>';
  if (v === 'notice') return authCard('<p class="auth-sub">' + esc(S.authNotice) + '</p><div class="auth-links"><button type="button" class="linkbtn" data-act="auth-go" data-v="login">กลับไปหน้าเข้าสู่ระบบ</button></div>');
  if (v === 'forgot') return authCard('<p class="auth-sub">กรอกอีเมลผู้ดูแล ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้</p><form id="auth-forgot" novalidate>' +
    authField('email', 'อีเมล', 'email', 'maxlength="120" autocomplete="email" inputmode="email"') + err + '<button type="submit" class="btn primary">ส่งลิงก์ตั้งรหัสผ่านใหม่</button></form>' +
    '<div class="auth-links"><button type="button" class="linkbtn" data-act="auth-go" data-v="login">กลับไปหน้าเข้าสู่ระบบ</button></div>');
  if (v === 'reset') return authCard('<p class="auth-sub">ตั้งรหัสผ่านใหม่</p><form id="auth-reset" novalidate>' +
    authField('pass', 'รหัสผ่านใหม่ <span class="hint">(อย่างน้อย 8 ตัวอักษร)</span>', 'password', 'autocomplete="new-password"') +
    authField('pass2', 'ยืนยันรหัสผ่านใหม่', 'password', 'autocomplete="new-password"') + err + '<button type="submit" class="btn primary">บันทึกรหัสผ่านใหม่</button></form>');
  return authCard('<p class="auth-sub">สำหรับผู้ดูแลระบบเท่านั้น ผู้จองห้องไม่ต้องเข้าสู่ระบบ</p><form id="auth-login" novalidate>' +
    authField('email', 'อีเมล', 'email', 'maxlength="120" autocomplete="email" inputmode="email"') +
    authField('pass', 'รหัสผ่าน', 'password', 'autocomplete="current-password"') + err +
    '<button type="submit" class="btn primary">เข้าสู่ระบบ</button></form>' +
    '<div class="auth-links"><button type="button" class="linkbtn" data-act="auth-go" data-v="forgot">ลืมรหัสผ่าน</button></div>' + back);
}
async function submitAuth(id) {
  const err = $('#au-err'), btn = $('.auth button[type="submit"]');
  const pass = $('#au-pass') ? $('#au-pass').value : '', pass2 = $('#au-pass2') ? $('#au-pass2').value : '';
  const email = $('#au-email') ? $('#au-email').value.trim() : '';
  const fail = m => { err.textContent = m; btn.disabled = false; };
  err.textContent = ''; btn.disabled = true;
  try {
    if (id === 'auth-login') {
      if (!EMAIL_RE.test(email) || !pass) return fail('กรอกอีเมลและรหัสผ่านให้ถูกต้อง');
      const r = await SB.auth.signInWithPassword({ email, password: pass });
      if (r.error) return fail(authErrMsg(r.error));
    } else if (id === 'auth-forgot') {
      if (!EMAIL_RE.test(email)) return fail('รูปแบบอีเมลไม่ถูกต้อง');
      const r = await SB.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (r.error) return fail(authErrMsg(r.error));
      S.authView = 'notice'; S.authNotice = 'ถ้าอีเมลนี้เป็นบัญชีผู้ดูแล ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว กรุณาตรวจกล่องจดหมาย'; renderMain();
    } else if (id === 'auth-reset') {
      if (pass.length < 8) return fail('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      if (pass !== pass2) return fail('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      const r = await SB.auth.updateUser({ password: pass });
      if (r.error) return fail(authErrMsg(r.error));
      toast('ตั้งรหัสผ่านใหม่แล้ว');
      S.authView = 'login'; if (S.uid) { S.showAuth = false; render(); } else renderMain();
    }
  } catch (e) { fail(authErrMsg(e)); }
}

function openProfile() {
  const p = S.profile || {}, req = '<span class="req" aria-hidden="true">*</span>';
  showDlg('<form id="profile-form" novalidate>' + dlgHead('บัญชีของฉัน') + '<div class="dlg-body">' +
    '<div class="field"><label for="pf-name">ชื่อ-นามสกุล ' + req + '</label><input type="text" id="pf-name" maxlength="80" value="' + esc(p.full_name || '') + '"></div>' +
    '<div class="row-eq stack"><div class="field"><label for="pf-phone">หมายเลขโทรศัพท์</label><input type="tel" id="pf-phone" maxlength="30" value="' + esc(p.phone || '') + '"></div>' +
    '<div class="field"><label for="pf-agency">หน่วยงาน</label><input type="text" id="pf-agency" maxlength="100" value="' + esc(p.agency || '') + '"></div></div>' +
    '<div class="field"><label for="pf-email">อีเมล (ใช้เข้าสู่ระบบ เปลี่ยนไม่ได้ที่นี่)</label><input type="email" id="pf-email" value="' + esc(p.email || '') + '" disabled></div>' +
    '<p class="hint" style="margin-top:12px">ข้อมูลนี้ใช้กรอกฟอร์มจองให้อัตโนมัติ สิทธิ์ของคุณ: ' + (S.isAdmin ? 'ผู้ดูแล' : 'ผู้ใช้งาน') + '</p>' +
    '</div><div class="dlg-foot"><div class="err" id="pf-err" role="alert"></div><div class="btns">' +
    '<button type="button" class="btn danger" data-act="logout">' + ic('logout') + 'ออกจากระบบ</button><button type="button" class="btn" data-act="close">ปิด</button><button type="submit" class="btn primary" id="pf-submit">บันทึก</button></div></div></form>');
}
async function submitProfile() {
  const err = $('#pf-err'), btn = $('#pf-submit');
  const name = $('#pf-name').value.trim(), phone = $('#pf-phone').value.trim(), agency = $('#pf-agency').value.trim();
  if (!name) { err.textContent = 'กรอกชื่อ-นามสกุล'; return; }
  if (phone && !PHONE_RE.test(phone.replace(/[\s\-().]/g, ''))) { err.textContent = 'หมายเลขโทรศัพท์ต้องเป็นตัวเลข 9 ถึง 12 หลัก'; return; }
  btn.disabled = true; err.textContent = '';
  try {
    await must(SB.from('profiles').update({ full_name: name, phone, agency }).eq('id', S.uid));
    closeDlg(); toast('บันทึกข้อมูลบัญชีแล้ว'); await loadAll().catch(onLoadError);
  } catch (e) { err.textContent = errMsg(e); btn.disabled = false; }
}
function viewUsers() {
  let h = '<div class="page-head"><div><h1 class="page-title">บัญชีผู้ดูแล</h1><p class="muted">บัญชีที่เข้าสู่ระบบได้ สร้างบัญชีใหม่ที่ Supabase > Authentication > Users แล้วกลับมาตั้งสิทธิ์ผู้ดูแลที่นี่</p></div></div>';
  if (!S.users.length) return h + emptyState('ยังไม่มีบัญชี', 'สร้างบัญชีที่ Supabase > Authentication > Users');
  return h + '<ul class="list" style="margin-top:14px">' + S.users.map(u => {
    const me = u.id === S.uid, admin = u.role === 'admin';
    return '<li class="usr"><div><h3>' + esc(u.full_name || '(ไม่ระบุชื่อ)') + (me ? ' <span class="status-tag">คุณ</span>' : '') + (admin ? ' <span class="status-tag ok">ผู้ดูแล</span>' : '') + '</h3>' +
      '<p class="muted small">' + [u.agency, u.email, u.phone].filter(Boolean).map(esc).join(' · ') + '</p></div>' +
      '<div class="usr-act"><button type="button" class="btn sm' + (admin ? ' danger' : '') + '" data-act="user-role" data-user="' + esc(u.id) + '" data-role="' + (admin ? 'user' : 'admin') + '"' + (me ? ' disabled' : '') + '>' + (admin ? 'ถอนสิทธิ์ผู้ดูแล' : 'ตั้งเป็นผู้ดูแล') + '</button></div></li>';
  }).join('') + '</ul>';
}

/* ================= booking code: shown after booking, lookup, e-mail links, mail settings ================= */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('คัดลอกแล้ว'); }
  catch (e) { const el = $('#code-link'); if (el) { el.select(); try { document.execCommand('copy'); toast('คัดลอกแล้ว'); return; } catch (x) { /* fall through */ } } toast('คัดลอกไม่ได้ ให้เลือกข้อความแล้วคัดลอกเอง', 'bad'); }
}
function openCodeDialog(code, text) {
  const link = location.origin + location.pathname + '#code=' + normCode(code);
  showDlg('<div class="dlg-wrap">' + dlgHead('จองสำเร็จ') + '<div class="dlg-body">' +
    '<p class="confirm-text">' + esc(text) + '</p>' +
    '<p class="lbl" style="margin-top:6px">รหัสการจอง</p><div class="codebox"><code>' + esc(prettyCode(code)) + '</code><button type="button" class="btn sm" data-act="copy-code" data-v="' + esc(prettyCode(code)) + '">คัดลอกรหัส</button></div>' +
    '<p class="lbl" style="margin-top:14px">ลิงก์ยกเลิกหรือแก้ไขการจอง</p><div class="codebox"><input type="text" id="code-link" readonly value="' + esc(link) + '"><button type="button" class="btn sm" data-act="copy-code" data-v="' + esc(link) + '">คัดลอกลิงก์</button></div>' +
    '<div class="callout bad" style="margin-top:14px">' + ic('alert') + '<div>เก็บรหัสหรือลิงก์นี้ไว้ ใครที่มีรหัสนี้ยกเลิกหรือแก้ไขการจองได้ เครื่องนี้จะจำการจองไว้ที่เมนู "การจองของฉัน" ให้ด้วย ถ้าหน่วยงานเปิดการส่งอีเมล จะได้รับอีเมลยืนยันพร้อมลิงก์เดียวกันนี้</div></div>' +
    '</div><div class="dlg-foot"><div class="btns"><button type="button" class="btn" data-act="goto-mine">ดูการจองของฉัน</button><button type="button" class="btn primary" data-act="close">ปิด</button></div></div></div>');
}
async function submitCodeForm() {
  const err = $('#mc-err'), code = normCode($('#mc-code').value.split('code=').pop());
  err.textContent = '';
  if (code.length < 20) { err.textContent = 'รหัสการจองไม่ครบ ลองคัดลอกจากอีเมลหรือหน้าจอตอนจอง'; return; }
  try { await rpc('get_booking_by_code', { p_code: code }); rememberCode(code); await loadAll(); $('#mc-code').value = ''; toast('พบการจองแล้ว แสดงในรายการด้านบน'); }
  catch (e) { err.textContent = errMsg(e); }
}
async function submitLinksForm() {
  const err = $('#ml-err2'), email = $('#ml-email').value.trim();
  err.textContent = '';
  if (!EMAIL_RE.test(email)) { err.textContent = 'รูปแบบอีเมลไม่ถูกต้อง'; return; }
  try { await rpc('request_manage_links', { p_email: email }); toast('ถ้าอีเมลนี้มีการจองที่ยังไม่ถึงวัน ระบบจะส่งลิงก์ให้ภายในไม่กี่นาที'); $('#ml-email').value = ''; }
  catch (e) { err.textContent = errMsg(e); }
}
function mailCard() {
  const m = S.mailCfg || {};
  return '<h2 class="sec-title">การส่งอีเมล</h2><div class="cfg-box"><p class="muted small">ระบบส่งอีเมลยืนยันการจองพร้อมลิงก์ยกเลิก/แก้ไขให้ผู้จอง และแจ้งผู้ดูแลเมื่อมีการจอง แก้ไข หรือยกเลิก ' +
    'ถ้าเว้น "ที่อยู่เว็บ" ไว้ ระบบจะไม่ส่งอีเมล และต้องเปิดตัวส่งอีเมลบนเซิร์ฟเวอร์ (ดู README) อีเมลจึงจะออกจริง</p>' +
    '<form id="mail-form" novalidate><div class="field"><label for="ml-site">ที่อยู่เว็บ (ใช้ทำลิงก์ในอีเมล)</label><input type="url" id="ml-site" placeholder="https://rooms.ชื่อโดเมน.go.th" value="' + esc(m.site_url || '') + '"></div>' +
    '<div class="field"><label for="ml-admins">อีเมลผู้ดูแลที่รับแจ้ง (คั่นด้วยจุลภาค)</label><input type="text" id="ml-admins" value="' + esc(m.admin_emails || '') + '"></div>' +
    '<div class="err" id="ml-err" role="alert"></div><div class="btns" style="justify-content:flex-start;margin-top:12px"><button type="submit" class="btn primary">บันทึก</button></div></form>' +
    '<p class="small muted" style="margin-top:10px">สถานะคิวอีเมล: รอส่ง ' + (Number(m.pending) || 0) + ' · ส่งแล้วใน 24 ชั่วโมง ' + (Number(m.sent_24h) || 0) + ' · ส่งไม่สำเร็จใน 7 วัน ' + (Number(m.failed) || 0) + '</p></div>';
}
async function submitMailForm() {
  const err = $('#ml-err'); err.textContent = '';
  try { await rpc('save_mail_settings', { p_site_url: $('#ml-site').value.trim(), p_admin_emails: $('#ml-admins').value.trim() }); toast('บันทึกการตั้งค่าอีเมลแล้ว'); await loadAll(); }
  catch (e) { err.textContent = errMsg(e); }
}
async function handleHashCode() {
  const m = /[#&]code=([0-9A-Za-z-]+)/.exec(location.hash);
  if (!m) return;
  const code = normCode(m[1]);
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  try {
    await rpc('get_booking_by_code', { p_code: code });
    if (!S.isAdmin) rememberCode(code);
    await loadAll(); S.tab = S.isAdmin ? 'calendar' : 'mine'; render();
    const b = S.bookings.find(x => x.code === code); if (b) openDetail(bkey(b));
  } catch (e) { toast(errMsg(e), 'bad'); }
}

/* ================= session (admins only) ================= */
function resetState() {
  stopRealtime();
  Object.assign(S, { uid: null, isAdmin: false, myName: '', profile: null, users: [], mailCfg: null, bookings: [], contacts: new Map(), idx: new Map(),
    seenAt: 0, seenLoaded: false, noticeInit: false, knownNotices: new Set(), tab: 'calendar', showAuth: false });
}
async function startPublic() {
  S.mode = 'live'; S.started = true; S.showAuth = false; render();
  try { await loadAll(); startRealtime(); } catch (e) { onLoadError(e); }
}
async function enterApp(session) {
  stopRealtime();
  S.uid = session.user.id; S.mode = 'live'; S.started = true; S.showAuth = false; S.authView = 'login';
  render();
  try {
    await loadAll();
    if (!S.isAdmin) {   /* a signed-in account without admin rights has no use for this screen */
      toast('บัญชีนี้ไม่ได้รับสิทธิ์ผู้ดูแล', 'bad');
      try { await SB.auth.signOut(); } catch (e) { onAuth('SIGNED_OUT', null); }
      return;
    }
    startRealtime();
  } catch (e) { onLoadError(e); }
}
function onAuth(event, session) {
  if (event === 'PASSWORD_RECOVERY') { S.mode = 'live'; S.showAuth = true; S.authView = 'reset'; render(); return; }
  if (session && session.user) { if (S.uid === session.user.id && S.isAdmin) return; if (S.authView === 'reset' && S.showAuth) return; enterApp(session); return; }
  if (S.uid) { resetState(); closeDlg(); startPublic(); return; }
  if (!S.started) startPublic();
}

/* ================= realtime clock ================= */
setInterval(() => {
  const prev = S.now.getMinutes(); S.now = new Date();
  renderTop();
  if (prev !== S.now.getMinutes()) { safeRender(); if ($('#bk-form')) updateBkPreview(); }
}, 10000);
setInterval(() => { if (S.mode === 'live') loadAll().catch(onLoadError); }, 60000);   /* safety net if realtime is not enabled */
window.addEventListener('focus', () => { if (S.mode === 'live') loadAll().catch(onLoadError); });

/* ================= boot ================= */
async function boot() {
  render();
  const bad = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || /YOUR-/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY) || !window.supabase;
  if (bad) { S.mode = 'setup'; render(); return; }
  SB = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  SB.auth.onAuthStateChange((event, session) => { setTimeout(() => onAuth(event, session), 0); });
  const r = await SB.auth.getSession();
  if (!(r.data && r.data.session) && !S.started) await startPublic();
  handleHashCode();
}
boot();

})();
