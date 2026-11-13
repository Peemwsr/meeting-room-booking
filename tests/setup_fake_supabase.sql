-- ใช้ทดสอบ schema.sql บน Postgres ธรรมดา (ไม่ใช่ Supabase) ด้วยการสร้างส่วนที่ Supabase มีให้แบบจำลอง
-- ขั้นตอน (ต้องมี Postgres และ Python + psycopg2):
--   createdb rb_test
--   psql rb_test -f tests/setup_fake_supabase.sql
--   psql rb_test -f supabase/schema.sql
--   python3 tests/test_sql.py        (แก้ DSN ในไฟล์ให้ตรงกับเครื่อง)
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
drop publication if exists supabase_realtime;
create publication supabase_realtime;
grant usage on schema public, auth, storage to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
