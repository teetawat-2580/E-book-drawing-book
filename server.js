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

// Educational Categories definition for คลังสมอง KLANGSAMONG
const CATEGORIES = [
    { id: 'all', name: 'ทั้งหมด', icon: '🌐', slug: 'ทั้งหมด' },
    { id: 'สมุดระบายสีเด็ก', name: 'สมุดระบายสีเด็ก', icon: '✏️', slug: 'สมุดระบายสีเด็ก' },
    { id: 'คณิตศาสตร์', name: 'ชีทคณิตศาสตร์', icon: '🔢', slug: 'ชีทคณิตศาสตร์' },
    { id: 'พื้นฐานการบวกเลข', name: 'พื้นฐานการบวกเลข', icon: '➕', slug: 'พื้นฐานการบวกเลข' },
    { id: 'ชีทฝึกเขียน', name: 'ชีทฝึกเขียนภาษา', icon: '✍️', slug: 'ชีทฝึกเขียนภาษา' },
    { id: 'แฟลชการ์ด', name: 'แฟลชการ์ด 2 ภาษา', icon: '🎴', slug: 'แฟลชการ์ด-2-ภาษา' },
    { id: 'เกมฝึกสมอง', name: 'เกมฝึกสมองเด็ก', icon: '🧩', slug: 'เกมฝึกสมองเด็ก' },
    { id: 'นิทานเด็ก AI', name: 'นิทานและแบบเรียน', icon: '📚', slug: 'นิทานและแบบเรียน' },
    { id: 'สื่อครูตกแต่ง', name: 'สื่อครูตกแต่งห้องเรียน', icon: '🏫', slug: 'สื่อครูตกแต่งห้องเรียน' }
];

// Set EJS as templating engine and set explicit views directory for Vercel Serverless
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Pass session user & categories to all views
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    res.locals.categories = CATEGORIES;
    next();
});

// Require @vercel/blob if available
let vercelBlob = null;
try {
    vercelBlob = require('@vercel/blob');
} catch (e) {
    vercelBlob = null;
}

// MemoryStorage prevents Multer from attempting to write directly to read-only serverless filesystems (/var/task)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Helper function to resolve file URL (Vercel Blob / Safe Local Disk / Base64 Data URI)
async function resolveFileUrl(reqFile, subFolder) {
    if (!reqFile || !reqFile.buffer) return '';
    
    // 1. If Vercel Blob Token is set, upload file directly to Vercel Blob Storage
    if (process.env.BLOB_READ_WRITE_TOKEN && vercelBlob) {
        try {
            const cleanName = reqFile.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
            const blob = await vercelBlob.put(`${subFolder}/${Date.now()}-${cleanName}`, reqFile.buffer, {
                access: 'public'
            });
            console.log(`Uploaded ${reqFile.originalname} to Vercel Blob: ${blob.url}`);
            return blob.url;
        } catch (err) {
            console.error("Vercel Blob upload failed, falling back:", err.message);
        }
    }

    // 2. If running locally, attempt to save buffer to local disk safely wrapped in try...catch
    const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
    if (!isVercel) {
        try {
            const uploadDir = path.join(__dirname, 'public/uploads', subFolder);
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(reqFile.originalname)}`;
            const targetPath = path.join(uploadDir, filename);
            fs.writeFileSync(targetPath, reqFile.buffer);
            return `/uploads/${subFolder}/${filename}`;
        } catch (err) {
            console.log("Local disk save notice, falling back to Data URI:", err.message);
        }
    }

    // 3. Fallback to Data URI (100% safe for read-only serverless environments)
    return `data:${reqFile.mimetype};base64,${reqFile.buffer.toString('base64')}`;
}

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
        
        // Ensure books table exists with LONGTEXT columns for Base64 Data URIs
        await connection.query(`
            CREATE TABLE IF NOT EXISTS books (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                author_id INT DEFAULT 1,
                description TEXT,
                price DECIMAL(10, 2) NOT NULL,
                cover_image_url LONGTEXT,
                file_path LONGTEXT,
                category VARCHAR(255) DEFAULT 'สมุดระบายสี',
                author_name VARCHAR(255) DEFAULT '',
                publisher VARCHAR(255) DEFAULT '',
                sample_file_path LONGTEXT,
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

        // Modify image and file path columns to LONGTEXT so Base64 Data URIs fit without truncation
        try {
            await connection.query(`ALTER TABLE books MODIFY COLUMN cover_image_url LONGTEXT`);
            await connection.query(`ALTER TABLE books MODIFY COLUMN file_path LONGTEXT`);
            await connection.query(`ALTER TABLE books MODIFY COLUMN sample_file_path LONGTEXT`);
        } catch (colErr) {
            console.log("Column type check notice:", colErr.message);
        }
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

// 1. Homepage Route: Display books by Category or Search (Admin Access Required)
app.get('/', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') {
            return res.render('index', { 
                books: [], 
                selectedCategory: 'all', 
                searchQuery: '',
                loginError: req.query.loginError || null,
                adminGateRequired: true
            });
        }

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
            loginError: req.query.loginError || null,
            adminGateRequired: false
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

// 1.1 Book Detail Sub-Page Route (Admin Only)
app.get('/book/:id', requireAdmin, async (req, res) => {
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

// Memory map to hold chunk buffers during upload (for files > 4.5MB)
const chunkStore = new Map();

// Chunked Upload Endpoint (Splits large files into 2MB chunks to bypass Vercel 4.5MB payload limit)
app.post('/api/upload-chunk', requireAdmin, async (req, res) => {
    try {
        const { uploadId, chunkIndex, totalChunks, filename, subFolder, mimeType, chunkData } = req.body;

        if (!uploadId || chunkData === undefined) {
            return res.status(400).json({ success: false, message: 'Invalid chunk payload' });
        }

        if (!chunkStore.has(uploadId)) {
            chunkStore.set(uploadId, {
                chunks: new Array(totalChunks),
                count: 0,
                filename: filename || 'file.pdf',
                subFolder: subFolder || 'books',
                mimeType: mimeType || 'application/pdf'
            });
        }

        const session = chunkStore.get(uploadId);
        const buffer = Buffer.from(chunkData, 'base64');
        session.chunks[chunkIndex] = buffer;
        session.count++;

        // When all chunks are received, concatenate buffers & resolve URL
        if (session.count === totalChunks) {
            const fullBuffer = Buffer.concat(session.chunks);
            chunkStore.delete(uploadId);

            const fileUrl = await resolveFileUrl({
                originalname: session.filename,
                buffer: fullBuffer,
                mimetype: session.mimeType
            }, session.subFolder);

            return res.json({ success: true, file_url: fileUrl });
        }

        return res.json({ success: true, progress: Math.round((session.count / totalChunks) * 100) });
    } catch (err) {
        console.error('Chunk upload error:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Client-side Direct Vercel Blob Upload Token Endpoint (Bypasses Vercel 4.5MB Serverless Limit!)
app.post('/api/upload/handle-client-upload', async (req, res) => {
    try {
        const { handleUpload } = require('@vercel/blob/client');
        const jsonResponse = await handleUpload({
            body: req.body,
            request: req,
            onBeforeGenerateToken: async (pathname, clientPayload) => {
                if (!req.session.user || req.session.user.role !== 'admin') {
                    throw new Error('Unauthorized Admin Access Required');
                }
                return {
                    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
                    maximumSizeInBytes: 500 * 1024 * 1024 // 500MB max payload limit
                };
            },
            onUploadCompleted: async ({ blob, tokenPayload }) => {
                console.log('Client direct upload completed:', blob.url);
            }
        });
        return res.json(jsonResponse);
    } catch (error) {
        console.error('Blob upload error:', error);
        return res.status(400).json({ error: error.message });
    }
});

// Admin Route: Direct Book Add (with pre-uploaded client URLs)
app.post('/admin/upload-direct', requireAdmin, async (req, res) => {
    try {
        const { 
            title, description, price, author_id, category, 
            author_name, publisher, file_type, pages_count, original_price, badge,
            cover_image_url, file_path, sample_file_path
        } = req.body;

        const query = `
            INSERT INTO books (
                title, author_id, description, price, cover_image_url, file_path, category,
                author_name, publisher, sample_file_path, file_type, pages_count, original_price, badge
            ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await pool.query(query, [
            title || 'Untitled', 
            author_id || 1, 
            description || '', 
            price || 0, 
            cover_image_url || '', 
            file_path || '', 
            category || 'สมุดระบายสีเด็ก',
            author_name || 'คลังสมอง',
            publisher || 'คลังสมอง KLANGSAMONG',
            sample_file_path || '',
            file_type || 'PDF',
            pages_count || '',
            original_price ? parseFloat(original_price) : null,
            badge || ''
        ]);

        if (req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json')) {
            return res.json({ success: true, redirect: '/admin/manage' });
        }
        res.redirect('/admin/manage');
    } catch (err) {
        console.error(err);
        if (req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json')) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.status(500).send('Error adding book: ' + err.message);
    }
});

// Admin Route: Direct Book Edit (with pre-uploaded client URLs)
app.post(['/admin/edit-book-direct/:id', '/admin/edit-book/:id'], requireAdmin, async (req, res) => {
    try {
        const bookId = req.params.id;
        const { 
            title, description, price, category, 
            author_name, publisher, file_type, pages_count, original_price, badge,
            cover_image_url, file_path, sample_file_path
        } = req.body;

        const [existing] = await pool.query('SELECT * FROM books WHERE id = ?', [bookId]);
        if (existing.length === 0) {
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(404).json({ success: false, message: 'Book not found' });
            }
            return res.status(404).send('Book not found');
        }
        const currentBook = existing[0];

        const query = `
            UPDATE books SET 
                title = ?, description = ?, price = ?, cover_image_url = ?, file_path = ?, 
                category = ?, author_name = ?, publisher = ?, sample_file_path = ?, 
                file_type = ?, pages_count = ?, original_price = ?, badge = ?
            WHERE id = ?
        `;
        await pool.query(query, [
            title || currentBook.title,
            description !== undefined ? description : currentBook.description,
            price !== undefined ? price : currentBook.price,
            cover_image_url !== undefined && cover_image_url !== '' ? cover_image_url : currentBook.cover_image_url,
            file_path !== undefined && file_path !== '' ? file_path : currentBook.file_path,
            category || currentBook.category,
            author_name !== undefined ? author_name : currentBook.author_name,
            publisher !== undefined ? publisher : currentBook.publisher,
            sample_file_path !== undefined && sample_file_path !== '' ? sample_file_path : currentBook.sample_file_path,
            file_type || currentBook.file_type,
            pages_count !== undefined ? pages_count : currentBook.pages_count,
            original_price ? parseFloat(original_price) : currentBook.original_price,
            badge !== undefined ? badge : currentBook.badge,
            bookId
        ]);

        if (req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json')) {
            return res.json({ success: true, redirect: '/admin/manage' });
        }
        res.redirect('/admin/manage');
    } catch (err) {
        console.error(err);
        if (req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json')) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.status(500).send('Error updating book: ' + err.message);
    }
});

// 4. Admin Route: Handle Book Upload Submission (Multipart Fallback)
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

        const coverImageFile = req.files['cover_image'] ? await resolveFileUrl(req.files['cover_image'][0], 'covers') : '';
        const bookFile = req.files['book_file'] ? await resolveFileUrl(req.files['book_file'][0], 'books') : '';
        const sampleFile = req.files['sample_file'] ? await resolveFileUrl(req.files['sample_file'][0], 'samples') : '';

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

// 5.2 Admin Route: Process Interactive Table Batch Updates (Chunked compliant)
app.post('/admin/batch-update', requireAdmin, async (req, res) => {
    try {
        let booksData = [];
        if (typeof req.body.json_data === 'string') {
            booksData = JSON.parse(req.body.json_data);
        } else if (Array.isArray(req.body.books)) {
            booksData = req.body.books;
        }

        if (!Array.isArray(booksData) || booksData.length === 0) {
            if (req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json')) {
                return res.status(400).json({ success: false, message: 'ไม่มีข้อมูลรายการที่จะบันทึก' });
            }
            return res.redirect('/admin/batch?error=' + encodeURIComponent('ไม่มีข้อมูลรายการที่จะบันทึก'));
        }

        for (const b of booksData) {
            if (b.id) {
                // Update existing record
                const updateQuery = `
                    UPDATE books SET 
                        title = ?, author_name = ?, publisher = ?, category = ?, price = ?, 
                        original_price = ?, pages_count = ?, file_type = ?, badge = ?, 
                        cover_image_url = ?, file_path = ?, sample_file_path = ?, description = ?
                    WHERE id = ?
                `;
                await pool.query(updateQuery, [
                    b.title || 'Untitled',
                    b.author_name || '',
                    b.publisher || '',
                    b.category || 'สมุดระบายสีเด็ก',
                    b.price || 0,
                    b.original_price ? parseFloat(b.original_price) : null,
                    b.pages_count || '',
                    b.file_type || 'PDF',
                    b.badge || '',
                    b.cover_image_url || '',
                    b.file_path || '',
                    b.sample_file_path || '',
                    b.description || '',
                    b.id
                ]);
            } else {
                // Insert new record
                const insertQuery = `
                    INSERT INTO books (
                        title, author_id, description, price, cover_image_url, file_path, category,
                        author_name, publisher, sample_file_path, file_type, pages_count, original_price, badge
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                await pool.query(insertQuery, [
                    b.title || 'Untitled',
                    1,
                    b.description || '',
                    b.price || 0,
                    b.cover_image_url || '',
                    b.file_path || '',
                    b.category || 'สมุดระบายสีเด็ก',
                    b.author_name || 'คลังสมอง',
                    b.publisher || 'คลังสมอง KLANGSAMONG',
                    b.sample_file_path || '',
                    b.file_type || 'PDF',
                    b.pages_count || '',
                    b.original_price ? parseFloat(b.original_price) : null,
                    b.badge || ''
                ]);
            }
        }

        if (req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json')) {
            return res.json({ success: true, count: booksData.length, redirect: '/admin/batch?success=' + encodeURIComponent(`บันทึกข้อมูล Batch Edit ทั้งหมด ${booksData.length} รายการสำเร็จเรียบร้อย`) });
        }

        res.redirect('/admin/batch?success=' + encodeURIComponent(`บันทึกข้อมูล Batch Edit ทั้งหมด ${booksData.length} รายการสำเร็จเรียบร้อย`));
    } catch (err) {
        console.error('Batch update error:', err);
        if (req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json')) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.redirect('/admin/batch?error=' + encodeURIComponent('เกิดข้อผิดพลาดในการบันทึก Batch: ' + err.message));
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

// 5.4 Admin API Route: AJAX File Upload for Batch Edit & Table File Pickers
app.post('/api/upload-file', requireAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'ไม่มีไฟล์ถูกส่งมา' });
        }
        const subFolder = req.body.subFolder || 'covers';
        const fileUrl = await resolveFileUrl(req.file, subFolder);
        res.json({ success: true, file_url: fileUrl, originalname: req.file.originalname });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Upload error: ' + err.message });
    }
});

// 5.5 Admin Route: Handle Single Book Edit Submission & File Overwriting
app.post('/admin/edit-book/:id', requireAdmin, upload.fields([
    { name: 'cover_image', maxCount: 1 },
    { name: 'book_file', maxCount: 1 },
    { name: 'sample_file', maxCount: 1 }
]), async (req, res) => {
    try {
        const bookId = req.params.id;
        const { 
            title, description, price, category, 
            author_name, publisher, file_type, pages_count, original_price, badge 
        } = req.body;

        const [existing] = await pool.query('SELECT * FROM books WHERE id = ?', [bookId]);
        if (existing.length === 0) {
            return res.status(404).send('Book not found');
        }
        const currentBook = existing[0];

        const coverImageFile = req.files['cover_image'] 
            ? await resolveFileUrl(req.files['cover_image'][0], 'covers') 
            : currentBook.cover_image_url;

        const bookFile = req.files['book_file'] 
            ? await resolveFileUrl(req.files['book_file'][0], 'books') 
            : currentBook.file_path;

        const sampleFile = req.files['sample_file'] 
            ? await resolveFileUrl(req.files['sample_file'][0], 'samples') 
            : currentBook.sample_file_path;

        const query = `
            UPDATE books SET 
                title = ?, description = ?, price = ?, cover_image_url = ?, file_path = ?, 
                category = ?, author_name = ?, publisher = ?, sample_file_path = ?, 
                file_type = ?, pages_count = ?, original_price = ?, badge = ?
            WHERE id = ?
        `;
        await pool.query(query, [
            title,
            description || '',
            price || 0,
            coverImageFile,
            bookFile,
            category || 'สมุดระบายสีเด็ก',
            author_name || '',
            publisher || '',
            sampleFile,
            file_type || 'PDF',
            pages_count || '',
            original_price ? parseFloat(original_price) : null,
            badge || '',
            bookId
        ]);

        res.redirect('/admin/manage');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating book: ' + err.message);
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

// Helper to find category from URL slug or category name
function findCategoryBySlug(param) {
    if (!param) return null;
    let decoded = '';
    try {
        decoded = decodeURIComponent(param).trim();
    } catch (e) {
        decoded = param.trim();
    }
    const cleanSlug = decoded.replace(/-/g, ' ').trim();

    return CATEGORIES.find(c => {
        const catIdClean = c.id.replace(/-/g, ' ').trim();
        const catNameClean = c.name.replace(/-/g, ' ').trim();
        const catSlugClean = (c.slug || '').replace(/-/g, ' ').trim();

        return decoded === c.id ||
               decoded === c.name ||
               decoded === c.slug ||
               cleanSlug.toLowerCase() === catIdClean.toLowerCase() ||
               cleanSlug.toLowerCase() === catNameClean.toLowerCase() ||
               cleanSlug.toLowerCase() === catSlugClean.toLowerCase() ||
               cleanSlug.includes(catIdClean) ||
               cleanSlug.includes(catNameClean);
    });
}

// Category page handler function
async function handleCategoryPage(req, res, slugParam) {
    try {
        const matchedCat = findCategoryBySlug(slugParam);
        const selectedCategory = matchedCat ? matchedCat.id : 'all';
        const searchQuery = req.query.q ? req.query.q.trim() : '';

        let query = 'SELECT * FROM books WHERE 1=1';
        let params = [];

        if (selectedCategory !== 'all') {
            query += ' AND (category = ? OR category LIKE ?)';
            params.push(selectedCategory, `%${selectedCategory}%`);
        }

        if (searchQuery) {
            query += ' AND (title LIKE ? OR description LIKE ? OR author_name LIKE ? OR publisher LIKE ?)';
            const searchParam = `%${searchQuery}%`;
            params.push(searchParam, searchParam, searchParam, searchParam);
        }

        query += ' ORDER BY id DESC';

        const [books] = await pool.query(query, params);

        res.render('index', {
            books,
            selectedCategory,
            searchQuery,
            loginError: req.query.loginError ? true : false,
            activeCategoryObj: matchedCat || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error: ' + err.message);
    }
}

// Category Full Download Page handler function
async function handleCategoryFullPage(req, res, matchedCat) {
    try {
        const categoryId = matchedCat ? matchedCat.id : 'all';

        let query = 'SELECT * FROM books WHERE 1=1';
        let params = [];

        if (categoryId !== 'all') {
            query += ' AND (category = ? OR category LIKE ?)';
            params.push(categoryId, `%${categoryId}%`);
        }

        query += ' ORDER BY id ASC';

        const [books] = await pool.query(query, params);

        res.render('category-full', {
            books,
            categoryObj: matchedCat || { name: 'สื่อการเรียนรู้ทั้งหมด', id: 'all' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error: ' + err.message);
    }
}

// Route for category URL prefix
app.get('/category/:categorySlug/full', async (req, res) => {
    const matchedCat = findCategoryBySlug(req.params.categorySlug);
    handleCategoryFullPage(req, res, matchedCat);
});

app.get('/category/:categorySlug', async (req, res) => {
    handleCategoryPage(req, res, req.params.categorySlug);
});

// Dynamic route for direct category links and -full pages
app.get('/:slug', async (req, res, next) => {
    const slug = req.params.slug;
    let decoded = '';
    try {
        decoded = decodeURIComponent(slug).trim();
    } catch (e) {
        decoded = slug.trim();
    }

    if (decoded.endsWith('-full')) {
        const baseSlug = decoded.slice(0, -5).trim();
        const matchedFull = findCategoryBySlug(baseSlug);
        if (matchedFull) {
            return handleCategoryFullPage(req, res, matchedFull);
        }
    }

    const matched = findCategoryBySlug(slug);
    if (matched) {
        return handleCategoryPage(req, res, slug);
    }
    next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`E-book marketplace server running on port ${PORT}`);
});

module.exports = app;