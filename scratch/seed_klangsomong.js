require('dotenv').config();
const mysql = require('mysql2/promise');

const sampleBooks = [
    {
        title: "เล่ม 1 : ไดโนเสาร์แสนสนุก",
        category: "สมุดระบายสีเด็ก",
        price: 159.00,
        original_price: 199.00,
        pages_count: "ประหยัด 20 หน้า",
        author_name: "คลังสมอง",
        publisher: "คลังสมอง KLANGSAMONG",
        badge: "ยอดนิยม",
        cover_image_url: "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=400&auto=format&fit=crop",
        description: "สมุดระบายสีเสริมสร้างจินตนาการ ลายเส้นคมชัด ระบายง่าย สำหรับเด็กอนุบาล - ประถม"
    },
    {
        title: "เล่ม 2 : สัตว์แสนรักน่ารู้",
        category: "สมุดระบายสีเด็ก",
        price: 159.00,
        original_price: 199.00,
        pages_count: "ประหยัด 20 หน้า",
        author_name: "คลังสมอง",
        publisher: "คลังสมอง KLANGSAMONG",
        badge: "ขายดี",
        cover_image_url: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop",
        description: "เรียนรู้ชื่อสัตว์นานาชนิด พร้อมระบายสีภาพสัตว์น่ารัก"
    },
    {
        title: "เล่ม 3 : โลกใต้ทะเลมหัศจรรย์",
        category: "สมุดระบายสีเด็ก",
        price: 159.00,
        original_price: 199.00,
        pages_count: "ประหยัด 20 หน้า",
        author_name: "คลังสมอง",
        publisher: "คลังสมอง KLANGSAMONG",
        badge: "แนะนำ",
        cover_image_url: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=400&auto=format&fit=crop",
        description: "ผจญภัยใต้ท้องทะเลลึกไปกับฝูงปลาและสิ่งมีชีวิตในทะเล"
    },
    {
        title: "เล่ม 4 : ยานพาหนะรอบตัว",
        category: "สมุดระบายสีเด็ก",
        price: 159.00,
        original_price: 199.00,
        pages_count: "ประหยัด 20 หน้า",
        author_name: "คลังสมอง",
        publisher: "คลังสมอง KLANGSAMONG",
        badge: "ฮิตมาก",
        cover_image_url: "https://images.unsplash.com/photo-1519003722824-194d4455a60c?w=400&auto=format&fit=crop",
        description: "ระบายสีรถยนต์ เครื่องบิน เรือ และรถไฟ เรียนรู้ประเภทการเดินทาง"
    },
    {
        title: "เล่ม 5 : เจ้าหญิงและปราสาทในเทพนิยาย",
        category: "สมุดระบายสีเด็ก",
        price: 159.00,
        original_price: 199.00,
        pages_count: "ประหยัด 20 หน้า",
        author_name: "คลังสมอง",
        publisher: "คลังสมอง KLANGSAMONG",
        badge: "น่ารัก",
        cover_image_url: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop",
        description: "สมุดระบายสีชุดเจ้าหญิงแสนสวยและปราสาทเวทมนตร์"
    },
    {
        title: "คณิตศาสตร์ ป.1 - การบวกและลบ",
        category: "คณิตศาสตร์",
        price: 199.00,
        original_price: 250.00,
        pages_count: "35 หน้า",
        author_name: "ทีมงานคลังสมอง",
        publisher: "คลังสมอง KLANGSAMONG",
        badge: "พื้นฐานแน่น",
        cover_image_url: "https://images.unsplash.com/photo-1509228468518-180dd4864904?w=400&auto=format&fit=crop",
        description: "แบบฝึกหัดคณิตศาสตร์อนุบาล - ป.1 ปลูกฝังทักษะการคำนวณเบื้องต้น"
    },
    {
        title: "คณิตศาสตร์ ป.2 - การคูณเบื้องต้น",
        category: "คณิตศาสตร์",
        price: 199.00,
        original_price: 250.00,
        pages_count: "40 หน้า",
        author_name: "ทีมงานคลังสมอง",
        publisher: "คลังสมอง KLANGSAMONG",
        badge: "สอบผ่านชัวร์",
        cover_image_url: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=400&auto=format&fit=crop",
        description: "แบบฝึกหัดคณิตศาสตร์ ป.2 ทบทวนสูตรคูณและแบบฝึกหัดคิดเลขเร็ว"
    },
    {
        title: "แฟลชการ์ด 2 ภาษา - ก-ฮ และ ABC",
        category: "แฟลชการ์ด",
        price: 159.00,
        original_price: 199.00,
        pages_count: "44 การ์ด",
        author_name: "คลังสมอง",
        publisher: "คลังสมอง KLANGSAMONG",
        badge: "2 ภาษา",
        cover_image_url: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&auto=format&fit=crop",
        description: "แฟลชการ์ดคำศัพท์ไทย-อังกฤษ สำหรับปูพื้นฐานเด็กเล็ก"
    }
];

async function seedKlangsomong() {
    try {
        let dbUrl = process.env.DATABASE_URL.trim().split('?')[0];
        console.log('Connecting to Aiven MySQL...');
        const connection = await mysql.createConnection({
            uri: dbUrl,
            ssl: { rejectUnauthorized: false }
        });

        console.log('Ensuring books table exists...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS books (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                author_id INT DEFAULT 1,
                description TEXT,
                price DECIMAL(10, 2) NOT NULL,
                cover_image_url LONGTEXT,
                file_path LONGTEXT,
                category VARCHAR(255) DEFAULT 'สมุดระบายสีเด็ก',
                author_name VARCHAR(255) DEFAULT 'คลังสมอง',
                publisher VARCHAR(255) DEFAULT 'คลังสมอง KLANGSOMONG',
                sample_file_path LONGTEXT,
                file_type VARCHAR(100) DEFAULT 'PDF',
                pages_count VARCHAR(100) DEFAULT '20 หน้า',
                original_price DECIMAL(10, 2) DEFAULT NULL,
                badge VARCHAR(100) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        for (const book of sampleBooks) {
            const [existing] = await connection.query('SELECT id FROM books WHERE title = ?', [book.title]);
            if (existing.length === 0) {
                await connection.query(
                    `INSERT INTO books (title, category, price, original_price, pages_count, author_name, publisher, badge, cover_image_url, description) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [book.title, book.category, book.price, book.original_price, book.pages_count, book.author_name, book.publisher, book.badge, book.cover_image_url, book.description]
                );
                console.log(`Added: ${book.title}`);
            } else {
                console.log(`Already exists: ${book.title}`);
            }
        }

        await connection.end();
        console.log('Seeding completed successfully!');
    } catch (err) {
        console.error('Seeding error:', err.message);
    }
}

seedKlangsomong();
