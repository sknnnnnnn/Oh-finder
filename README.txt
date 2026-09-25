OKJ Member Finder - Cloudflare Workers v1

วิธี deploy แบบไม่ต้องติดตั้งอะไรในเครื่อง:

1) สมัคร/ล็อกอิน Cloudflare
2) ไปที่ Workers & Pages > Create > Worker
3) สร้าง Worker เปล่าก่อน
4) เปิดหน้า Edit code แล้วแทนโค้ดด้วย worker.js จาก ZIP นี้
5) ส่วน static files (index.html, styles.css, app.js) แนะนำใช้ Workers Static Assets ผ่าน Git repository
   วิธีง่ายที่สุดคืออัปโหลดโฟลเดอร์นี้เข้า GitHub แล้วใน Cloudflare เลือก Import repository
6) ตั้งค่า Environment Variables:
   API_ORIGIN = https://shop.ohkajhu.com
   APP_VERSION = 1.6.1
7) ตั้ง Secret ชื่อ SESSION_SECRET เป็นข้อความสุ่มยาวอย่างน้อย 32 ตัวอักษร
   ตัวอย่างสำหรับทดสอบ:
   l-xEcc9-rWu1REfPOd4H48a9Sho92Tifo99XkWZKLmDSJ1QMqc_5K2A4Pc5jSLsL
8) Deploy
9) เปิด URL *.workers.dev จากมือถือแล้วทดสอบล็อกอิน

หมายเหตุ:
- ถ้าขึ้น timeout / 401 / 403 ทั้งที่ v8 บน POS ใช้งานได้ แปลว่า API ร้านอาจไม่ยอมรับ cloud/terminal อื่น
- เวอร์ชันนี้ไม่พยายามข้ามข้อจำกัดสิทธิ์ของระบบร้าน
- QR ตอนนี้เรียก quickchart.io หลังจาก lookup สำเร็จ; ถ้าจะใช้ production จริง ควรเปลี่ยนเป็นสร้าง QR ใน Worker เองเพื่อไม่ส่งเลขสมาชิกไปบริการภายนอก
