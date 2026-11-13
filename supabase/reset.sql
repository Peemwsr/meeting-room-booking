-- ลบของเดิมทั้งหมดของระบบนี้ (ใช้ตอนทดลอง หรือเมื่อเคยรัน schema เวอร์ชันเก่า) ข้อมูลการจองจะหายหมด
drop table if exists public.email_outbox, public.rate_events, public.public_slots, public.booking_events, public.booking_contacts,
  public.bookings, public.options, public.rooms, public.settings cascade;
drop function if exists public.create_booking(uuid, date, int, int, text, text, text, text, int, text[], text, text, text) cascade;
drop function if exists public.update_booking(uuid, uuid, date, int, int, text, text, text, text, int, text[], text, text, text, text) cascade;
drop function if exists public.cancel_booking(uuid, text) cascade;
-- บัญชีผู้ดูแลและตาราง profiles ไม่ถูกลบ
