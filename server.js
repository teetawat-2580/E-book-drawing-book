require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const session = require('express-session');

const app = express();

// Session configuration
app.use(session({
    secret: 'ebook-marketplace-secret-key-12345',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Categories definition matching screenshot
const CATEGORIES = [
    { id: 'all', name: 'ทั้งหมด', icon: '🌐' },
    { id: 'สมุดระบายสี', name: 'สมุดระบายสี', icon: '✏️' },
    { id: 'รับทำรูปโปรไฟล์', name: 'รับทำรูปโปรไฟล์', icon: '📷' },
    { id: 'ชีทฝึกเขียน', name: 'ชีทฝึกเขียน', icon: '✏️' },
    { id: 'ฉากไลฟ์สด', name: 'ฉากไลฟ์สด', icon: '🎬' },
    { id: 'แฟลชการ์ด 2 ภาษา', name: 'แฟลชการ์ด 2 ภาษา', icon: '🎴' },
    { id: 'เกมฝึกสมองเด็ก', name: 'เกมฝึกสมองเด็ก', icon: '🧩' },
    { id: 'รูปชุดข้าราชการ', name: 'รูปชุดข้าราชการ', icon: '🏛️' },
    { id: 'สื่อครูตกแต่งห้องเรียน', name: 'สื่อครูตกแต่งห้องเรียน', icon: '🏫' },
    { id: 'ชีทคณิตอนุบาล ป.1', name: 'ชีทคณิตอนุบาล ป.1', icon: '🔢' },
    { id: 'นิทานเด็ก AI', name: 'นิทานเด็ก AI', icon: '📚' }
];

// Set EJS as templating engine and set explicit views directory for Vercel Serverless
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Pass session user & categories to all views
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    res.locals.categories = CATEGORIES;
    next();
});

// Configure Multer Storage for PDFs and Covers into separated subdirectories
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let subFolder = 'covers';
        if (file.fieldname === 'book_file') {
            subFolder = 'books';
        } else if (file.fieldname === 'sample_file') {
            subFolder = 'samples';
        }
        const uploadDir = path.join(__dirname, 'public/uploads', subFolder);
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// MySQL Database Connection Pool - Supporting process.env.DATABASE_URL (Aiven MySQL) & Local MySQL
let pool;
if (process.env.DATABASE_URL) {
    console.log("Connecting to Cloud Database using process.env.DATABASE_URL...");
    
    // Clean up query parameters like ?ssl-mode=REQUIRED which mysql2 does not recognize
    let cleanDbUrl = process.env.DATABASE_URL.trim().split('?')[0];

    pool = mysql.createPool({
        uri: cleanDbUrl,
        ssl: { rejectUnauthorized: false }, // Required for Aiven MySQL SSL connections
        waitForConnections: true,
        connectionLimit: 10,
        connectTimeout: 10000,
        queueLimit: 0
    });
} else {
    pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ebook_store',
        port: process.env.DB_PORT || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
}

// Initialize database table & column verification
async function initDb() {
    try {
        const connection = await pool.getConnection();
        
        // Ensure books table exists
        await connection.query(`
            CREATE TABLE IF NOT EXISTS books (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                author_id INT DEFAULT 1,
                description TEXT,
                price DECIMAL(10, 2) NOT NULL,
                cover_image_url VARCHAR(255),
                file_path VARCHAR(255),
                category VARCHAR(255) DEFAULT 'สมุดระบายสี',
                author_name VARCHAR(255) DEFAULT '',
                publisher VARCHAR(255) DEFAULT '',
                sample_file_path VARCHAR(255) DEFAULT '',
                file_type VARCHAR(100) DEFAULT 'pdf',
                pages_count VARCHAR(100) DEFAULT '',
                original_price DECIMAL(10, 2) DEFAULT NULL,
                badge VARCHAR(100) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Check & add extra columns dynamically if books table already existed
        const extraColumns = [
            { name: 'category', type: "VARCHAR(255) DEFAULT 'สมุดระบายสี'" },
            { name: 'author_name', type: "VARCHAR(255) DEFAULT ''" },
            { name: 'publisher', type: "VARCHAR(255) DEFAULT ''" },
            { name: 'sample_file_path', type: "VARCHAR(255) DEFAULT ''" },
            { name: 'file_type', type: "VARCHAR(100) DEFAULT 'pdf'" },
            { name: 'pages_count', type: "VARCHAR(100) DEFAULT ''" },
            { name: 'original_price', type: "DECIMAL(10, 2) DEFAULT NULL" },
            { name: 'badge', type: "VARCHAR(100) DEFAULT ''" }
        ];

        for (const col of extraColumns) {
            const [cols] = await connection.query(`SHOW COLUMNS FROM books LIKE '${col.name}'`);
            if (cols.length === 0) {
                await connection.query(`ALTER TABLE books ADD COLUMN ${col.name} ${col.type}`);
                console.log(`Added '${col.name}' column to 'books' table.`);
            }
        }

        connection.release();
        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Database initialization error:", err.message);
    }
}
initDb();

// Preconfigured accounts
const USERS = {
    user: { password: 'user123', role: 'user', name: 'User' },
    admin: { password: 'admin123', role: 'admin', name: 'Administrator' }
};

// Middleware: Admin Protection
function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    return res.status(403).send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h2 style="color: #e74c3c;">Access Denied (เฉพาะผู้ดูแลระบบเท่านั้น)</h2>
            <p>กรุณาเข้าสู่ระบบด้วยสิทธิ์ Adminเพื่อเข้าถึงหน้านี้</p>
            <a href="/" style="color: #00b140; text-decoration: none; font-weight: bold;">← กลับหน้าแรก</a>
        </div>
    `);
}

// 1. Homepage Route: Display books by Category or Search
app.get('/', async (req, res) => {
    try {
        const selectedCategory = req.query.category || 'all';
        const searchQuery = req.query.q || '';
        
        let sql = 'SELECT * FROM books WHERE 1=1';
        const params = [];

        if (selectedCategory !== 'all') {
            sql += ' AND category = ?';
            params.push(selectedCategory);
        }

        if (searchQuery) {
            sql += ' AND (title LIKE ? OR description LIKE ?)';
            params.push(`%${searchQuery}%`, `%${searchQuery}%`);
        }

        sql += ' ORDER BY id DESC';

        const [books] = await pool.query(sql, params);
        
        res.render('index', { 
            books, 
            selectedCategory, 
            searchQuery,
            loginError: req.query.loginError || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database connection error: ' + err.message);
    }
});

// Auth: Login Route
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const account = USERS[username];

    if (account && account.password === password) {
        req.session.user = {
            username: username,
            name: account.name,
            role: account.role
        };
        return res.redirect('back');
    } else {
        return res.redirect('/?loginError=1');
    }
});

// Auth: Logout Route
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// 1.1 Book Detail Sub-Page Route (Navigated to when clicking อ่าน/ดาวน์โหลด or book item)
app.get('/book/:id', async (req, res) => {
    try {
        const bookId = req.params.id;
        const [books] = await pool.query('SELECT * FROM books WHERE id = ?', [bookId]);

        if (books.length === 0) {
            return res.status(404).send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                    <h2>ไม่พบหนังสือที่ต้องการ (Book Not Found)</h2>
                    <a href="/" style="color:#00b140;">← กลับหน้าหลัก</a>
                </div>
            `);
        }

        res.render('book-detail', { book: books[0] });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error: ' + err.message);
    }
});

// 2. Admin Route: Book Management Page
app.get('/admin/manage', requireAdmin, async (req, res) => {
    try {
        const [books] = await pool.query('SELECT * FROM books ORDER BY id DESC');
        res.render('admin-manage', { books });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error: ' + err.message);
    }
});

// 3. Admin Route: Show Upload Form
app.get('/admin/upload', requireAdmin, (req, res) => {
    res.render('admin-upload');
});

// 4. Admin Route: Handle Book Upload Submission
app.post('/admin/upload', requireAdmin, upload.fields([
    { name: 'cover_image', maxCount: 1 },
    { name: 'book_file', maxCount: 1 },
    { name: 'sample_file', maxCount: 1 }
]), async (req, res) => {
    try {
        const { 
            title, description, price, author_id, category, 
            author_name, publisher, file_type, pages_count, original_price, badge 
        } = req.body;

        const coverImageFile = req.files['cover_image'] ? `/uploads/covers/${req.files['cover_image'][0].filename}` : '';
        const bookFile = req.files['book_file'] ? `/uploads/books/${req.files['book_file'][0].filename}` : '';
        const sampleFile = req.files['sample_file'] ? `/uploads/samples/${req.files['sample_file'][0].filename}` : '';

        const query = `
            INSERT INTO books (
                title, author_id, description, price, cover_image_url, file_path, category,
                author_name, publisher, sample_file_path, file_type, pages_count, original_price, badge
            ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await pool.query(query, [
            title, 
            author_id || 1, 
            description || '', 
            price || 0, 
            coverImageFile, 
            bookFile, 
            category || 'สมุดระบายสี',
            author_name || '',
            publisher || '',
            sampleFile,
            file_type || 'pdf',
            pages_count || '',
            original_price ? parseFloat(original_price) : null,
            badge || ''
        ]);

        res.redirect('/admin/manage');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error uploading book: ' + err.message);
    }
});

// 5. Admin Route: Show Batch Upload / Batch Edit Page
app.get('/admin/batch', requireAdmin, async (req, res) => {
    try {
        const [books] = await pool.query('SELECT * FROM books ORDER BY id DESC');
        res.render('admin-batch', { 
            books, 
            successMessage: req.query.success || null, 
            errorMessage: req.query.error || null 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error: ' + err.message);
    }
});

// 5.1 Admin Route: Process Batch JSON / Array Upload
app.post('/admin/batch-json', requireAdmin, async (req, res) => {
    try {
        let booksData = [];
        if (typeof req.body.json_data === 'string') {
            booksData = JSON.parse(req.body.json_data);
        } else if (Array.isArray(req.body.books)) {
            booksData = req.body.books;
        }

        if (!Array.isArray(booksData) || booksData.length === 0) {
            return res.redirect('/admin/batch?error=' + encodeURIComponent('ข้อมูลต้องเป็น JSON Array ที่ไม่ว่างเปล่า'));
        }

        const query = `
            INSERT INTO books (
                title, author_id, description, price, cover_image_url, file_path, category,
                author_name, publisher, sample_file_path, file_type, pages_count, original_price, badge
            ) VALUES ?
        `;

        const values = booksData.map(b => [
            b.title || 'Untitled',
            b.author_id || 1,
            b.description || '',
            b.price || 0,
            b.cover_image_url || '',
            b.file_path || '',
            b.category || 'สมุดระบายสี',
            b.author_name || '',
            b.publisher || '',
            b.sample_file_path || '',
            b.file_type || 'pdf',
            b.pages_count || '',
            b.original_price ? parseFloat(b.original_price) : null,
            b.badge || ''
        ]);

        await pool.query(query, [values]);
        res.redirect('/admin/batch?success=' + encodeURIComponent(`นำเข้าหนังสือสำเร็จทั้งหมด ${booksData.length} รายการ`));
    } catch (err) {
        console.error(err);
        res.redirect('/admin/batch?error=' + encodeURIComponent('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message));
    }
});

// 5.2 Admin Route: Process Batch SQL Execution
app.post('/admin/batch-sql', requireAdmin, async (req, res) => {
    try {
        const sqlQuery = req.body.sql_query;
        if (!sqlQuery || !sqlQuery.trim()) {
            return res.redirect('/admin/batch?error=' + encodeURIComponent('กรุณากรอก คำสั่ง SQL'));
        }

        // Execute batch SQL statements
        await pool.query(sqlQuery);
        res.redirect('/admin/batch?success=' + encodeURIComponent('รันคำสั่ง SQL สำหรับ Batch Import สำเร็จแล้ว!'));
    } catch (err) {
        console.error(err);
        res.redirect('/admin/batch?error=' + encodeURIComponent('SQL Error: ' + err.message));
    }
});

// 5.3 Admin Route: Process Interactive Table Batch Edit / Update
app.post('/admin/batch-update', requireAdmin, async (req, res) => {
    try {
        let booksData = [];
        if (typeof req.body.json_data === 'string') {
            booksData = JSON.parse(req.body.json_data);
        }

        if (!Array.isArray(booksData)) {
            return res.redirect('/admin/batch?error=' + encodeURIComponent('ข้อมูลไม่ถูกต้อง'));
        }

        let updatedCount = 0;
        let insertedCount = 0;

        for (const b of booksData) {
            if (b.id) {
                // Update existing record
                const updateQuery = `
                    UPDATE books SET 
                        title = ?, author_name = ?, publisher = ?, category = ?, 
                        price = ?, original_price = ?, pages_count = ?, file_type = ?, 
                        badge = ?, description = ?, cover_image_url = ?, file_path = ?, sample_file_path = ?
                    WHERE id = ?
                `;
                await pool.query(updateQuery, [
                    b.title || 'Untitled',
                    b.author_name || '',
                    b.publisher || '',
                    b.category || 'สมุดระบายสี',
                    parseFloat(b.price) || 0,
                    b.original_price ? parseFloat(b.original_price) : null,
                    b.pages_count || '',
                    b.file_type || 'pdf',
                    b.badge || '',
                    b.description || '',
                    b.cover_image_url || '',
                    b.file_path || '',
                    b.sample_file_path || '',
                    b.id
                ]);
                updatedCount++;
            } else if (b.title && b.title.trim()) {
                // Insert new record
                const insertQuery = `
                    INSERT INTO books (
                        title, author_id, description, price, cover_image_url, file_path, category,
                        author_name, publisher, sample_file_path, file_type, pages_count, original_price, badge
                    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                await pool.query(insertQuery, [
                    b.title || 'Untitled',
                    b.description || '',
                    parseFloat(b.price) || 0,
                    b.cover_image_url || '',
                    b.file_path || '',
                    b.category || 'สมุดระบายสี',
                    b.author_name || '',
                    b.publisher || '',
                    b.sample_file_path || '',
                    b.file_type || 'pdf',
                    b.pages_count || '',
                    b.original_price ? parseFloat(b.original_price) : null,
                    b.badge || ''
                ]);
                insertedCount++;
            }
        }

        res.redirect('/admin/batch?success=' + encodeURIComponent(`บันทึก Batch Edit สำเร็จ! (อัปเดต ${updatedCount} รายการ, เพิ่มใหม่ ${insertedCount} รายการ)`));
    } catch (err) {
        console.error(err);
        res.redirect('/admin/batch?error=' + encodeURIComponent('เกิดข้อผิดพลาดในการบันทึก Batch Edit: ' + err.message));
    }
});

// 6. Admin Route: Delete Book
app.post('/admin/delete-book/:id', requireAdmin, async (req, res) => {
    try {
        const bookId = req.params.id;

        // Fetch book files to remove from disk
        const [books] = await pool.query('SELECT cover_image_url, file_path, sample_file_path FROM books WHERE id = ?', [bookId]);
        if (books.length > 0) {
            const book = books[0];
            const filesToDelete = [book.cover_image_url, book.file_path, book.sample_file_path];
            filesToDelete.forEach(filePath => {
                if (filePath) {
                    const fullPath = path.join(__dirname, 'public', filePath);
                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath);
                    }
                }
            });
        }

        // Delete from database
        await pool.query('DELETE FROM books WHERE id = ?', [bookId]);

        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error deleting book: ' + err.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`E-book marketplace server running on port ${PORT}`);
});

module.exports = app;