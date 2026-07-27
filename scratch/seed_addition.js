require('dotenv').config();
const mysql = require('mysql2/promise');

const additionBooks = [
    {
        title: "เล่ม 1 : แบบฝึกหัดพื้นฐานการบวกเลข 1-10 (สำหรับเด็กอนุบาล)",
        category: "พื้นฐานการบวกเลข",
        price: 159.00,
        original_price: 199.00,
        pages_count: "20 หน้า",
        author_name: "คลังสมอง",
        publisher: "คลังสมอง KLANGSAMONG",
        badge: "แนะนำ",
        cover_image_url: "https://images.unsplash.com/photo-1509228468518-180dd4864904?w=400&auto=format&fit=crop",
        description: "แบบฝึกหัดพื้นฐานการบวกเลข 1 ถึง 10 เน้นการนับภาพและเติมตัวเลข เสริมสร้างทักษะคณิตศาสตร์เบื้องต้นอย่างสนุกสนาน"
    },
    {
        title: "เล่ม 2 : พื้นฐานการบวกเลข 1-20 พร้อมภาพประกอบน่ารัก",
        category: "พื้นฐานการบวกเลข",
        price: 159.00,
        original_price: 199.00,
        pages_count: "25 หน้า",
        author_name: "คลังสมอง",
        publisher: "คลังสมอง KLANGSAMONG",
        badge: "ยอดนิยม",
        cover_image_url: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=400&auto=format&fit=crop",
        description: "ตะลุยโจทย์บวกเลข 1 ถึง 20 ฝึกการทดเลขเบื้องต้น สนุกเข้าใจง่าย ใช้ได้ทั้งในห้องเรียนและฝึกที่บ้าน"
    }
];

(async () => {
    try {
        let dbUrl = process.env.DATABASE_URL;
        if (!dbUrl) {
            console.log('No DATABASE_URL found');
            return;
        }
        const cleanUrl = dbUrl.replace(/\?ssl-mode=REQUIRED/gi, '');
        const pool = mysql.createPool({
            uri: cleanUrl,
            ssl: { rejectUnauthorized: false }
        });

        for (const b of additionBooks) {
            await pool.query(`
                INSERT INTO books (title, category, price, original_price, pages_count, author_name, publisher, badge, cover_image_url, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [b.title, b.category, b.price, b.original_price, b.pages_count, b.author_name, b.publisher, b.badge, b.cover_image_url, b.description]);
        }

        console.log('Successfully seeded 2 books for category พื้นฐานการบวกเลข!');
        process.exit(0);
    } catch(e) {
        console.error('Error seeding addition books:', e.message);
        process.exit(1);
    }
})();
