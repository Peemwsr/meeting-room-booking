-- =====================================================================
-- ระบบจองห้องประชุมจังหวัดสกลนคร: ฐานข้อมูลสำหรับ Supabase (เวอร์ชันผู้จองไม่ต้องล็อกอิน)
-- วิธีใช้: เปิด Supabase > SQL Editor > New query > วางไฟล์นี้ทั้งไฟล์ > Run
-- รันซ้ำได้ ไม่ทำให้ข้อมูลเดิมหาย
-- (ถ้าเคยรันไฟล์เวอร์ชันที่ต้องล็อกอินไว้แล้ว ให้รัน supabase/reset.sql ก่อน แล้วค่อยรันไฟล์นี้)
--
-- หลักการ
--   ผู้จอง: ไม่มีบัญชี จองได้เลย ได้ "รหัสการจอง" ไว้ยกเลิก/แก้ไข (ฐานข้อมูลเก็บเฉพาะค่าเข้ารหัสทางเดียวของรหัส)
--   ผู้ดูแล: ล็อกอินด้วยบัญชี Supabase Auth ที่คุณสร้างเอง (ปิดการสมัครสมาชิกเองไว้)
--   คนทั่วไปอ่านได้เฉพาะ ห้อง ตัวเลือก และ "ช่วงที่ไม่ว่าง" (ไม่มีชื่อ หัวข้อ เบอร์ หรืออีเมล)
-- =====================================================================

create extension if not exists btree_gist;   -- ใช้กันการจองซ้อนที่ระดับฐานข้อมูล

-- ---------------------------------------------------------------------
-- 1) ค่าตั้งระบบ
--    เวลาเปิดจองเก็บเป็น "นาทีนับจากเที่ยงคืน" 480 = 08:00, 960 = 16:00
--    (ถ้าแก้ ต้องแก้ DAY_START_HOUR / DAY_END_HOUR ใน web/config.js ให้ตรงกัน)
--    site_url     = ที่อยู่เว็บ ใช้ทำลิงก์ในอีเมล (ว่าง = ปิดการส่งอีเมล) ตั้งได้ที่หน้าผู้ดูแล
--    admin_emails = อีเมลผู้ดูแลที่รับแจ้งเมื่อมีการจอง/แก้ไข/ยกเลิก (คั่นด้วยจุลภาค)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  key   text primary key,
  value text not null
);
insert into public.settings (key, value) values
  ('day_start_min', '480'),
  ('day_end_min', '960'),
  ('site_url', ''),
  ('admin_emails', ''),
  ('limit_ip_per_hour', '10'),         -- จองได้กี่ครั้งต่อชั่วโมงต่อ IP
  ('limit_global_per_hour', '120'),    -- จองได้กี่ครั้งต่อชั่วโมงทั้งระบบ (กันถูกถล่ม)
  ('limit_active_per_email', '10'),    -- การจองที่ยังไม่ถึงวันได้กี่รายการต่ออีเมล
  ('slot_salt', md5(random()::text || clock_timestamp()::text))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2) บัญชีผู้ดูแล (Supabase Auth) และโปรไฟล์
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null default '',
  full_name       text not null default '',
  phone           text not null default '',
  agency          text not null default '',
  role            text not null default 'user' check (role in ('user', 'admin')),
  notices_seen_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone, agency)
  values (new.id, coalesce(new.email, ''),
          left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80),
          left(coalesce(new.raw_user_meta_data ->> 'phone', ''), 30),
          left(coalesce(new.raw_user_meta_data ->> 'agency', ''), 100))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public._profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.id is distinct from old.id then raise exception 'forbidden'; end if;
    new.email := old.email;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public._profiles_guard();

-- ---------------------------------------------------------------------
-- 3) ห้องประชุม และตัวเลือก (อุปกรณ์ / ความต้องการ)
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  location    text not null default '',
  capacity    int  not null check (capacity between 1 and 999),
  description text not null default '',
  equipment   text[] not null default '{}',
  status      text not null default 'open' check (status in ('open', 'closed')),
  photo_path  text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
create table if not exists public.options (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('equipment', 'need')),
  name       text not null check (char_length(name) between 1 and 60),
  sort_order int  not null default 0,
  unique (kind, name)
);
insert into public.options (kind, name, sort_order) values
  ('equipment', 'โปรเจกเตอร์', 1), ('equipment', 'จอแสดงผล', 2), ('equipment', 'ไวท์บอร์ด', 3),
  ('equipment', 'ระบบประชุมทางไกล', 4), ('equipment', 'ไมโครโฟนและลำโพง', 5), ('equipment', 'Wi-Fi', 6),
  ('equipment', 'ปลั๊กไฟที่โต๊ะ', 7), ('equipment', 'เครื่องปรับอากาศ', 8),
  ('need', 'จัดโต๊ะแบบตัวยู', 1), ('need', 'จัดโต๊ะแบบห้องเรียน', 2), ('need', 'น้ำดื่ม', 3),
  ('need', 'กาแฟและของว่าง', 4), ('need', 'ไมโครโฟนเพิ่มเติม', 5), ('need', 'ขอผู้ช่วยดูแลระบบภาพและเสียง', 6),
  ('need', 'ประชุมออนไลน์ (ต้องใช้กล้องและลำโพงรวม)', 7), ('need', 'ปากกาและอุปกรณ์ไวท์บอร์ด', 8)
on conflict (kind, name) do nothing;

-- ---------------------------------------------------------------------
-- 4) การจอง
--    วันที่ + นาทีนับจากเที่ยงคืนตามเวลาไทย / EXCLUDE ทำให้ฐานข้อมูลปฏิเสธเวลาทับกันเอง
--    ไม่มีเจ้าของบัญชี: ผู้จองยืนยันตัวตนด้วย "รหัสการจอง" (เก็บเฉพาะค่า sha256 ของรหัส)
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete restrict,
  code_hash   bytea not null unique,
  day         date not null,
  start_min   int  not null,
  end_min     int  not null,
  title       text not null check (char_length(title) between 1 and 120),
  booker_name text not null check (char_length(booker_name) between 1 and 80),
  agency      text not null check (char_length(agency) between 1 and 100),
  mode        text not null check (mode in ('normal', 'online', 'vcs')),
  attendees   int  check (attendees is null or attendees >= 1),
  needs       text[] not null default '{}',
  note        text not null default '' check (char_length(note) <= 500),
  status      text not null default 'active' check (status in ('active', 'cancelled')),
  prepared    boolean not null default false,
  by_admin    boolean not null default false,          -- ผู้ดูแลจองแทนผู้อื่น
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint bookings_whole_hours check (start_min % 60 = 0 and end_min % 60 = 0 and end_min > start_min),
  constraint bookings_no_overlap exclude using gist (
    room_id with =, day with =, int4range(start_min, end_min) with &&
  ) where (status = 'active')
);
create index if not exists bookings_day_idx on public.bookings (day);

-- เบอร์โทรและอีเมล แยกตาราง เห็นได้เฉพาะผู้ดูแล (ผู้จองเห็นของตัวเองผ่านรหัสการจองเท่านั้น)
create table if not exists public.booking_contacts (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  phone      text not null default '',
  email      text not null default ''
);

create table if not exists public.booking_events (
  id         bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  actor_id   uuid,
  actor_kind text not null default 'requester' check (actor_kind in ('requester', 'admin', 'system')),
  kind       text not null check (kind in ('created', 'edited', 'moved', 'cancelled', 'prepared')),
  text       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists booking_events_booking_idx on public.booking_events (booking_id);

-- ช่วงเวลาที่ไม่ว่าง (สำหรับปฏิทินสาธารณะ) ไม่มีข้อมูลส่วนตัว และไม่มีรหัสการจองจริง
create table if not exists public.public_slots (
  id        bigint generated always as identity primary key,
  bk_key    text not null unique,      -- ค่าสับ ไม่ใช่รหัสการจอง
  room_id   uuid not null,
  day       date not null,
  start_min int  not null,
  end_min   int  not null
);
create index if not exists public_slots_day_idx on public.public_slots (day);

create or replace function public._sync_slot()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_salt text; v_key text;
begin
  select value into v_salt from public.settings where key = 'slot_salt';
  if tg_op = 'DELETE' then
    delete from public.public_slots where bk_key = md5(old.id::text || coalesce(v_salt, ''));
    return old;
  end if;
  v_key := md5(new.id::text || coalesce(v_salt, ''));
  delete from public.public_slots where bk_key = v_key;
  if new.status = 'active' then
    insert into public.public_slots (bk_key, room_id, day, start_min, end_min) values (v_key, new.room_id, new.day, new.start_min, new.end_min);
  end if;
  return new;
end $$;
drop trigger if exists bookings_sync_slot on public.bookings;
create trigger bookings_sync_slot after insert or update or delete on public.bookings
  for each row execute function public._sync_slot();

-- คิวอีเมล (ตัวส่ง mailer.js ที่ใช้ service_role อ่านและส่ง แล้วล้างเนื้อหาที่มีรหัสการจองทิ้ง)
create table if not exists public.email_outbox (
  id           bigint generated always as identity primary key,
  to_addr      text not null,
  subject      text not null,
  body         text not null,
  status       text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  tries        int  not null default 0,
  next_try_at  timestamptz not null default now(),
  last_error   text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists email_outbox_pending_idx on public.email_outbox (status, next_try_at);

-- ตัวนับอัตราการเรียก (กันสแปม)
create table if not exists public.rate_events (
  id  bigint generated always as identity primary key,
  key text not null,
  at  timestamptz not null default now()
);
create index if not exists rate_events_key_idx on public.rate_events (key, at);

-- ---------------------------------------------------------------------
-- 5) สิทธิ์การเข้าถึง
-- ---------------------------------------------------------------------
alter table public.settings         enable row level security;
alter table public.profiles         enable row level security;
alter table public.rooms            enable row level security;
alter table public.options          enable row level security;
alter table public.bookings         enable row level security;
alter table public.booking_contacts enable row level security;
alter table public.booking_events   enable row level security;
alter table public.public_slots     enable row level security;
alter table public.email_outbox     enable row level security;
alter table public.rate_events      enable row level security;

drop policy if exists settings_public on public.settings;
drop policy if exists settings_admin  on public.settings;
create policy settings_public on public.settings for select to anon, authenticated using (key in ('day_start_min', 'day_end_min'));
create policy settings_admin  on public.settings for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists rooms_read  on public.rooms;
drop policy if exists rooms_admin on public.rooms;
create policy rooms_read  on public.rooms for select to anon, authenticated using (true);
create policy rooms_admin on public.rooms for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists options_read  on public.options;
drop policy if exists options_admin on public.options;
create policy options_read  on public.options for select to anon, authenticated using (true);
create policy options_admin on public.options for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists bookings_admin on public.bookings;
create policy bookings_admin on public.bookings for select to authenticated using (public.is_admin());
drop policy if exists contacts_admin on public.booking_contacts;
create policy contacts_admin on public.booking_contacts for select to authenticated using (public.is_admin());
drop policy if exists events_admin on public.booking_events;
create policy events_admin on public.booking_events for select to authenticated using (public.is_admin());
drop policy if exists slots_read on public.public_slots;
create policy slots_read on public.public_slots for select to anon, authenticated using (true);
-- email_outbox / rate_events: ไม่มีนโยบายเลย = เข้าถึงได้เฉพาะ service_role และฟังก์ชันของระบบ

revoke all on public.settings, public.profiles, public.rooms, public.options, public.bookings, public.booking_contacts,
              public.booking_events, public.public_slots, public.email_outbox, public.rate_events from anon;
grant select on public.rooms, public.options, public.settings, public.public_slots to anon;
revoke insert, update, delete on public.bookings, public.booking_contacts, public.booking_events, public.public_slots from authenticated;
revoke all on public.email_outbox, public.rate_events from authenticated;

-- ---------------------------------------------------------------------
-- 6) ฟังก์ชันช่วย (ใช้ภายใน)
-- ---------------------------------------------------------------------
create or replace function public._today()   returns date language sql stable as $$ select (now() at time zone 'Asia/Bangkok')::date $$;
create or replace function public._now_min() returns int  language sql stable as
  $$ select (extract(hour from now() at time zone 'Asia/Bangkok') * 60 + extract(minute from now() at time zone 'Asia/Bangkok'))::int $$;
create or replace function public._hhmm(m int) returns text language sql immutable as
  $$ select lpad((m / 60)::text, 2, '0') || ':' || lpad((m % 60)::text, 2, '0') $$;
create or replace function public._thai_date(d date) returns text language sql immutable as
  $$ select to_char(d, 'DD/MM/') || (extract(year from d)::int + 543)::text $$;
create or replace function public._setting(k text) returns text language sql stable security definer set search_path = public as
  $$ select coalesce((select value from public.settings where key = k), '') $$;
create or replace function public._setting_int(k text, d int) returns int language sql stable security definer set search_path = public as
  $$ select coalesce(nullif(regexp_replace((select value from public.settings where key = k), '[^0-9]', '', 'g'), '')::int, d) $$;

-- รหัสการจอง: 32 ตัวอักษรฐานสิบหก (สุ่ม 122 บิต) เก็บเฉพาะค่า sha256
create or replace function public._norm_code(c text) returns text language sql immutable as
  $$ select upper(regexp_replace(coalesce(c, ''), '[^0-9A-Za-z]', '', 'g')) $$;
create or replace function public._code_hash(c text) returns bytea language sql immutable as
  $$ select sha256(convert_to(public._norm_code(c), 'UTF8')) $$;
create or replace function public._new_code() returns text language sql volatile as
  $$ select upper(replace(gen_random_uuid()::text, '-', '')) $$;

create or replace function public._client_ip() returns text language plpgsql stable as $$
declare h json;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  return coalesce(nullif(h ->> 'cf-connecting-ip', ''), nullif(btrim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), ''), 'unknown');
end $$;

create or replace function public._rate_check(p_key text, p_limit int, p_window interval)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.rate_events where at < now() - interval '2 days';
  if (select count(*) from public.rate_events where key = p_key and at > now() - p_window) >= p_limit then
    raise exception 'rate_limited';
  end if;
  insert into public.rate_events (key) values (p_key);
end $$;

-- อีเมล: ทำงานเมื่อกรอก site_url แล้วเท่านั้น
create or replace function public._mail_enabled() returns boolean language sql stable security definer set search_path = public as
  $$ select btrim(public._setting('site_url')) <> '' $$;
create or replace function public._queue_mail(p_to text, p_subject text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._mail_enabled() then return; end if;
  if coalesce(p_to, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return; end if;
  insert into public.email_outbox (to_addr, subject, body) values (btrim(p_to), left(p_subject, 200), p_body);
end $$;
create or replace function public._manage_link(p_code text) returns text language sql stable security definer set search_path = public as
  $$ select rtrim(public._setting('site_url'), '/') || '/#code=' || public._norm_code(p_code) $$;
create or replace function public._code_pretty(p_code text) returns text language sql immutable as
  $$ select regexp_replace(public._norm_code(p_code), '(.{4})(?=.)', '\1-', 'g') $$;
create or replace function public._notify_admins(p_subject text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare a text;
begin
  if not public._mail_enabled() then return; end if;
  for a in select btrim(x) from unnest(string_to_array(public._setting('admin_emails'), ',')) x where btrim(x) <> '' loop
    perform public._queue_mail(a, p_subject, p_body);
  end loop;
end $$;

create or replace function public._check_text_args(
  p_title text, p_name text, p_agency text, p_mode text, p_phone text, p_email text, p_note text, p_needs text[]
) returns void language plpgsql immutable as $$
begin
  if btrim(coalesce(p_title, ''))  = '' or char_length(p_title)  > 120 then raise exception 'invalid'; end if;
  if btrim(coalesce(p_name, ''))   = '' or char_length(p_name)   > 80  then raise exception 'invalid'; end if;
  if btrim(coalesce(p_agency, '')) = '' or char_length(p_agency) > 100 then raise exception 'invalid'; end if;
  if p_mode is null or p_mode not in ('normal', 'online', 'vcs') then raise exception 'invalid'; end if;
  if regexp_replace(coalesce(p_phone, ''), '[\s\-().]', '', 'g') !~ '^\+?[0-9]{9,12}$' or char_length(p_phone) > 30
    then raise exception 'invalid_phone'; end if;
  if coalesce(p_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(p_email) > 120 then raise exception 'invalid_email'; end if;
  if char_length(coalesce(p_note, '')) > 500 then raise exception 'invalid'; end if;
  if coalesce(array_length(p_needs, 1), 0) > 30 then raise exception 'invalid'; end if;
end $$;

create or replace function public._check_slot(
  p_room uuid, p_day date, p_start int, p_end int, p_attendees int, p_check_time boolean, p_check_room_open boolean
) returns void language plpgsql stable security definer set search_path = public as $$
declare v_room public.rooms%rowtype; v_ds int; v_de int;
begin
  select * into v_room from public.rooms where id = p_room;
  if not found then raise exception 'invalid'; end if;
  if p_check_room_open and v_room.status <> 'open' then raise exception 'room_closed'; end if;
  if p_attendees is not null and (p_attendees < 1 or p_attendees > v_room.capacity) then raise exception 'over_capacity'; end if;
  if p_check_time then
    v_ds := public._setting_int('day_start_min', 480); v_de := public._setting_int('day_end_min', 960);
    if p_start % 60 <> 0 or p_end % 60 <> 0 or p_end <= p_start then raise exception 'invalid'; end if;
    if p_start < v_ds or p_end > v_de then raise exception 'outside_hours'; end if;
    if p_day < public._today() or (p_day = public._today() and p_start < (public._now_min() / 60) * 60) then raise exception 'past_slot'; end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7) แกนการจอง / แก้ไข / ยกเลิก (ใช้ร่วมกันทั้งผู้จองและผู้ดูแล)
-- ---------------------------------------------------------------------
create or replace function public._mail_booking_lines(b public.bookings, r text)
returns text language sql stable security definer set search_path = public as $$
  select 'เรื่อง: ' || b.title || chr(10) || 'ห้อง: ' || r || chr(10) || 'วันที่: ' || public._thai_date(b.day) || chr(10) ||
         'เวลา: ' || public._hhmm(b.start_min) || '–' || public._hhmm(b.end_min) || ' น.' || chr(10) ||
         'ผู้จอง: ' || b.booker_name || ' (' || b.agency || ')'
$$;

create or replace function public._create_core(
  p_room uuid, p_day date, p_start int, p_end int, p_title text, p_name text, p_agency text, p_mode text,
  p_attendees int, p_needs text[], p_note text, p_phone text, p_email text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.is_admin();
  v_code  text := public._new_code();
  v_id    uuid;
  v_room  text;
  v_b     public.bookings%rowtype;
begin
  perform public._check_text_args(p_title, p_name, p_agency, p_mode, p_phone, p_email, p_note, p_needs);
  perform public._check_slot(p_room, p_day, p_start, p_end, p_attendees, true, true);
  if not v_admin then
    perform public._rate_check('ip:' || public._client_ip(), public._setting_int('limit_ip_per_hour', 10), interval '1 hour');
    perform public._rate_check('all', public._setting_int('limit_global_per_hour', 120), interval '1 hour');
    if (select count(*) from public.bookings b join public.booking_contacts c on c.booking_id = b.id
        where lower(c.email) = lower(btrim(p_email)) and b.status = 'active'
          and (b.day > public._today() or (b.day = public._today() and b.end_min > public._now_min()))) >= public._setting_int('limit_active_per_email', 10)
    then raise exception 'limit_reached'; end if;
  end if;

  begin
    insert into public.bookings (room_id, code_hash, day, start_min, end_min, title, booker_name, agency, mode, attendees, needs, note, by_admin)
    values (p_room, public._code_hash(v_code), p_day, p_start, p_end, btrim(p_title), btrim(p_name), btrim(p_agency), p_mode,
            p_attendees, coalesce(p_needs, '{}'), coalesce(p_note, ''), v_admin)
    returning id into v_id;
  exception when exclusion_violation then raise exception 'slot_taken';
  end;
  insert into public.booking_contacts (booking_id, phone, email) values (v_id, btrim(p_phone), btrim(p_email));
  select name into v_room from public.rooms where id = p_room;
  insert into public.booking_events (booking_id, actor_id, actor_kind, kind, text)
  values (v_id, auth.uid(), case when v_admin then 'admin' else 'requester' end, 'created',
          'จอง ' || v_room || ' ' || p_day::text || ' ' || public._hhmm(p_start) || '–' || public._hhmm(p_end) || ' น.');

  select * into v_b from public.bookings where id = v_id;
  perform public._queue_mail(btrim(p_email), 'ยืนยันการจองห้องประชุม ' || v_room || ' วันที่ ' || public._thai_date(p_day),
    'เรียน ' || btrim(p_name) || chr(10) || chr(10) || 'ระบบได้รับการจองห้องประชุมของคุณแล้ว' || chr(10) || chr(10) ||
    public._mail_booking_lines(v_b, v_room) || chr(10) || chr(10) ||
    'รหัสการจอง: ' || public._code_pretty(v_code) || chr(10) ||
    'ยกเลิกหรือแก้ไขการจองได้ที่ลิงก์นี้ (ไม่ต้องเข้าสู่ระบบ):' || chr(10) || public._manage_link(v_code) || chr(10) || chr(10) ||
    'โปรดเก็บอีเมลนี้ไว้ เพราะผู้ที่มีลิงก์หรือรหัสนี้ยกเลิกหรือแก้ไขการจองได้' || chr(10) || 'ระบบจองห้องประชุมจังหวัดสกลนคร');
  if not v_admin then
    perform public._notify_admins('การจองใหม่: ' || v_room || ' ' || public._thai_date(p_day) || ' ' || public._hhmm(p_start) || '–' || public._hhmm(p_end),
      'มีการจองห้องประชุมใหม่' || chr(10) || chr(10) || public._mail_booking_lines(v_b, v_room) || chr(10) || chr(10) || 'ดูรายละเอียดและเตรียมห้องที่หน้าผู้ดูแล: ' || rtrim(public._setting('site_url'), '/'));
  end if;
  return v_code;
end $$;

create or replace function public._update_core(
  p_id uuid, p_room uuid, p_day date, p_start int, p_end int, p_title text, p_name text, p_agency text, p_mode text,
  p_attendees int, p_needs text[], p_note text, p_phone text, p_email text, p_summary text, p_admin boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_b public.bookings%rowtype; v_changed boolean; v_room text; v_old public.booking_contacts%rowtype; v_nb public.bookings%rowtype;
begin
  select * into v_b from public.bookings where id = p_id for update;
  if not found or v_b.status <> 'active' then raise exception 'gone'; end if;
  if v_b.day < public._today() or (v_b.day = public._today() and v_b.end_min <= public._now_min()) then raise exception 'gone'; end if;
  perform public._check_text_args(p_title, p_name, p_agency, p_mode, p_phone, p_email, p_note, p_needs);
  v_changed := v_b.room_id <> p_room or v_b.day <> p_day or v_b.start_min <> p_start or v_b.end_min <> p_end;
  perform public._check_slot(p_room, p_day, p_start, p_end, p_attendees, v_changed, v_changed);
  begin
    update public.bookings set room_id = p_room, day = p_day, start_min = p_start, end_min = p_end, title = btrim(p_title),
      booker_name = btrim(p_name), agency = btrim(p_agency), mode = p_mode, attendees = p_attendees,
      needs = coalesce(p_needs, '{}'), note = coalesce(p_note, ''), prepared = case when v_changed then false else prepared end, updated_at = now()
    where id = p_id;
  exception when exclusion_violation then raise exception 'slot_taken';
  end;
  select * into v_old from public.booking_contacts where booking_id = p_id;
  insert into public.booking_contacts (booking_id, phone, email) values (p_id, btrim(p_phone), btrim(p_email))
  on conflict (booking_id) do update set phone = excluded.phone, email = excluded.email;
  insert into public.booking_events (booking_id, actor_id, actor_kind, kind, text)
  values (p_id, auth.uid(), case when p_admin then 'admin' else 'requester' end, case when v_changed then 'moved' else 'edited' end, left(coalesce(p_summary, ''), 300));

  select * into v_nb from public.bookings where id = p_id;
  select name into v_room from public.rooms where id = p_room;
  if p_admin then
    perform public._queue_mail(btrim(p_email), 'ผู้ดูแลแก้ไขการจองห้องประชุมของคุณ',
      'เรียน ' || btrim(p_name) || chr(10) || chr(10) || 'ผู้ดูแลระบบแก้ไขการจองของคุณ ข้อมูลล่าสุดคือ' || chr(10) || chr(10) ||
      public._mail_booking_lines(v_nb, v_room) || chr(10) || chr(10) || 'ระบบจองห้องประชุมจังหวัดสกลนคร');
  else
    perform public._notify_admins('การจองถูกแก้ไข: ' || v_room || ' ' || public._thai_date(p_day) || ' ' || public._hhmm(p_start) || '–' || public._hhmm(p_end),
      'ผู้จองแก้ไขการจอง ' || coalesce(nullif(p_summary, ''), '') || chr(10) || chr(10) || public._mail_booking_lines(v_nb, v_room));
  end if;
end $$;

create or replace function public._cancel_core(p_id uuid, p_reason text, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_b public.bookings%rowtype; v_room text; v_c public.booking_contacts%rowtype; v_r text := left(btrim(coalesce(p_reason, '')), 200);
begin
  select * into v_b from public.bookings where id = p_id for update;
  if not found or v_b.status <> 'active' then raise exception 'gone'; end if;
  if v_b.day < public._today() or (v_b.day = public._today() and v_b.end_min <= public._now_min()) then raise exception 'gone'; end if;
  update public.bookings set status = 'cancelled', updated_at = now() where id = p_id;
  insert into public.booking_events (booking_id, actor_id, actor_kind, kind, text)
  values (p_id, auth.uid(), case when p_admin then 'admin' else 'requester' end, 'cancelled',
          case when p_admin then 'ผู้ดูแลยกเลิกการจอง' else 'ผู้จองยกเลิกการจอง' end || case when v_r <> '' then ' เหตุผล: ' || v_r else '' end);
  select name into v_room from public.rooms where id = v_b.room_id;
  select * into v_c from public.booking_contacts where booking_id = p_id;
  if p_admin then
    perform public._queue_mail(v_c.email, 'ผู้ดูแลยกเลิกการจองห้องประชุมของคุณ',
      'เรียน ' || v_b.booker_name || chr(10) || chr(10) || 'ผู้ดูแลระบบยกเลิกการจองต่อไปนี้' || case when v_r <> '' then ' เหตุผล: ' || v_r else '' end || chr(10) || chr(10) ||
      public._mail_booking_lines(v_b, v_room) || chr(10) || chr(10) || 'ระบบจองห้องประชุมจังหวัดสกลนคร');
  else
    perform public._queue_mail(v_c.email, 'ยืนยันการยกเลิกการจองห้องประชุม',
      'เรียน ' || v_b.booker_name || chr(10) || chr(10) || 'ระบบยกเลิกการจองต่อไปนี้ให้แล้ว' || chr(10) || chr(10) || public._mail_booking_lines(v_b, v_room));
    perform public._notify_admins('การจองถูกยกเลิก: ' || v_room || ' ' || public._thai_date(v_b.day) || ' ' || public._hhmm(v_b.start_min) || '–' || public._hhmm(v_b.end_min),
      'ผู้จองยกเลิกการจอง' || chr(10) || chr(10) || public._mail_booking_lines(v_b, v_room));
  end if;
end $$;

create or replace function public._find_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if char_length(public._norm_code(p_code)) < 20 then raise exception 'not_found'; end if;
  select id into v from public.bookings where code_hash = public._code_hash(p_code);
  if v is null then raise exception 'not_found'; end if;
  return v;
end $$;

create or replace function public._booking_json(b public.bookings)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'room_id', b.room_id, 'day', b.day, 'start_min', b.start_min, 'end_min', b.end_min, 'title', b.title,
    'booker_name', b.booker_name, 'agency', b.agency, 'mode', b.mode, 'attendees', b.attendees, 'needs', b.needs, 'note', b.note,
    'status', b.status, 'prepared', b.prepared, 'created_at', b.created_at,
    'phone', (select phone from public.booking_contacts where booking_id = b.id), 'email', (select email from public.booking_contacts where booking_id = b.id))
$$;

-- ---------------------------------------------------------------------
-- 8) ฟังก์ชันที่หน้าเว็บเรียก: ผู้จอง (ไม่ต้องล็อกอิน)
--    ข้อความผิดพลาด: not_found, rate_limited, limit_reached, gone, invalid, invalid_phone, invalid_email,
--    room_closed, over_capacity, outside_hours, past_slot, slot_taken
-- ---------------------------------------------------------------------
create or replace function public.create_booking_public(
  p_room uuid, p_day date, p_start int, p_end int, p_title text, p_name text, p_agency text, p_mode text,
  p_attendees int, p_needs text[], p_note text, p_phone text, p_email text
) returns text language sql security definer set search_path = public as $$
  select public._create_core(p_room, p_day, p_start, p_end, p_title, p_name, p_agency, p_mode, p_attendees, p_needs, p_note, p_phone, p_email);
$$;

create or replace function public.get_booking_by_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = public._find_by_code(p_code);
  return public._booking_json(b);
end $$;

create or replace function public.get_bookings_by_codes(p_codes text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare c text; b public.bookings%rowtype; out jsonb := '[]'::jsonb; n int := 0;
begin
  foreach c in array coalesce(p_codes, '{}') loop
    n := n + 1; exit when n > 30;
    select * into b from public.bookings where code_hash = public._code_hash(c) and char_length(public._norm_code(c)) >= 20;
    if found then out := out || jsonb_build_array(public._booking_json(b) || jsonb_build_object('code', public._norm_code(c))); end if;
  end loop;
  return out;
end $$;

create or replace function public.update_booking_by_code(
  p_code text, p_room uuid, p_day date, p_start int, p_end int, p_title text, p_name text, p_agency text, p_mode text,
  p_attendees int, p_needs text[], p_note text, p_phone text, p_email text, p_summary text default ''
) returns void language sql security definer set search_path = public as $$
  select public._update_core(public._find_by_code(p_code), p_room, p_day, p_start, p_end, p_title, p_name, p_agency, p_mode,
                             p_attendees, p_needs, p_note, p_phone, p_email, p_summary, false);
$$;

create or replace function public.cancel_booking_by_code(p_code text, p_reason text default '')
returns void language sql security definer set search_path = public as $$
  select public._cancel_core(public._find_by_code(p_code), p_reason, false);
$$;

-- ลืมรหัส: ส่งลิงก์ใหม่ของการจองที่ยังไม่ถึงวันไปที่อีเมลนั้น (ออกรหัสใหม่ รหัสเดิมใช้ไม่ได้) ไม่บอกว่าอีเมลนั้นมีการจองหรือไม่
create or replace function public.request_manage_links(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); r record; v_code text; v_body text := ''; v_n int := 0;
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 120 then raise exception 'invalid_email'; end if;
  perform public._rate_check('links:' || v_email, 3, interval '1 hour');
  perform public._rate_check('links-ip:' || public._client_ip(), 20, interval '1 hour');
  if not public._mail_enabled() then return; end if;
  for r in select b.*, (select name from public.rooms where id = b.room_id) as room_name
           from public.bookings b join public.booking_contacts c on c.booking_id = b.id
           where lower(c.email) = v_email and b.status = 'active' and (b.day > public._today() or (b.day = public._today() and b.end_min > public._now_min()))
           order by b.day, b.start_min limit 20 loop
    v_code := public._new_code();
    update public.bookings set code_hash = public._code_hash(v_code) where id = r.id;
    v_body := v_body || chr(10) || r.title || ' | ' || r.room_name || ' | ' || public._thai_date(r.day) || ' ' || public._hhmm(r.start_min) || '–' || public._hhmm(r.end_min) || ' น.' || chr(10)
                     || 'รหัส: ' || public._code_pretty(v_code) || chr(10) || public._manage_link(v_code) || chr(10);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    perform public._queue_mail(v_email, 'ลิงก์ยกเลิกหรือแก้ไขการจองห้องประชุมของคุณ',
      'ตามที่ขอ นี่คือลิงก์สำหรับการจองที่ยังไม่ถึงวันของอีเมลนี้' || chr(10) || '(รหัสเดิมที่เคยได้รับจะใช้ไม่ได้แล้ว)' || chr(10) || v_body || chr(10) || 'ระบบจองห้องประชุมจังหวัดสกลนคร');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9) ฟังก์ชันของผู้ดูแล (ต้องล็อกอินและมีสิทธิ์ผู้ดูแล)
-- ---------------------------------------------------------------------
create or replace function public.admin_create_booking(
  p_room uuid, p_day date, p_start int, p_end int, p_title text, p_name text, p_agency text, p_mode text,
  p_attendees int, p_needs text[], p_note text, p_phone text, p_email text
) returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden'; end if;
  return public._create_core(p_room, p_day, p_start, p_end, p_title, p_name, p_agency, p_mode, p_attendees, p_needs, p_note, p_phone, p_email);
end $$;

create or replace function public.update_booking(
  p_id uuid, p_room uuid, p_day date, p_start int, p_end int, p_title text, p_name text, p_agency text, p_mode text,
  p_attendees int, p_needs text[], p_note text, p_phone text, p_email text, p_summary text default ''
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden'; end if;
  perform public._update_core(p_id, p_room, p_day, p_start, p_end, p_title, p_name, p_agency, p_mode, p_attendees, p_needs, p_note, p_phone, p_email, p_summary, true);
end $$;

create or replace function public.cancel_booking(p_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden'; end if;
  perform public._cancel_core(p_id, p_reason, true);
end $$;

create or replace function public.set_prepared(p_id uuid, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden'; end if;
  update public.bookings set prepared = p_value, updated_at = now() where id = p_id and status = 'active';
  if not found then raise exception 'gone'; end if;
  if p_value then
    insert into public.booking_events (booking_id, actor_id, actor_kind, kind, text)
    values (p_id, auth.uid(), 'admin', 'prepared', 'ผู้ดูแลเตรียมห้องและอุปกรณ์เรียบร้อยแล้ว');
  end if;
end $$;

create or replace function public.mark_notices_seen()
returns void language sql security definer set search_path = public as $$
  update public.profiles set notices_seen_at = now() where id = auth.uid();
$$;

create or replace function public.set_user_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden'; end if;
  if p_role not in ('user', 'admin') then raise exception 'invalid'; end if;
  if p_role = 'user' and exists (select 1 from public.profiles where id = p_user and role = 'admin')
     and (select count(*) from public.profiles where role = 'admin') <= 1 then raise exception 'last_admin'; end if;
  update public.profiles set role = p_role where id = p_user;
end $$;

create or replace function public.delete_room(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden'; end if;
  if exists (select 1 from public.bookings where room_id = p_id) then raise exception 'room_has_bookings'; end if;
  delete from public.rooms where id = p_id returning photo_path into v_path;
  return v_path;
end $$;

-- แก้ค่าตั้งระบบบางตัวจากหน้าผู้ดูแล (เฉพาะ site_url และ admin_emails)
create or replace function public.save_mail_settings(p_site_url text, p_admin_emails text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden'; end if;
  if btrim(coalesce(p_site_url, '')) <> '' and p_site_url !~ '^https?://[^\s]+$' then raise exception 'invalid'; end if;
  insert into public.settings (key, value) values ('site_url', btrim(coalesce(p_site_url, ''))) on conflict (key) do update set value = excluded.value;
  insert into public.settings (key, value) values ('admin_emails', btrim(coalesce(p_admin_emails, ''))) on conflict (key) do update set value = excluded.value;
end $$;
create or replace function public.get_mail_settings()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object('site_url', public._setting('site_url'), 'admin_emails', public._setting('admin_emails'),
    'pending', (select count(*) from public.email_outbox where status = 'pending'),
    'failed', (select count(*) from public.email_outbox where status = 'failed' and created_at > now() - interval '7 days'),
    'sent_24h', (select count(*) from public.email_outbox where status = 'sent' and sent_at > now() - interval '1 day'));
end $$;

-- ---------------------------------------------------------------------
-- 10) สิทธิ์เรียกฟังก์ชัน
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  -- ปิดสิทธิ์เรียกฟังก์ชันของระบบนี้ทั้งหมดก่อน (ค่าเริ่มต้นของ Postgres เปิดให้ทุกคน) แล้วเปิดเฉพาะที่ต้องใช้ด้านล่าง
  for f in
    select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any (array[
      'handle_new_user', 'is_admin', '_profiles_guard', '_sync_slot', '_today', '_now_min', '_hhmm', '_thai_date', '_setting', '_setting_int',
      '_norm_code', '_code_hash', '_new_code', '_client_ip', '_rate_check', '_mail_enabled', '_queue_mail', '_manage_link', '_code_pretty',
      '_notify_admins', '_check_text_args', '_check_slot', '_mail_booking_lines', '_create_core', '_update_core', '_cancel_core',
      '_find_by_code', '_booking_json', 'create_booking_public', 'get_booking_by_code', 'get_bookings_by_codes', 'update_booking_by_code',
      'cancel_booking_by_code', 'request_manage_links', 'admin_create_booking', 'update_booking', 'cancel_booking', 'set_prepared',
      'mark_notices_seen', 'set_user_role', 'delete_room', 'save_mail_settings', 'get_mail_settings'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function
  public.create_booking_public(uuid, date, int, int, text, text, text, text, int, text[], text, text, text),
  public.get_booking_by_code(text), public.get_bookings_by_codes(text[]),
  public.update_booking_by_code(text, uuid, date, int, int, text, text, text, text, int, text[], text, text, text, text),
  public.cancel_booking_by_code(text, text), public.request_manage_links(text)
to anon, authenticated;
grant execute on function
  public.admin_create_booking(uuid, date, int, int, text, text, text, text, int, text[], text, text, text),
  public.update_booking(uuid, uuid, date, int, int, text, text, text, text, int, text[], text, text, text, text),
  public.cancel_booking(uuid, text), public.set_prepared(uuid, boolean), public.mark_notices_seen(),
  public.set_user_role(uuid, text), public.delete_room(uuid), public.save_mail_settings(text, text), public.get_mail_settings()
to authenticated;
grant execute on function public.is_admin() to anon, authenticated;     -- นโยบาย RLS เรียกใช้ในนามผู้เรียก

-- ---------------------------------------------------------------------
-- 11) ที่เก็บรูปห้อง (Storage): ทุกคนดูรูปได้ เฉพาะผู้ดูแลอัปโหลดและลบ
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('room-photos', 'room-photos', true) on conflict (id) do nothing;
drop policy if exists "room photos read"   on storage.objects;
drop policy if exists "room photos insert" on storage.objects;
drop policy if exists "room photos update" on storage.objects;
drop policy if exists "room photos delete" on storage.objects;
create policy "room photos read"   on storage.objects for select using (bucket_id = 'room-photos');
create policy "room photos insert" on storage.objects for insert to authenticated with check (bucket_id = 'room-photos' and public.is_admin());
create policy "room photos update" on storage.objects for update to authenticated using (bucket_id = 'room-photos' and public.is_admin());
create policy "room photos delete" on storage.objects for delete to authenticated using (bucket_id = 'room-photos' and public.is_admin());

-- ---------------------------------------------------------------------
-- 12) อัปเดตแบบเรียลไทม์ (ปฏิทินสาธารณะดูจาก public_slots ผู้ดูแลดูจากตารางจริง)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['rooms', 'options', 'public_slots', 'bookings', 'booking_events', 'booking_contacts', 'profiles'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- =====================================================================
-- ขั้นต่อไป
--  1) Authentication > Providers > Email: ปิด "Allow new users to sign up" (กันคนนอกสมัครเอง)
--  2) Authentication > Users > Add user: สร้างบัญชีผู้ดูแล (อีเมล+รหัสผ่าน) แล้วรันคำสั่งนี้
--       update public.profiles set role = 'admin' where email = 'อีเมลผู้ดูแล';
--  3) เข้าหน้าผู้ดูแลในเว็บ ตั้ง "ที่อยู่เว็บ" และ "อีเมลผู้ดูแล" (เพื่อเปิดการส่งอีเมล)
-- =====================================================================
