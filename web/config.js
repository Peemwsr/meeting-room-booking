// ตั้งค่าการเชื่อมต่อ Supabase
// หาค่าได้ที่ Supabase > Project Settings > API
//   SUPABASE_URL      = Project URL
//   SUPABASE_ANON_KEY = ค่าชื่อ "anon public" (ใส่ในหน้าเว็บได้ ไม่เป็นความลับ ความปลอดภัยอยู่ที่กติกาในฐานข้อมูล)
// ห้ามใส่ค่า "service_role" ในไฟล์นี้เด็ดขาด
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',

  // เวลาเปิดจอง (ชั่วโมง) ต้องตรงกับค่า day_start_min / day_end_min ในฐานข้อมูล (480 = 8 โมง, 960 = 16 โมง)
  DAY_START_HOUR: 8,
  DAY_END_HOUR: 16
};
