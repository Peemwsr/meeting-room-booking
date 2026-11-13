// Stand-in for supabase-js mirroring the NO-LOGIN schema.sql (public RPCs by code, public_slots, admin tables).
module.exports = function makeFake(opts = {}) {
  const world = { users: [], profiles: [], rooms: [], options: [], bookings: [], contacts: [], events: [], slots: [], outbox: [], settings: { site_url: opts.siteUrl || 'https://rooms.test', admin_emails: 'boss@x.go.th' },
    session: null, listeners: [], channels: [], calls: [], storage: new Set(), nextEvent: 1, seenCalls: 0, rate: {} };
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  const newCode = () => uuid().replace(/-/g, '').toUpperCase();
  const bkk = () => new Date(Date.now() + 7 * 3600e3), today = () => bkk().toISOString().slice(0, 10), nowMin = () => bkk().getUTCHours() * 60 + bkk().getUTCMinutes();
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const err = (message, code) => ({ data: null, error: { message, code: code || 'P0001' } });
  const norm = c => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const me = () => world.session ? world.profiles.find(p => p.id === world.session.user.id) : null;
  const isAdmin = () => !!me() && me().role === 'admin';
  const emit = (event, session) => world.listeners.slice().forEach(cb => cb(event, session));
  function addUser(email, password, meta, role) { const id = uuid(); world.users.push({ id, email, password }); world.profiles.push({ id, email, full_name: (meta || {}).full_name || '', phone: '', agency: '', role: role || 'user', notices_seen_at: new Date(0).toISOString(), created_at: new Date().toISOString() }); return id; }
  const session = u => ({ user: { id: u.id, email: u.email }, access_token: 't' });
  const auth = {
    async signInWithPassword({ email, password }) { const u = world.users.find(x => x.email === email && x.password === password); if (!u) return { data: null, error: { message: 'Invalid login credentials' } }; world.session = session(u); setTimeout(() => emit('SIGNED_IN', world.session), 0); return { data: { session: world.session }, error: null }; },
    async signOut() { world.session = null; setTimeout(() => emit('SIGNED_OUT', null), 0); return { error: null }; },
    async getSession() { return { data: { session: world.session }, error: null }; },
    onAuthStateChange(cb) { world.listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', world.session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
    async resetPasswordForEmail(email) { world.calls.push(['reset', email]); return { data: {}, error: null }; },
    async updateUser({ password }) { world.users.find(x => x.id === world.session.user.id).password = password; return { data: {}, error: null }; }
  };
  const RLS = 'new row violates row-level security policy';
  function exec(table, st) {
    const admin = isAdmin(), signed = !!world.session;
    const map = { rooms: world.rooms, options: world.options, profiles: world.profiles, bookings: world.bookings, booking_contacts: world.contacts, booking_events: world.events, public_slots: world.slots };
    const rows = map[table]; if (!rows) return err('permission denied for table ' + table, '42501');
    if (st.op === 'select') {
      const readable = { rooms: true, options: true, public_slots: true, profiles: signed, bookings: admin, booking_contacts: admin, booking_events: admin };
      if (!readable[table]) return err('permission denied for table ' + table, '42501');
      let out = rows.filter(r => st.filters.every(f => f(r)));
      if (table === 'profiles') out = out.filter(r => r.id === world.session.user.id || admin);
      if (st.order.length) out = out.slice().sort((a, b) => { for (const c of st.order) { if (a[c] < b[c]) return -1; if (a[c] > b[c]) return 1; } return 0; });
      if (st.limit) out = out.slice(0, st.limit);
      out = JSON.parse(JSON.stringify(out));
      if (st.cols && st.cols !== '*') out = out.map(r => Object.fromEntries(st.cols.split(',').map(c => [c.trim(), r[c.trim()]])));
      if (st.single) return out.length === 1 ? { data: out[0], error: null } : err('no row', 'PGRST116');
      return { data: out, error: null };
    }
    if (['rooms', 'options'].includes(table)) {
      if (!admin) return err(RLS, '42501');
      if (st.op === 'insert') { const r = Object.assign({ id: uuid(), created_at: new Date().toISOString(), status: 'open', sort_order: 0, equipment: [], location: '', description: '', photo_path: null }, st.payload); if (table === 'options' && rows.find(o => o.kind === r.kind && o.name === r.name)) return err('duplicate key value violates unique constraint', '23505'); rows.push(r); return { data: null, error: null }; }
      const hit = rows.filter(r => st.filters.every(f => f(r)));
      if (st.op === 'update') { hit.forEach(r => Object.assign(r, st.payload)); return { data: null, error: null }; }
      if (st.op === 'delete') { hit.forEach(r => rows.splice(rows.indexOf(r), 1)); return { data: null, error: null }; }
    }
    if (table === 'profiles' && st.op === 'update' && signed) { const hit = rows.filter(r => st.filters.every(f => f(r)) && (r.id === world.session.user.id || admin)); if (!admin && 'role' in st.payload) return err('forbidden'); hit.forEach(r => Object.assign(r, st.payload)); return { data: null, error: null }; }
    return err(RLS, '42501');
  }
  function qb(table) {
    const st = { op: 'select', filters: [], order: [], limit: null, single: false, payload: null, cols: '*' };
    const b = { select(c) { if (c) st.cols = c; return b; }, insert(p) { st.op = 'insert'; st.payload = p; return b; }, update(p) { st.op = 'update'; st.payload = p; return b; }, delete() { st.op = 'delete'; return b; },
      eq(c, v) { st.filters.push(r => r[c] === v); return b; }, gte(c, v) { st.filters.push(r => r[c] >= v); return b; }, order(c) { st.order.push(c); return b; }, limit(n) { st.limit = n; return b; }, single() { st.single = true; return b; },
      then(res, rej) { return Promise.resolve(exec(table, st)).then(res, rej); } };
    return b;
  }
  const ev = (booking_id, kind, text, admin) => world.events.push({ id: world.nextEvent++, booking_id, actor_id: admin ? world.session.user.id : null, actor_kind: admin ? 'admin' : 'requester', kind, text, created_at: new Date().toISOString() });
  const mail = (to, subject, body) => { if (world.settings.site_url) world.outbox.push({ to, subject, body }); };
  const phoneOk = p => /^\+?[0-9]{9,12}$/.test(String(p || '').replace(/[\s\-().]/g, '')), emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
  function checkText(a) { if (!a.p_title || !a.p_title.trim() || !a.p_name || !a.p_name.trim() || !a.p_agency || !a.p_agency.trim() || !['normal', 'online', 'vcs'].includes(a.p_mode)) return 'invalid'; if (!phoneOk(a.p_phone)) return 'invalid_phone'; if (!emailOk(a.p_email)) return 'invalid_email'; return null; }
  function checkSlot(a, time, open) {
    const room = world.rooms.find(r => r.id === a.p_room); if (!room) return 'invalid'; if (open && room.status !== 'open') return 'room_closed';
    if (a.p_attendees != null && (a.p_attendees < 1 || a.p_attendees > room.capacity)) return 'over_capacity';
    if (time) { if (a.p_start % 60 || a.p_end % 60 || a.p_end <= a.p_start) return 'invalid'; if (a.p_start < 480 || a.p_end > 960) return 'outside_hours'; if (a.p_day < today() || (a.p_day === today() && a.p_start < Math.floor(nowMin() / 60) * 60)) return 'past_slot'; }
    return null;
  }
  const overlaps = (roomId, day, s, e, ignore) => world.bookings.some(b => b.id !== ignore && b.status === 'active' && b.room_id === roomId && b.day === day && s < b.end_min && b.start_min < e);
  const sync = b => { world.slots = world.slots.filter(s => s.bk !== b.id); if (b.status === 'active') world.slots.push({ bk: b.id, room_id: b.room_id, day: b.day, start_min: b.start_min, end_min: b.end_min }); world.slots.forEach(s => { s.id = s.bk; }); };
  const roomName = id => world.rooms.find(r => r.id === id).name;
  const json = b => { const c = world.contacts.find(x => x.booking_id === b.id) || {}; return Object.assign({}, b, { phone: c.phone, email: c.email }); };
  const byCode = code => { const c = norm(code); if (c.length < 20) return null; return world.bookings.find(b => b.code === c) || null; };
  function createCore(a) {
    let m = checkText(a) || checkSlot(a, true, true); if (m) return err(m);
    const adm = isAdmin();
    if (!adm) { const ip = world.ip || 'ip'; world.rate[ip] = (world.rate[ip] || 0) + 1; if (world.rate[ip] > (world.limitIp || 1000)) return err('rate_limited'); }
    if (overlaps(a.p_room, a.p_day, a.p_start, a.p_end)) return err('slot_taken');
    const id = uuid(), code = newCode();
    const b = { id, code, room_id: a.p_room, day: a.p_day, start_min: a.p_start, end_min: a.p_end, title: a.p_title.trim(), booker_name: a.p_name.trim(), agency: a.p_agency.trim(), mode: a.p_mode, attendees: a.p_attendees, needs: a.p_needs || [], note: a.p_note || '', status: 'active', prepared: false, by_admin: adm, created_at: new Date().toISOString() };
    world.bookings.push(b); world.contacts.push({ booking_id: id, phone: a.p_phone.trim(), email: a.p_email.trim() }); sync(b);
    ev(id, 'created', 'จอง ' + roomName(a.p_room) + ' ' + a.p_day + ' ' + hhmm(a.p_start) + '–' + hhmm(a.p_end) + ' น.', adm);
    mail(a.p_email, 'ยืนยันการจอง', 'code=' + code); if (!adm) mail('boss@x.go.th', 'การจองใหม่', 'x'); return { data: code, error: null };
  }
  function updateCore(b, a, adm) {
    if (!b || b.status !== 'active') return err('gone'); if (b.day < today() || (b.day === today() && b.end_min <= nowMin())) return err('gone');
    let m = checkText(a); if (m) return err(m); const changed = b.room_id !== a.p_room || b.day !== a.p_day || b.start_min !== a.p_start || b.end_min !== a.p_end;
    m = checkSlot(a, changed, changed); if (m) return err(m); if (changed && overlaps(a.p_room, a.p_day, a.p_start, a.p_end, b.id)) return err('slot_taken');
    Object.assign(b, { room_id: a.p_room, day: a.p_day, start_min: a.p_start, end_min: a.p_end, title: a.p_title.trim(), booker_name: a.p_name.trim(), agency: a.p_agency.trim(), mode: a.p_mode, attendees: a.p_attendees, needs: a.p_needs || [], note: a.p_note || '', prepared: changed ? false : b.prepared });
    const c = world.contacts.find(x => x.booking_id === b.id); Object.assign(c, { phone: a.p_phone, email: a.p_email }); sync(b); ev(b.id, changed ? 'moved' : 'edited', (a.p_summary || '').slice(0, 300), adm);
    if (adm) mail(a.p_email, 'ผู้ดูแลแก้ไข', 'x'); else mail('boss@x.go.th', 'การจองถูกแก้ไข', 'x'); return { data: null, error: null };
  }
  function cancelCore(b, reason, adm) {
    if (!b || b.status !== 'active') return err('gone'); if (b.day < today() || (b.day === today() && b.end_min <= nowMin())) return err('gone');
    b.status = 'cancelled'; sync(b); ev(b.id, 'cancelled', (adm ? 'ผู้ดูแลยกเลิกการจอง' : 'ผู้จองยกเลิกการจอง') + (reason ? ' เหตุผล: ' + reason : ''), adm);
    const c = world.contacts.find(x => x.booking_id === b.id); if (adm) mail(c.email, 'ผู้ดูแลยกเลิก', reason || ''); else { mail(c.email, 'ยืนยันการยกเลิก', ''); mail('boss@x.go.th', 'การจองถูกยกเลิก', ''); } return { data: null, error: null };
  }
  const needAdmin = () => (!isAdmin() ? err('forbidden') : null);
  const rpcs = {
    create_booking_public: createCore, admin_create_booking(a) { return needAdmin() || createCore(a); },
    get_booking_by_code(a) { const b = byCode(a.p_code); return b ? { data: json(b), error: null } : err('not_found'); },
    get_bookings_by_codes(a) { const out = []; (a.p_codes || []).slice(0, 30).forEach(c => { const b = byCode(c); if (b) out.push(Object.assign(json(b), { code: norm(c) })); }); return { data: out, error: null }; },
    update_booking_by_code(a) { const b = byCode(a.p_code); return b ? updateCore(b, a, false) : err('not_found'); },
    cancel_booking_by_code(a) { const b = byCode(a.p_code); return b ? cancelCore(b, a.p_reason, false) : err('not_found'); },
    request_manage_links(a) { world.linkReq = (world.linkReq || []).concat(a.p_email); if (!emailOk(a.p_email)) return err('invalid_email'); return { data: null, error: null }; },
    update_booking(a) { return needAdmin() || updateCore(world.bookings.find(x => x.id === a.p_id), a, true); },
    cancel_booking(a) { return needAdmin() || cancelCore(world.bookings.find(x => x.id === a.p_id), a.p_reason, true); },
    set_prepared(a) { const f = needAdmin(); if (f) return f; const b = world.bookings.find(x => x.id === a.p_id && x.status === 'active'); if (!b) return err('gone'); b.prepared = a.p_value; if (a.p_value) ev(b.id, 'prepared', 'ผู้ดูแลเตรียมห้องและอุปกรณ์เรียบร้อยแล้ว', true); return { data: null, error: null }; },
    mark_notices_seen() { world.seenCalls++; me().notices_seen_at = new Date().toISOString(); return { data: null, error: null }; },
    set_user_role(a) { const f = needAdmin(); if (f) return f; const p = world.profiles.find(x => x.id === a.p_user); if (a.p_role === 'user' && p.role === 'admin' && world.profiles.filter(x => x.role === 'admin').length <= 1) return err('last_admin'); p.role = a.p_role; return { data: null, error: null }; },
    delete_room(a) { const f = needAdmin(); if (f) return f; if (world.bookings.some(b => b.room_id === a.p_id)) return err('room_has_bookings'); const i = world.rooms.findIndex(r => r.id === a.p_id); const path = world.rooms[i].photo_path; world.rooms.splice(i, 1); return { data: path, error: null }; },
    get_mail_settings() { const f = needAdmin(); if (f) return f; return { data: { site_url: world.settings.site_url, admin_emails: world.settings.admin_emails, pending: world.outbox.length, failed: 0, sent_24h: 0 }, error: null }; },
    save_mail_settings(a) { const f = needAdmin(); if (f) return f; if (a.p_site_url && !/^https?:\/\//.test(a.p_site_url)) return err('invalid'); world.settings.site_url = a.p_site_url; world.settings.admin_emails = a.p_admin_emails; return { data: null, error: null }; }
  };
  const client = { auth, from: qb,
    async rpc(name, args) { world.calls.push(['rpc', name]); const f = rpcs[name]; if (!f) return err('function not found'); return f(args || {}); },
    storage: { from() { return { async upload(path) { if (!isAdmin()) return { data: null, error: { message: RLS } }; world.storage.add(path); return { data: { path }, error: null }; }, async remove(paths) { paths.forEach(p => world.storage.delete(p)); return { data: [], error: null }; } }; } },
    channel() { const ch = { handlers: [], tables: [], on(t, f, cb) { ch.tables.push(f.table); ch.handlers.push(cb); return ch; }, subscribe(cb) { cb('SUBSCRIBED'); return ch; } }; world.channels.push(ch); return ch; },
    removeChannel(ch) { const i = world.channels.indexOf(ch); if (i >= 0) world.channels.splice(i, 1); } };
  world.notify = () => world.channels.forEach(ch => ch.handlers.forEach(cb => cb({}))); world.addUser = addUser; world.client = client; world.norm = norm;
  return { createClient: () => client, world };
};
