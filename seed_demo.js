const mysql = require('./node_modules/mysql2/promise');

async function seedDemoBook() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'ebook_store'
        });

        // Check if "สุดทาง... หัวใจ" exists
        const [rows] = await connection.query('SELECT id FROM books WHERE title LIKE ?', ['%สุดทาง... หัวใจ%']);
        if (rows.length === 0) {
            await connection.query(`
                INSERT INTO books (
                    title, author_id, description, price, cover_image_url, file_path, category,
                    author_name, publisher, sample_file_path, file_type, pages_count, original_price, badge
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                'สุดทาง... หัวใจ',
                1,
                "เพราะอุบัติเหตุที่ไม่น่าจะเกิดขึ้นทำให้ 'ไอยรา สิงหเมธา' ไปหาเรื่องผิดคน! หากรู้สักนิดว่า 'กันต์ เด กัสโตร' ประธานบริษัทเชื้อสายละตินจะเป็นพวกเจ้าคิดเจ้าแค้นกัดไม่ปล่อยถึงขนาดนี้ เขาคงยอมกลืนศักดิ์ศรีโบกมือลาทางใครทางมันตั้งแต่นั้นแล้ว\nเมื่อคนหนึ่งก็ 'ร้าย' อีกฝ่ายหนึ่งก็ 'แรง' เหมือนไฟกับน้ำมันที่ปะทุผสมกันก็พร้อมจะเผาผลาญทุกอย่างจนวอดวาย ไอยราตกอยู่ในเกมเดิมพันอันตรายที่ต่อให้ชนะ ก็รู้สึกราวกับพ่ายแพ้ เพราะอีกฝ่ายไม่มีแม้แต่ 'หัวใจ' มาแลก!\n...แต่ไม่ 'รัก' ก็จะไม่ต้อง 'สูญเสีย' ทว่าการได้พบกับสถาปนิกตัวแสบคนนั้น กลับทำให้เจ้าพ่อวงการสีเทาไม่สามารถควบคุมทุกอย่างเอาไว้ได้อีก กันต์ เด กัสโตร จำต้องต่อสู้กับความหวาดกลัวที่ฝังรากลึกอยู่ในจิตใจเพื่อเปิดรับใครบางคนเข้ามาเคียงข้างในชีวิต\nไม่อาจรู้ว่าพวกเขาก้าวเดินไปด้วยกันได้ไกลสักแค่ไหน แต่ 'สุดปลายทางหัวใจ' ตรงนั้น",
                279.00,
                'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80',
                '/uploads/sample-full-book.pdf',
                'สมุดระบายสี',
                'Bacteria',
                'Nabu Publishing',
                '/uploads/sample-preview.pdf',
                'pdf, epub',
                '273 หน้า (~ 92,664 คำ)',
                299.00,
                'Movie'
            ]);
            console.log('Successfully seeded demo book: สุดทาง... หัวใจ!');
        } else {
            console.log('Demo book already exists with ID:', rows[0].id);
        }

        await connection.end();
    } catch (err) {
        console.error('Seed error:', err.message);
    }
}

seedDemoBook();
