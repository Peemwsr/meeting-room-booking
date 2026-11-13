# ทดสอบ supabase/schema.sql บน Postgres (ดูวิธีรันใน tests/setup_fake_supabase.sql)  ต้องมี psycopg2
import psycopg2, threading, time, sys, uuid, json, re
DSN = "dbname=rb_test user=postgres host=/var/run/postgresql"   # แก้ให้ตรงกับเครื่อง
res = []
def ok(name, cond, extra=''):
    res.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + ((' | ' + str(extra)[:300]) if (extra and not cond) else ''))
def conn(role=None, uid=None, ip=None):
    c = psycopg2.connect(DSN); c.autocommit = False; cur = c.cursor()
    if role:
        cur.execute("set role " + role)
        if uid: cur.execute("select set_config('request.jwt.claim.sub',%s,false)", (str(uid),))
        if ip: cur.execute("select set_config('request.headers',%s,false)", (json.dumps({'cf-connecting-ip': ip}),))
    c.commit(); return c
def q(c, sql, args=None):
    cur = c.cursor(); cur.execute(sql, args); return cur.fetchall() if cur.description else None
def err(c, sql, args=None):
    try: q(c, sql, args); c.commit(); return None
    except Exception as e: c.rollback(); return str(e).split('\n')[0]
su = conn()
def sql(s, a=None):
    r = q(su, s, a); su.commit(); return r
for t in ('email_outbox', 'rate_events', 'public_slots', 'bookings', 'rooms'): sql("truncate public.%s restart identity cascade" % t)
sql("delete from public.profiles"); sql("delete from auth.users")
sql("update public.settings set value='' where key in ('site_url','admin_emails')")
sql("update public.settings set value='1000' where key in ('limit_ip_per_hour','limit_global_per_hour','limit_active_per_email')")
def mkuser(email, name):
    uid = uuid.uuid4(); sql("insert into auth.users(id,email,raw_user_meta_data) values (%s,%s,jsonb_build_object('full_name',%s))", (str(uid), email, name)); return uid
ADM = mkuser('admin@x.go.th', 'ผู้ดูแล'); STRAY = mkuser('stray@x.go.th', 'คนนอก')
sql("update public.profiles set role='admin' where email='admin@x.go.th'")
cadm, cstray = conn('authenticated', ADM), conn('authenticated', STRAY)
anon = lambda ip='10.0.0.1': conn('anon', ip=ip)
ca = anon()

# ---------- rooms (admin only)
ok('admin creates rooms', err(cadm, "insert into public.rooms(name,capacity,location,equipment) values ('พระธาตุเชิงชุม',20,'ชั้น 4','{โปรเจกเตอร์}'),('เทพรังสี',8,'ชั้น 2','{}'),('ห้องปิด',5,'','{}')") is None)
q(cadm, "update public.rooms set status='closed' where name='ห้องปิด'"); cadm.commit()
R1, R2, RC = [q(cadm, "select id from public.rooms where name=%s", (n,))[0][0] for n in ('พระธาตุเชิงชุม', 'เทพรังสี', 'ห้องปิด')]
ok('stray signed-in user cannot create rooms', err(cstray, "insert into public.rooms(name,capacity) values ('x',5)") is not None)
ok('anon cannot create rooms', err(ca, "insert into public.rooms(name,capacity) values ('x',5)") is not None)

# ---------- what anonymous visitors can and cannot read
ok('anon can read rooms and options', len(q(ca, "select * from public.rooms")) == 3 and len(q(ca, "select * from public.options")) == 16)
ok('anon sees only the opening-hours settings', sorted(r[0] for r in q(ca, "select key from public.settings")) == ['day_end_min', 'day_start_min'])
for t in ('bookings', 'booking_contacts', 'booking_events', 'email_outbox', 'rate_events', 'profiles'):
    ok('anon cannot read ' + t, err(anon(), "select * from public.%s" % t) is not None)
ok('stray user cannot read bookings/contacts/events (RLS returns nothing)', all(q(cstray, "select count(*) from public.%s" % t)[0][0] == 0 for t in ('bookings', 'booking_contacts', 'booking_events')))
ok('anon cannot write tables directly', err(anon(), "insert into public.bookings(room_id,code_hash,day,start_min,end_min,title,booker_name,agency,mode) values (%s,'\\x00',current_date,480,540,'x','x','x','normal')", (str(R1),)) is not None)
ok('anon cannot call admin or internal functions', all(err(anon(), s, a) is not None for s, a in [
    ("select public.cancel_booking(%s,'')", (str(uuid.uuid4()),)), ("select public.set_prepared(%s,true)", (str(uuid.uuid4()),)),
    ("select public.delete_room(%s)", (str(R1),)), ("select public._create_core(%s,current_date,480,540,'t','n','a','normal',1,'{}','','0812345678','a@b.co')", (str(R1),)),
    ("select public.get_mail_settings()", None), ("select public._queue_mail('a@b.co','s','b')", None)]))

tomorrow = q(su, "select (now() at time zone 'Asia/Bangkok')::date + 1")[0][0]; yday = q(su, "select (now() at time zone 'Asia/Bangkok')::date - 1")[0][0]
today = q(su, "select (now() at time zone 'Asia/Bangkok')::date")[0][0]; nowmin = q(su, "select public._now_min()")[0][0]
def book(c, room, day, s, e, title='ประชุม', name='ผู้ทดสอบ', agency='หน่วย', mode='normal', att=5, needs=['น้ำดื่ม'], note='', phone='042-711282', email='t@x.go.th', fn='create_booking_public'):
    try:
        r = q(c, "select public.%s(%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s)" % fn, (str(room), day, s, e, title, name, agency, mode, att, needs, note, phone, email)); c.commit(); return r[0][0]
    except Exception as ex: c.rollback(); return 'ERR:' + str(ex).split('\n')[0]
CODE_A = book(ca, R1, tomorrow, 600, 720, title='ประชุมของเอ', name='สมชาย', email='a@x.go.th')
ok('anonymous booking succeeds and returns a 32-hex code', re.fullmatch(r'[0-9A-F]{32}', CODE_A or ''), CODE_A)
ok('database stores only a hash of the code', q(su, "select count(*) from public.bookings where code_hash = sha256(convert_to(%s,'UTF8'))", (CODE_A,))[0][0] == 1 and
   q(su, "select count(*) from public.bookings where encode(code_hash,'hex') like %s", ('%' + CODE_A.lower() + '%',))[0][0] == 0)
ok('public_slots shows the busy hours without personal data', q(ca, "select room_id,day,start_min,end_min from public.public_slots")[0] == (R1, tomorrow, 600, 720) and
   [c[0] for c in (lambda cur: (cur.execute("select * from public.public_slots limit 1"), cur.description)[1])(ca.cursor())] == ['id', 'bk_key', 'room_id', 'day', 'start_min', 'end_min'])
ok('slot key is not the booking id', q(su, "select count(*) from public.public_slots s join public.bookings b on s.bk_key = b.id::text")[0][0] == 0)
ok('overlapping booking refused (slot_taken)', 'slot_taken' in book(ca, R1, tomorrow, 660, 780))
ok('adjacent booking allowed', not str(book(ca, R1, tomorrow, 720, 780, title='ต่อเนื่อง')).startswith('ERR'))
ok('same hours in another room allowed', not str(book(ca, R2, tomorrow, 600, 720)).startswith('ERR'))
for name, args, want in [('before opening', (R2, tomorrow, 420, 480), 'outside_hours'), ('after closing', (R2, tomorrow, 900, 1020), 'outside_hours'), ('not whole hours', (R2, tomorrow, 630, 690), 'invalid'),
                         ('yesterday', (R2, yday, 600, 660), 'past_slot'), ('closed room', (RC, tomorrow, 600, 660), 'room_closed')]:
    ok('refused: ' + name, want in str(book(ca, *args)))
if nowmin >= 600: ok('refused: earlier hour today', 'past_slot' in str(book(ca, R2, today, 480, 540)))
ok('refused: over capacity', 'over_capacity' in str(book(ca, R2, tomorrow, 780, 840, att=9)))
ok('refused: bad phone / email / mode / empty title', all(w in str(book(ca, R2, tomorrow, 780, 840, **kw)) for w, kw in [('invalid_phone', {'phone': '12-34'}), ('invalid_email', {'email': 'abc'}), ('invalid', {'mode': 'x'}), ('invalid', {'title': '  '})]))

# ---------- managing with the code
d = q(ca, "select public.get_booking_by_code(%s)", (CODE_A,))[0][0]
ok('code shows the booking including phone and email', d['title'] == 'ประชุมของเอ' and d['email'] == 'a@x.go.th' and d['phone'] == '042-711282' and d['status'] == 'active', d)
ok('pretty/lowercase code with dashes also works', q(ca, "select public.get_booking_by_code(%s)", ('-'.join(CODE_A[i:i+4] for i in range(0, 32, 4)).lower(),))[0][0]['title'] == 'ประชุมของเอ')
ok('wrong or short code -> not_found', all('not_found' in (err(anon(), "select public.get_booking_by_code(%s)", (c,)) or '') for c in ('0' * 32, 'ABC', '')))
many = q(ca, "select public.get_bookings_by_codes(%s)", ([CODE_A, '1' * 32, 'zz'],))[0][0]
ok('bulk lookup returns only valid codes', len(many) == 1 and many[0]['code'] == CODE_A and many[0]['title'] == 'ประชุมของเอ')
def upd(code, room, day, s, e, **kw):
    a = dict(title='ประชุมของเอ', name='สมชาย', agency='หน่วย', mode='normal', att=5, needs=['น้ำดื่ม'], note='', phone='042-711282', email='a@x.go.th', summ='แก้ไข'); a.update(kw)
    return err(anon(), "select public.update_booking_by_code(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", (code, str(room), day, s, e, a['title'], a['name'], a['agency'], a['mode'], a['att'], a['needs'], a['note'], a['phone'], a['email'], a['summ']))
q(cadm, "select public.set_prepared((select id from public.bookings where title='ประชุมของเอ'),true)"); cadm.commit()
ok('edit by code (title only) keeps hours and prepared flag', upd(CODE_A, R1, tomorrow, 600, 720, title='ชื่อใหม่') is None and q(su, "select title,prepared from public.bookings where code_hash=sha256(convert_to(%s,'UTF8'))", (CODE_A,))[0] == ('ชื่อใหม่', True))
ok('edit by code: wrong code refused', 'not_found' in (upd('9' * 32, R1, tomorrow, 600, 720) or ''))
ok('move into taken hours refused and original intact', 'slot_taken' in (upd(CODE_A, R1, tomorrow, 660, 780) or '') and q(su, "select start_min,end_min from public.bookings where title='ชื่อใหม่'")[0] == (600, 720))
ok('move to a free slot: prepared reset, public_slots follows', upd(CODE_A, R1, tomorrow, 780, 900, title='ชื่อใหม่') is None and q(su, "select start_min,prepared from public.bookings where title='ชื่อใหม่'")[0] == (780, False) and
   q(ca, "select count(*) from public.public_slots where room_id=%s and day=%s and start_min=780", (str(R1), tomorrow))[0][0] == 1 and q(ca, "select count(*) from public.public_slots where room_id=%s and start_min=600 and end_min=720", (str(R1),))[0][0] == 0)
ok('event kinds recorded for requester actions', [r[0] for r in q(cadm, "select kind from public.booking_events where booking_id=(select id from public.bookings where title='ชื่อใหม่') order by id")] == ['created', 'prepared', 'edited', 'moved'])
ok('requester events are labelled requester (admin sees them)', all(r[0] == 'requester' for r in q(cadm, "select actor_kind from public.booking_events where kind in ('created','edited','moved') and booking_id=(select id from public.bookings where title='ชื่อใหม่')")))
ok('cancel by code frees the slot', err(anon(), "select public.cancel_booking_by_code(%s,'')", (CODE_A,)) is None and not str(book(ca, R1, tomorrow, 780, 900, title='เข้าแทน')).startswith('ERR') and
   q(ca, "select count(*) from public.public_slots where room_id=%s and start_min=780", (str(R1),))[0][0] == 1)
ok('cancel twice / edit after cancel -> gone', 'gone' in (err(anon(), "select public.cancel_booking_by_code(%s,'')", (CODE_A,)) or '') and 'gone' in (upd(CODE_A, R1, tomorrow, 780, 900) or ''))
ok('cancelled booking still opens by code with status cancelled', q(ca, "select public.get_booking_by_code(%s)", (CODE_A,))[0][0]['status'] == 'cancelled')

# ---------- admin
bid = q(cadm, "select id from public.bookings where title='เข้าแทน'")[0][0]
ok('stray signed-in user is forbidden from admin functions', all('forbidden' in (err(cstray, s, (str(bid),)) or '') for s in ("select public.cancel_booking(%s,'')", "select public.set_prepared(%s,true)")))
ok('admin sees bookings, contacts and events', q(cadm, "select count(*) from public.bookings")[0][0] >= 4 and q(cadm, "select count(*) from public.booking_contacts")[0][0] >= 4 and q(cadm, "select count(*) from public.booking_events")[0][0] >= 6)
CODE_ADMIN = book(cadm, R2, tomorrow, 840, 900, title='แทนผู้อื่น', name='ผู้ถูกจองแทน', fn='admin_create_booking')
ok('admin can book on behalf (flag set)', re.fullmatch(r'[0-9A-F]{32}', CODE_ADMIN or '') and q(cadm, "select by_admin from public.bookings where title='แทนผู้อื่น'")[0][0] is True, CODE_ADMIN)
ok('admin edits and cancels any booking', err(cadm, "select public.update_booking(%s,%s,%s,780,900,'ปรับโดยผู้ดูแล','ก','ข','normal',3,'{}','','0811111111','x@y.co','ปรับ')", (str(bid), str(R1), tomorrow)) is None and
   err(cadm, "select public.cancel_booking(%s,'ห้องซ่อมแซม')", (str(bid),)) is None and 'ห้องซ่อมแซม' in q(cadm, "select text from public.booking_events where booking_id=%s order by id desc limit 1", (str(bid),))[0][0])
ok('roles: only admins change roles, last admin protected', 'forbidden' in (err(cstray, "select public.set_user_role(%s,'admin')", (str(STRAY),)) or '') and 'last_admin' in (err(cadm, "select public.set_user_role(%s,'user')", (str(ADM),)) or ''))
ok('user cannot promote self through profile update', 'forbidden' in (err(cstray, "update public.profiles set role='admin' where id=%s", (str(STRAY),)) or ''))
ok('delete_room refuses rooms with history, allows empty ones', 'room_has_bookings' in (err(cadm, "select public.delete_room(%s)", (str(R1),)) or '') and
   (q(cadm, "insert into public.rooms(name,capacity,photo_path) values ('ว่าง',3,'p.jpg')"), cadm.commit(), q(cadm, "select public.delete_room((select id from public.rooms where name='ว่าง'))")[0][0])[2] == 'p.jpg'); cadm.commit()

# ---------- abuse limits
sql("truncate public.rate_events")
sql("update public.settings set value='3' where key='limit_ip_per_hour'")
rs = [book(anon('9.9.9.9'), R2, tomorrow + __import__('datetime').timedelta(days=3), 480 + 60 * i, 540 + 60 * i, title='ip%d' % i, email='ip%d@x.co' % i) for i in range(4)]
ok('per-IP limit: 4th booking from one IP is refused', [str(r).startswith('ERR') for r in rs] == [False, False, False, True] and 'rate_limited' in rs[3], rs)
ok('another IP is unaffected; admin bypasses the limit', not str(book(anon('8.8.8.8'), R2, tomorrow, 900, 960, email='z@x.co')).startswith('ERR') and not str(book(cadm, R1, tomorrow, 480, 540, fn='admin_create_booking')).startswith('ERR'))
sql("update public.settings set value='1000' where key='limit_ip_per_hour'"); sql("update public.settings set value='2' where key='limit_active_per_email'")
rs = [book(anon('7.7.7.7'), R1, tomorrow + __import__('datetime').timedelta(days=5), 480 + 60 * i, 540 + 60 * i, email='same@x.co') for i in range(3)]
ok('per-email limit on open bookings', [str(r).startswith('ERR') for r in rs] == [False, False, True] and 'limit_reached' in rs[2], rs)
sql("update public.settings set value='1000' where key='limit_active_per_email'")

# ---------- e-mail queue
ok('no emails are queued while site_url is empty', q(su, "select count(*) from public.email_outbox")[0][0] == 0)
sql("update public.settings set value='https://rooms.example.go.th/' where key='site_url'"); sql("update public.settings set value='boss@x.go.th, helper@x.go.th' where key='admin_emails'")
sql("truncate public.email_outbox")
CODE_M = book(anon('6.6.6.6'), R2, tomorrow + __import__('datetime').timedelta(days=9), 600, 660, title='ทดสอบอีเมล', name='วันเพ็ญ', email='wan@x.co', phone='0899999999')
mails = q(su, "select to_addr, subject, body from public.email_outbox order by id")
conf = [m for m in mails if m[0] == 'wan@x.co']
ok('confirmation email carries the code and a manage link', len(conf) == 1 and CODE_M[:4] + '-' + CODE_M[4:8] in conf[0][2] and ('https://rooms.example.go.th/#code=' + CODE_M) in conf[0][2] and 'ทดสอบอีเมล' in conf[0][2], conf)
adm = [m for m in mails if m[0] in ('boss@x.go.th', 'helper@x.go.th')]
ok('each admin address gets one notice, without phone/email/code', len(adm) == 2 and all('0899999999' not in m[2] and 'wan@x.co' not in m[2] and CODE_M not in m[2] for m in adm), adm)
sql("truncate public.email_outbox")
err(anon(), "select public.cancel_booking_by_code(%s,'')", (CODE_M,))
cm = q(su, "select to_addr, subject from public.email_outbox order by id")
ok('requester cancel: confirmation to requester + notice to admins', sorted(m[0] for m in cm) == ['boss@x.go.th', 'helper@x.go.th', 'wan@x.co'], cm)
CODE_N = book(anon('6.6.6.6'), R2, tomorrow + __import__('datetime').timedelta(days=9), 660, 720, title='จะถูกยกเลิกโดยผู้ดูแล', email='n@x.co'); sql("truncate public.email_outbox")
q(cadm, "select public.cancel_booking((select id from public.bookings where title='จะถูกยกเลิกโดยผู้ดูแล'),'ห้องไม่ว่างจริง')"); cadm.commit()
am = q(su, "select to_addr, body from public.email_outbox")
ok('admin cancel: requester is emailed the reason, admins are not spammed', len(am) == 1 and am[0][0] == 'n@x.co' and 'ห้องไม่ว่างจริง' in am[0][1], am)
CODE_O = book(anon('6.6.6.6'), R2, tomorrow + __import__('datetime').timedelta(days=10), 600, 660, title='ลืมรหัส', email='forgot@x.co'); sql("truncate public.email_outbox")
ok('request_manage_links: unknown address -> silent (no email, no error)', err(anon(), "select public.request_manage_links('nobody@x.co')") is None and q(su, "select count(*) from public.email_outbox")[0][0] == 0)
ok('request_manage_links: known address -> new code emailed, old code dead', err(anon(), "select public.request_manage_links('Forgot@X.co')") is None and
   (lambda b: bool(re.search(r'#code=([0-9A-F]{32})', b)) and 'not_found' in (err(anon(), "select public.get_booking_by_code(%s)", (CODE_O,)) or '') and
    q(anon(), "select public.get_booking_by_code(%s)", (re.search(r'#code=([0-9A-F]{32})', b).group(1),))[0][0]['title'] == 'ลืมรหัส')(q(su, "select body from public.email_outbox")[0][0]))
ok('request_manage_links is rate-limited per address', [err(anon(), "select public.request_manage_links('forgot@x.co')") for _ in range(3)][2] is not None)
ok('outbox and rate tables unreachable by anon/authenticated', all(err(c, "select * from public.email_outbox") is not None for c in (anon(), conn('authenticated', ADM))))
ok('mail settings: admin read/write, validation, anon refused', err(cadm, "select public.save_mail_settings('https://a.example','x@y.co')") is None and q(cadm, "select public.get_mail_settings()")[0][0]['site_url'] == 'https://a.example' and
   'invalid' in (err(cadm, "select public.save_mail_settings('javascript:alert(1)','')") or '') and err(anon(), "select public.get_mail_settings()") is not None)
sql("update public.settings set value='https://rooms.example.go.th' where key='site_url'")

# ---------- publication + concurrency
ok('realtime publication includes public_slots', q(su, "select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='public_slots'")[0][0] == 1)
sql("truncate public.rate_events"); res_c = []
def worker(i): res_c.append(book(anon('5.5.%d.%d' % (i, i)), R2, tomorrow + __import__('datetime').timedelta(days=20), 780, 840, title='พร้อมกัน%d' % i, email='p%d@x.co' % i))
ts = [threading.Thread(target=worker, args=(i,)) for i in range(20)]; [t.start() for t in ts]; [t.join() for t in ts]
ok('20 parallel anonymous bookings of one slot: exactly 1 succeeds', sum(not str(r).startswith('ERR') for r in res_c) == 1 and sum('slot_taken' in str(r) for r in res_c) == 19, res_c)
ok('exactly one active row and one public slot for it', q(su, "select count(*) from public.bookings where title like 'พร้อมกัน%%' and status='active'")[0][0] == 1 and q(su, "select count(*) from public.public_slots where day=%s and start_min=780 and room_id=%s", (tomorrow + __import__('datetime').timedelta(days=20), str(R2)))[0][0] == 1)
print('\n%d/%d passed' % (sum(res), len(res))); sys.exit(0 if all(res) else 1)
