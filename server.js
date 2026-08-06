require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const session = require('express-session');

const app = express();

// Disable x-powered-by header for stack hiding
app.disable('x-powered-by');

// Security HTTP Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Session configuration with security hardening
const SESSION_SECRET = process.env.SESSION_SECRET || 'klangsamong-secure-session-key-9a8b7c6d5e4f3a2b';
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// In-memory sliding window rate limiter
const rateLimitStore = new Map();
function rateLimiter(maxRequests = 300, windowMs = 60 * 1000) {
    return (req, res, next) => {
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const record = rateLimitStore.get(clientIp) || { count: 0, resetTime: now + windowMs };

        if (now > record.resetTime) {
            record.count = 1;
            record.resetTime = now + windowMs;
        } else {
            record.count++;
        }

        rateLimitStore.set(clientIp, record);

        if (rateLimitStore.size > 10000) {
            for (const [ip, data] of rateLimitStore.entries()) {
                if (now > data.resetTime) rateLimitStore.delete(ip);
            }
        }

        if (record.count > maxRequests) {
            return res.status(429).send('คำขอเกินจำนวนที่กำหนด กรุณาลองใหม่อีกครั้งในภายหลัง (Too many requests)');
        }
        next();
    };
}
app.use(rateLimiter(300, 60 * 1000));

// Helper for safe referer redirect
function safeRedirectBack(req, res, fallback = '/') {
    const referer = req.headers.referer || req.headers.referrer;
    if (referer) {
        try {
            const host = req.headers.host;
            const urlObj = new URL(referer, `http://${host}`);
            if (urlObj.host === host) {
                return res.redirect(urlObj.pathname + urlObj.search);
            }
        } catch (e) {
            // Fallback on parse failure
        }
    }
    return res.redirect(fallback);
}

// Educational Categories definition for คลังสมอง KLANGSAMONG
const CATEGORIES = [
    { id: 'all', name: 'ทั้งหมด', icon: '🌐', slug: 'ทั้งหมด' },
    { id: 'สมุดระบายสีเด็ก', name: 'สมุดระบายสีเด็ก', icon: '✏️', slug: 'สมุดระบายสีเด็ก', hash20: 'dBsZlYuk', hashFull: 'OzHsM2JS' },
    { id: 'คณิตศาสตร์', name: 'ชีทคณิตศาสตร์', icon: '🔢', slug: 'ชีทคณิตศาสตร์', hash20: 'zqfZg0Sl', hashFull: 'zHYh8GjO' },
    { id: 'แบบฝึกหัดคณิตศาสตร์', name: 'แบบฝึกหัดคณิตศาสตร์', icon: '📐', slug: 'แบบฝึกหัดคณิตศาสตร์', hash20: 'i2lr9oMH', hashFull: 'EOvEcClq' },
    { id: 'พื้นฐานการบวกเลข', name: 'พื้นฐานการบวกเลข', icon: '➕', slug: 'พื้นฐานการบวกเลข', hash20: 'QbU76dyN', hashFull: 'ZuMZeatt' },
    { id: 'ชีทฝึกเขียน', name: 'ชีทฝึกเขียนภาษา', icon: '✍️', slug: 'ชีทฝึกเขียนภาษา', hash20: 'T8iPRfNx', hashFull: 'YqqmyFk6' },
    { id: 'แฟลชการ์ด', name: 'แฟลชการ์ด 2 ภาษา', icon: '🎴', slug: 'แฟลชการ์ด-2-ภาษา', hash20: 'PnqW4Aeq', hashFull: 'Jv5iFlfS' },
    { id: 'เกมฝึกสมอง', name: 'เกมฝึกสมองเด็ก', icon: '🧩', slug: 'เกมฝึกสมองเด็ก', hash20: '5OoPt7WM', hashFull: 'VK3gf4Dk' },
    { id: 'นิทานเด็ก AI', name: 'นิทานและแบบเรียน', icon: '📚', slug: 'นิทานและแบบเรียน', hash20: '8GlAVF2a', hashFull: '6a5gAlnP' },
    { id: 'สื่อครูตกแต่ง', name: 'สื่อครูตกแต่งห้องเรียน', icon: '🏫', slug: 'สื่อครูตกแต่งห้องเรียน', hash20: 'YOdpLxMm', hashFull: 'wwb4l454' }
];

// Mapping of custom 20-book page hash codes to category IDs and slugs
const HASH_20_MAP = {
    'PnqW4Aeq': { id: 'แฟลชการ์ด', slug: 'แฟลชการ์ด-2-ภาษา' },
    'dBsZlYuk': { id: 'สมุดระบายสีเด็ก', slug: 'สมุดระบายสีเด็ก' },
    'zqfZg0Sl': { id: 'คณิตศาสตร์', slug: 'ชีทคณิตศาสตร์' },
    'T8iPRfNx': { id: 'ชีทฝึกเขียน', slug: 'ชีทฝึกเขียนภาษา' },
    '5OoPt7WM': { id: 'เกมฝึกสมอง', slug: 'เกมฝึกสมองเด็ก' },
    '8GlAVF2a': { id: 'นิทานเด็ก AI', slug: 'นิทานและแบบเรียน' },
    'YOdpLxMm': { id: 'สื่อครูตกแต่ง', slug: 'สื่อครูตกแต่งห้องเรียน' },
    'QbU76dyN': { id: 'พื้นฐานการบวกเลข', slug: 'พื้นฐานการบวกเลข' },
    'i2lr9oMH': { id: 'แบบฝึกหัดคณิตศาสตร์', slug: 'แบบฝึกหัดคณิตศาสตร์' }
};

// Mapping of custom Full package page hash codes to category IDs and slugs
const HASH_FULL_MAP = {
    'Jv5iFlfS': { id: 'แฟลชการ์ด', slug: 'แฟลชการ์ด-2-ภาษา' },
    'OzHsM2JS': { id: 'สมุดระบายสีเด็ก', slug: 'สมุดระบายสีเด็ก' },
    'zHYh8GjO': { id: 'คณิตศาสตร์', slug: 'ชีทคณิตศาสตร์' },
    'YqqmyFk6': { id: 'ชีทฝึกเขียน', slug: 'ชีทฝึกเขียนภาษา' },
    'VK3gf4Dk': { id: 'เกมฝึกสมอง', slug: 'เกมฝึกสมองเด็ก' },
    '6a5gAlnP': { id: 'นิทานเด็ก AI', slug: 'นิทานและแบบเรียน' },
    'wwb4l454': { id: 'สื่อครูตกแต่ง', slug: 'สื่อครูตกแต่งห้องเรียน' },
    'ZuMZeatt': { id: 'พื้นฐานการบวกเลข', slug: 'พื้นฐานการบวกเลข' },
    'EOvEcClq': { id: 'แบบฝึกหัดคณิตศาสตร์', slug: 'แบบฝึกหัดคณิตศาสตร์' }
};

// Set EJS as templating engine and set explicit views directory for Vercel Serverless
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Pass session user & categories to all views (Direct admin access enabled)
app.use((req, res, next) => {
    res.locals.currentUser = { username: 'admin', role: 'admin', name: 'Administrator' };
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

// Firebase Storage REST API Upload Helper for Server & Serverless (Vercel)
async function uploadToFirebaseStorage(reqFile, subFolder) {
    if (!reqFile || !reqFile.buffer) return '';
    const BUCKET_NAME = "klangsamong-e1d13.firebasestorage.app";
    const cleanName = (reqFile.originalname || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const objectPath = `${subFolder}/${Date.now()}_${cleanName}`;
    const encodedPath = encodeURIComponent(objectPath);

    const firebaseUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o?uploadType=media&name=${encodedPath}`;

    const response = await fetch(firebaseUrl, {
        method: 'POST',
        headers: {
            'Content-Type': reqFile.mimetype || 'application/octet-stream'
        },
        body: reqFile.buffer
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Firebase Storage Server Upload Failed (${response.status}): ${errText}`);
    }

    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodedPath}?alt=media`;
    console.log(`Successfully uploaded ${reqFile.originalname} to Firebase Storage: ${publicUrl}`);
    return publicUrl;
}

// File upload security whitelists & dangerous extension blocking
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.epub']);
const DANGEROUS_EXTENSIONS = new Set(['.php', '.exe', '.js', '.html', '.htm', '.sh', '.bat', '.cmd', '.py', '.svg', '.asp', '.aspx', '.jsp', '.cgi', '.pl']);

function validateFileUpload(reqFile) {
    if (!reqFile || !reqFile.originalname) return;
    const ext = path.extname(reqFile.originalname).toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(ext)) {
        throw new Error('ไม่อนุญาตให้อัปโหลดไฟล์ประเภทนี้เพื่อความปลอดภัย');
    }
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error('นามสกุลไฟล์ไม่ได้รับอนุญาต (อนุญาตเฉพาะ JPG, PNG, WEBP, GIF, PDF)');
    }
}

function sanitizeFilename(originalName) {
    if (!originalName) return 'file_' + Date.now();
    const ext = path.extname(originalName).toLowerCase();
    const nameWithoutExt = path.basename(originalName, ext);
    const cleanBase = nameWithoutExt.replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, '_').substring(0, 80);
    return `${cleanBase}_${Date.now()}${ext}`;
}

// Helper function to resolve file URL (Firebase Storage / Vercel Blob / Local Disk) with Path Traversal Shield
async function resolveFileUrl(reqFile, subFolder = 'books') {
    if (!reqFile || !reqFile.buffer) return '';
    
    // 0. Validate file extension & mime type against dangerous scripts
    validateFileUpload(reqFile);
    
    const safeSubFolder = subFolder.replace(/[^a-zA-Z0-9_\-]/g, '');

    // 1. Primary: Upload directly to Firebase Storage Bucket (klangsamong-e1d13.firebasestorage.app)
    try {
        const firebaseUrl = await uploadToFirebaseStorage(reqFile, safeSubFolder);
        if (firebaseUrl) return firebaseUrl;
    } catch (err) {
        console.error("Firebase Storage server upload notice:", err.message);
    }

    // 2. If Vercel Blob Token is set, upload file directly to Vercel Blob Storage
    if (process.env.BLOB_READ_WRITE_TOKEN && vercelBlob) {
        try {
            const cleanName = sanitizeFilename(reqFile.originalname);
            const blob = await vercelBlob.put(`${safeSubFolder}/${cleanName}`, reqFile.buffer, {
                access: 'public'
            });
            console.log(`Uploaded ${reqFile.originalname} to Vercel Blob: ${blob.url}`);
            return blob.url;
        } catch (err) {
            console.error("Vercel Blob upload failed:", err.message);
        }
    }

    // 3. If running locally, attempt to save buffer to local disk safely with path traversal checks
    const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
    if (!isVercel) {
        try {
            const baseUploadsDir = path.resolve(__dirname, 'public/uploads');
            const targetUploadDir = path.resolve(baseUploadsDir, safeSubFolder);

            if (!targetUploadDir.startsWith(baseUploadsDir)) {
                throw new Error('Path traversal violation detected');
            }

            if (!fs.existsSync(targetUploadDir)) {
                fs.mkdirSync(targetUploadDir, { recursive: true });
            }

            const safeFilename = sanitizeFilename(reqFile.originalname);
            const targetPath = path.resolve(targetUploadDir, safeFilename);

            if (!targetPath.startsWith(targetUploadDir)) {
                throw new Error('Path traversal violation detected');
            }

            fs.writeFileSync(targetPath, reqFile.buffer);
            return `/uploads/${safeSubFolder}/${safeFilename}`;
        } catch (err) {
            console.error("Local disk save notice:", err.message);
        }
    }

    throw new Error('ไม่สามารถอัปโหลดไฟล์ได้ กรุณาตรวจสอบการตั้งค่าพื้นที่จัดเก็บข้อมูล');
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
            { name: 'badge', type: "VARCHAR(100) DEFAULT ''" },
            { name: 'downloads_count', type: "INT DEFAULT 0" }
        ];

        for (const col of extraColumns) {
            const [cols] = await connection.query('SHOW COLUMNS FROM books LIKE ?', [col.name]);
            if (cols.length === 0) {
                const safeColName = col.name.replace(/[^a-zA-Z0-9_]/g, '');
                await connection.query(`ALTER TABLE books ADD COLUMN \`${safeColName}\` ${col.type}`);
                console.log(`Added '${safeColName}' column to 'books' table.`);
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
        // Create category_settings table if it doesn't exist
        await connection.query(`
            CREATE TABLE IF NOT EXISTS category_settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                category_slug VARCHAR(100) UNIQUE NOT NULL,
                category_name VARCHAR(100) NOT NULL,
                drive_folder_url LONGTEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Populate initial categories if missing
        for (const cat of CATEGORIES) {
            if (cat.id === 'all') continue;
            await connection.query(
                `INSERT IGNORE INTO category_settings (category_slug, category_name) VALUES (?, ?)`,
                [cat.id, cat.name]
            );
        }

        // Create click_logs table for time-based analytics tracking
        await connection.query(`
            CREATE TABLE IF NOT EXISTS click_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                button_name VARCHAR(100) NOT NULL,
                book_id INT NULL,
                book_title VARCHAR(255) NULL,
                category_name VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
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

// Middleware: Admin Protection (Direct Access Enabled - No Login Required)
function requireAdmin(req, res, next) {
    next();
}

// 1. Homepage Route: Display books by Category or Search
app.get('/', async (req, res) => {
    try {
        const selectedCategory = req.query.category || 'all';
        const searchQuery = req.query.q || '';
        
        let sql = 'SELECT * FROM books WHERE 1=1';
        const params = [];

        if (selectedCategory !== 'all') {
            sql += ' AND (category = ? OR category LIKE ?)';
            params.push(selectedCategory, `%${selectedCategory}%`);
        }

        if (searchQuery) {
            sql += ' AND (title LIKE ? OR description LIKE ?)';
            params.push(`%${searchQuery}%`, `%${searchQuery}%`);
        }

        if (selectedCategory !== 'all') {
            sql += ' ORDER BY id ASC';
        } else {
            sql += ' ORDER BY id DESC';
        }

        const [books] = await pool.query(sql, params);

        if (selectedCategory !== 'all') {
            books.sort((a, b) => {
                const numA = extractBookNumber(a.title);
                const numB = extractBookNumber(b.title);
                if (numA !== numB) return numA - numB;
                return a.id - b.id;
            });
        }

        res.render('index', { 
            books: books, 
            selectedCategory, 
            searchQuery,
            loginError: null,
            adminGateRequired: false,
            isHomepage: !searchQuery && selectedCategory === 'all'
        });
    } catch (err) {
        console.error('Homepage route error:', err);
        res.status(500).send(`Error loading homepage: ${err.message}`);
    }
});

// Download Tracker & File Redirect Endpoint (Method 1)
app.get('/download/:id', async (req, res) => {
    try {
        const bookId = req.params.id;
        const downloadType = req.query.type || 'full'; // 'full' or 'sample'

        const [books] = await pool.query('SELECT id, title, file_path, sample_file_path, cover_image_url, category FROM books WHERE id = ?', [bookId]);
        if (books.length === 0) {
            return res.redirect('/');
        }

        const book = books[0];

        // Increment download counter atomically in DB
        await pool.query('UPDATE books SET downloads_count = COALESCE(downloads_count, 0) + 1 WHERE id = ?', [bookId]);

        // Log click event into click_logs table for time-based analytics
        try {
            const btnName = downloadType === 'sample' ? 'download_sample' : 'download_full';
            await pool.query(
                'INSERT INTO click_logs (button_name, book_id, book_title, category_name) VALUES (?, ?, ?, ?)',
                [btnName, book.id, book.title, book.category || '']
            );
        } catch (logErr) {
            console.error('Log click error:', logErr);
        }

        let targetUrl = '';
        if (downloadType === 'sample' && book.sample_file_path && book.sample_file_path.trim() !== '#' && book.sample_file_path.trim() !== '') {
            targetUrl = book.sample_file_path.trim();
        } else if (book.file_path && book.file_path.trim() !== '#' && book.file_path.trim() !== '') {
            targetUrl = book.file_path.trim();
        } else if (book.sample_file_path && book.sample_file_path.trim() !== '#' && book.sample_file_path.trim() !== '') {
            targetUrl = book.sample_file_path.trim();
        }

        // Clean up targetUrl
        if (targetUrl === '#' || targetUrl === 'null' || targetUrl === 'undefined') {
            targetUrl = '';
        }

        // If no direct book file URL exists, check category_settings for Google Drive folder link
        if (!targetUrl && book.category) {
            try {
                const [catSettings] = await pool.query('SELECT drive_folder_url FROM category_settings WHERE category_name = ? OR category_slug = ?', [book.category, book.category]);
                if (catSettings.length > 0 && catSettings[0].drive_folder_url) {
                    const driveUrl = catSettings[0].drive_folder_url.trim();
                    if (driveUrl && driveUrl !== '#' && driveUrl !== 'null') {
                        targetUrl = driveUrl;
                    }
                }
            } catch (catErr) {
                console.error('Category settings lookup error:', catErr);
            }
        }

        // If STILL no valid target URL exists, display a clear, helpful page instead of redirecting back to homepage
        if (!targetUrl) {
            return res.status(200).send(`
                <!DOCTYPE html>
                <html lang="th">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>กำลังจัดเตรียมไฟล์ดาวน์โหลด | คลังสมอง KLANGSAMONG</title>
                    <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;600;700&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Prompt', sans-serif; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                        .card { background: white; padding: 40px 30px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); text-align: center; max-width: 480px; width: 100%; border: 1px solid #e2e8f0; }
                        .icon { font-size: 54px; margin-bottom: 15px; }
                        h2 { font-size: 20px; color: #1e3a8a; margin: 0 0 10px 0; }
                        p { font-size: 14px; color: #64748b; line-height: 1.6; margin-bottom: 25px; }
                        .btn { display: inline-block; background: #22c55e; color: white; padding: 12px 24px; border-radius: 25px; text-decoration: none; font-weight: 700; font-size: 14.5px; transition: background 0.2s; }
                        .btn:hover { background: #16a34a; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="icon">📦</div>
                        <h2>ไฟล์ "${book.title || 'สื่อการเรียนรู้'}" อยู่ระหว่างจัดเตรียม</h2>
                        <p>ไฟล์สำหรับดาวน์โหลดรายการนี้กำลังอยู่ระหว่างดำเนินการอัปโหลดข้อมูล ท่านสามารถเลือกหมวดหมู่อื่น หรือติดต่อผู้ดูแลระบบได้ครับ</p>
                        <a href="/" class="btn">← กลับไปยังหน้าหลัก</a>
                    </div>
                </body>
                </html>
            `);
        }

        return res.redirect(302, targetUrl);
    } catch (err) {
        console.error('Download tracker error:', err);
        return res.redirect('/');
    }
});

// Client-side Button Click Logging API Route
app.post('/api/track-click', async (req, res) => {
    try {
        const { button_name, book_id, book_title, category_name } = req.body;
        if (!button_name) {
            return res.status(400).json({ error: 'Missing button_name' });
        }

        await pool.query(
            'INSERT INTO click_logs (button_name, book_id, book_title, category_name) VALUES (?, ?, ?, ?)',
            [button_name, book_id || null, book_title || null, category_name || null]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('Track click API error:', err);
        return res.status(500).json({ error: `Error tracking click: ${err.message}` });
    }
});

// Admin Route: Analytics & Time-Period Click Tracker Dashboard
app.get('/admin/analytics', requireAdmin, async (req, res) => {
    try {
        // Ensure table exists on serverless cold starts
        await pool.query(`
            CREATE TABLE IF NOT EXISTS click_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                button_name VARCHAR(100) NOT NULL,
                book_id INT NULL,
                book_title VARCHAR(255) NULL,
                category_name VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const period = req.query.period || '7days'; // 'today', '7days', '30days', 'all'
        
        let dateFilter = '';
        if (period === 'today') {
            dateFilter = 'WHERE created_at >= CURDATE()';
        } else if (period === '7days') {
            dateFilter = 'WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        } else if (period === '30days') {
            dateFilter = 'WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        }

        // Summary Statistics
        const [totalClicks] = await pool.query(`SELECT COUNT(*) as count FROM click_logs ${dateFilter}`);
        const [totalDownloads] = await pool.query(`SELECT COUNT(*) as count FROM click_logs ${dateFilter ? dateFilter + ' AND' : 'WHERE'} button_name = 'download_full'`);
        const [totalSamples] = await pool.query(`SELECT COUNT(*) as count FROM click_logs ${dateFilter ? dateFilter + ' AND' : 'WHERE'} button_name = 'download_sample'`);
        const [totalDriveAll] = await pool.query(`SELECT COUNT(*) as count FROM click_logs ${dateFilter ? dateFilter + ' AND' : 'WHERE'} button_name = 'category_drive_all'`);

        // Top Downloaded Books in Selected Period
        const [topBooks] = await pool.query(`
            SELECT book_id, book_title, category_name, COUNT(*) as click_count 
            FROM click_logs 
            ${dateFilter ? dateFilter + ' AND' : 'WHERE'} book_title IS NOT NULL AND book_title != ''
            GROUP BY book_id, book_title, category_name 
            ORDER BY click_count DESC 
            LIMIT 10
        `);

        // Click Breakdown by Button Type
        const [buttonBreakdown] = await pool.query(`
            SELECT button_name, COUNT(*) as click_count 
            FROM click_logs 
            ${dateFilter} 
            GROUP BY button_name 
            ORDER BY click_count DESC
        `);

        // Recent Click Logs List (Last 50 entries)
        const [recentLogs] = await pool.query(`
            SELECT * FROM click_logs 
            ${dateFilter} 
            ORDER BY created_at DESC 
            LIMIT 50
        `);

        res.render('admin-analytics', {
            period,
            totalClicks: (totalClicks && totalClicks[0] && totalClicks[0].count) || 0,
            totalDownloads: (totalDownloads && totalDownloads[0] && totalDownloads[0].count) || 0,
            totalSamples: (totalSamples && totalSamples[0] && totalSamples[0].count) || 0,
            totalDriveAll: (totalDriveAll && totalDriveAll[0] && totalDriveAll[0].count) || 0,
            topBooks: topBooks || [],
            buttonBreakdown: buttonBreakdown || [],
            recentLogs: recentLogs || []
        });
    } catch (err) {
        console.error('Analytics page error:', err);
        res.status(500).send(`Error loading analytics page: ${err.message}`);
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
        return safeRedirectBack(req, res);
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
        console.error('Book detail route error:', err);
        res.status(500).send(`Error loading book detail: ${err.message}`);
    }
});

// 2. Admin Route: Book Management Page
app.get('/admin/manage', requireAdmin, async (req, res) => {
    try {
        const [books] = await pool.query('SELECT * FROM books ORDER BY id DESC');
        
        let categorySettingsList = [];
        try {
            const [catSettings] = await pool.query('SELECT * FROM category_settings');
            categorySettingsList = CATEGORIES.filter(c => c.id !== 'all').map(c => {
                const found = catSettings.find(s => s.category_slug === c.id || s.category_slug === c.slug);
                return {
                    id: c.id,
                    slug: c.id,
                    name: c.name,
                    drive_folder_url: found ? found.drive_folder_url : ''
                };
            });
        } catch (catErr) {
            console.log("Category settings query notice:", catErr.message);
            categorySettingsList = CATEGORIES.filter(c => c.id !== 'all').map(c => ({ id: c.id, slug: c.id, name: c.name, drive_folder_url: '' }));
        }

        res.render('admin-manage', { books, categorySettingsList });
    } catch (err) {
        console.error('Admin manage route error:', err);
        res.status(500).send(`Error loading admin manage page: ${err.message}`);
    }
});

// 2.1 Admin Route: Update Category Google Drive Folder Link
app.post('/admin/update-category-drive', requireAdmin, async (req, res) => {
    try {
        const { category_slug, drive_folder_url } = req.body;
        if (!category_slug) {
            return res.status(400).json({ success: false, message: 'category_slug is required' });
        }

        const catObj = CATEGORIES.find(c => c.id === category_slug || c.slug === category_slug);
        const catName = catObj ? catObj.name : category_slug;

        const query = `
            INSERT INTO category_settings (category_slug, category_name, drive_folder_url)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE drive_folder_url = VALUES(drive_folder_url)
        `;
        await pool.query(query, [category_slug, catName, drive_folder_url || '']);

        return res.json({ success: true, message: 'Updated category Google Drive link successfully' });
    } catch (err) {
        console.error('Update category drive error:', err);
        return res.status(500).json({ success: false, message: `Error updating category drive link: ${err.message}` });
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
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์' });
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
        console.error('Upload direct error:', err);
        if (req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json')) {
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกหนังสือ' });
        }
        res.status(500).send('เกิดข้อผิดพลาดในการบันทึกหนังสือ');
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
        console.error('Edit book direct error:', err);
        if (req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json')) {
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการแก้ไขหนังสือ' });
        }
        res.status(500).send('เกิดข้อผิดพลาดในการแก้ไขหนังสือ');
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
        console.error('Admin upload route error:', err);
        res.status(500).send('เกิดข้อผิดพลาดในการอัปโหลดหนังสือ');
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
        console.error('Admin batch route error:', err);
        res.status(500).send('เกิดข้อผิดพลาดในการโหลดหน้า Batch');
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
        console.error('Batch JSON import error:', err);
        res.redirect('/admin/batch?error=' + encodeURIComponent('เกิดข้อผิดพลาดในการบันทึกข้อมูลแบบ Batch'));
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
        console.error('Batch SQL execution error:', err);
        res.redirect('/admin/batch?error=' + encodeURIComponent('เกิดข้อผิดพลาดในการประมวลผลคำสั่ง SQL'));
    }
});

// Admin Route: Export Full Books Table as SQL file download (HTTP Attachment Download)
app.get('/admin/export-sql', async (req, res) => {
    try {
        const [books] = await pool.query('SELECT * FROM books ORDER BY id ASC');

        const esc = (val) => {
            if (val === null || val === undefined || val === '') return 'NULL';
            const str = String(val);
            if (str.startsWith('data:')) return 'NULL';
            return mysql.escape(str);
        };
        const num = (val) => (val === null || val === undefined || val === '' || isNaN(val)) ? 'NULL' : Number(val);

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toLocaleTimeString('th-TH');

        let sqlLines = [
            `-- 📥 โค้ด SQL ส่งออกหนังสือทั้งหมดในฐานข้อมูล (จำนวนทั้งหมด ${books.length} รายการ)`,
            `-- แหล่งที่มา: KLANGSAMONG (klangsamong.vercel.app)`,
            `-- วันที่ส่งออก: ${dateStr} ${timeStr}`,
            `-- ท่านสามารถนำไฟล์นี้ไปปรับแต่งข้อความ แล้วรันอัปเดตแบบ Batch ได้ทันที\n`
        ];

        books.forEach(b => {
            const query = `INSERT INTO books (id, title, author_name, publisher, category, price, original_price, pages_count, file_type, badge, cover_image_url, file_path, sample_file_path, description) ` +
                          `VALUES (${b.id}, ${esc(b.title)}, ${esc(b.author_name)}, ${esc(b.publisher)}, ${esc(b.category)}, ${num(b.price)}, ${num(b.original_price)}, ${esc(b.pages_count)}, ${esc(b.file_type)}, ${esc(b.badge)}, ${esc(b.cover_image_url)}, ${esc(b.file_path)}, ${esc(b.sample_file_path)}, ${esc(b.description)}) ` +
                          `ON DUPLICATE KEY UPDATE title = VALUES(title), author_name = VALUES(author_name), publisher = VALUES(publisher), category = VALUES(category), price = VALUES(price), original_price = VALUES(original_price), pages_count = VALUES(pages_count), file_type = VALUES(file_type), badge = VALUES(badge), cover_image_url = VALUES(cover_image_url), file_path = VALUES(file_path), sample_file_path = VALUES(sample_file_path), description = VALUES(description);`;
            sqlLines.push(query);
        });

        const fullSql = sqlLines.join('\n\n');
        const filename = `klangsamong_books_export_${dateStr}.sql`;

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(fullSql);
    } catch (err) {
        console.error('Export SQL error:', err);
        res.status(500).send(`Error exporting SQL: ${err.message}`);
    }
});

// 5.3 Admin Route: Process Interactive Table Batch Edit / Update
app.post('/admin/batch-update', requireAdmin, async (req, res) => {
    try {
        let booksData = [];
        if (Array.isArray(req.body.books)) {
            booksData = req.body.books;
        } else if (typeof req.body.json_data === 'string') {
            try { booksData = JSON.parse(req.body.json_data); } catch(e) {}
        } else if (typeof req.body === 'string') {
            try { booksData = JSON.parse(req.body); } catch(e) {}
        }

        if (!Array.isArray(booksData)) {
            if (req.headers['content-type']?.includes('application/json')) {
                return res.status(400).json({ success: false, message: 'ข้อมูลไม่ถูกต้อง' });
            }
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
                    b.category || 'สมุดระบายสีเด็ก',
                    parseFloat(b.price) || 0,
                    b.original_price ? parseFloat(b.original_price) : null,
                    b.pages_count || '',
                    b.file_type || 'PDF',
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
                    b.category || 'สมุดระบายสีเด็ก',
                    b.author_name || '',
                    b.publisher || '',
                    b.sample_file_path || '',
                    b.file_type || 'PDF',
                    b.pages_count || '',
                    b.original_price ? parseFloat(b.original_price) : null,
                    b.badge || ''
                ]);
                insertedCount++;
            }
        }

        if (req.headers['content-type']?.includes('application/json')) {
            return res.json({ success: true, updatedCount, insertedCount });
        }

        res.redirect('/admin/batch?success=' + encodeURIComponent(`บันทึก Batch Edit สำเร็จ! (อัปเดต ${updatedCount} รายการ, เพิ่มใหม่ ${insertedCount} รายการ)`));
    } catch (err) {
        console.error('Batch update interactive error:', err);
        if (req.headers['content-type']?.includes('application/json')) {
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึก Batch Edit' });
        }
        res.redirect('/admin/batch?error=' + encodeURIComponent('เกิดข้อผิดพลาดในการบันทึก Batch Edit'));
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
        console.error('Upload file AJAX error:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์' });
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
        console.error('Edit book error:', err);
        res.status(500).send('เกิดข้อผิดพลาดในการแก้ไขข้อมูลหนังสือ');
    }
});

// 6. Admin Route: Delete Book
app.post('/admin/delete-book/:id', requireAdmin, async (req, res) => {
    try {
        const bookId = req.params.id;

        // Fetch book files to remove from disk safely with path traversal check
        const [books] = await pool.query('SELECT cover_image_url, file_path, sample_file_path FROM books WHERE id = ?', [bookId]);
        if (books.length > 0) {
            const book = books[0];
            const filesToDelete = [book.cover_image_url, book.file_path, book.sample_file_path];
            const publicDir = path.resolve(__dirname, 'public');

            filesToDelete.forEach(filePath => {
                if (filePath && typeof filePath === 'string' && !filePath.startsWith('http') && !filePath.startsWith('data:')) {
                    const cleanRelPath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
                    const fullPath = path.resolve(publicDir, cleanRelPath.replace(/^\//, ''));
                    if (fullPath.startsWith(publicDir) && fs.existsSync(fullPath)) {
                        try {
                            fs.unlinkSync(fullPath);
                        } catch (e) {
                            console.error('File deletion notice:', e.message);
                        }
                    }
                }
            });
        }

        // Delete from database
        await pool.query('DELETE FROM books WHERE id = ?', [bookId]);

        safeRedirectBack(req, res);
    } catch (err) {
        console.error('Delete book error:', err);
        res.status(500).send('เกิดข้อผิดพลาดในการลบหนังสือ');
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

// Helper to extract numeric book number from book title
function extractBookNumber(title) {
    if (!title) return 999999;
    const match = title.match(/เล่ม(?:ที่)?\s*[:\s]*(\d+)/i) || title.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 999999;
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

        query += ' ORDER BY id ASC';

        const [books] = await pool.query(query, params);

        // Sort books in ascending order: Book 1 (เล่มที่ 1) first, up to Book 50
        books.sort((a, b) => {
            const numA = extractBookNumber(a.title);
            const numB = extractBookNumber(b.title);
            if (numA !== numB) return numA - numB;
            return a.id - b.id;
        });

        res.render('index', {
            books,
            selectedCategory,
            searchQuery,
            loginError: req.query.loginError ? true : false,
            activeCategoryObj: matchedCat || null,
            isHomepage: false
        });
    } catch (err) {
        console.error('Handle category page error:', err);
        res.status(500).send('เกิดข้อผิดพลาดในการโหลดหมวดหมู่หนังสือ');
    }
}

// Category Full / 20 Download Page handler function
async function handleCategoryFullPage(req, res, matchedCat, isLimit20 = false) {
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

        // Sort books in ascending order: Book 1 (เล่มที่ 1) first, up to Book 50
        books.sort((a, b) => {
            const numA = extractBookNumber(a.title);
            const numB = extractBookNumber(b.title);
            if (numA !== numB) return numA - numB;
            return a.id - b.id;
        });

        // Fetch category Google Drive folder URL if available
        let driveFolderUrl = '';
        if (matchedCat && matchedCat.id !== 'all') {
            try {
                const [cats] = await pool.query('SELECT drive_folder_url FROM category_settings WHERE category_slug = ? OR category_slug = ?', [matchedCat.id, matchedCat.slug]);
                if (cats.length > 0 && cats[0].drive_folder_url) {
                    driveFolderUrl = cats[0].drive_folder_url;
                }
            } catch (catErr) {
                console.log("Notice: category_settings lookup:", catErr.message);
            }
        }

        res.render('category-full', {
            books,
            categoryObj: matchedCat || { name: 'สื่อการเรียนรู้ทั้งหมด', id: 'all' },
            driveFolderUrl,
            isLimit20: !!isLimit20
        });
    } catch (err) {
        console.error('Handle category full page error:', err);
        res.status(500).send('เกิดข้อผิดพลาดในการโหลดหน้าดาวน์โหลดหนังสือ');
    }
}

// Route for category URL prefix: /category/:categorySlug/20
app.get('/category/:categorySlug/20', async (req, res) => {
    const matchedCat = findCategoryBySlug(req.params.categorySlug);
    handleCategoryFullPage(req, res, matchedCat, true);
});

// Route for category URL prefix: /category/:categorySlug/full
app.get('/category/:categorySlug/full', async (req, res) => {
    const matchedCat = findCategoryBySlug(req.params.categorySlug);
    handleCategoryFullPage(req, res, matchedCat, false);
});

app.get('/category/:categorySlug', async (req, res) => {
    handleCategoryPage(req, res, req.params.categorySlug);
});

// Dynamic route for direct category links, custom 20-book hash pages, custom full package hash pages
app.get('/:slug', async (req, res, next) => {
    const slug = req.params.slug;
    let decoded = '';
    try {
        decoded = decodeURIComponent(slug).trim();
    } catch (e) {
        decoded = slug.trim();
    }

    // 1. Check custom 20-book page hashes (e.g. /แฟลชการ์ด-2-ภาษา-PnqW4Aeq)
    const hash20Key = Object.keys(HASH_20_MAP).find(h => decoded.endsWith(`-${h}`) || decoded === h);
    if (hash20Key) {
        const catInfo = HASH_20_MAP[hash20Key];
        const matchedHashCat = CATEGORIES.find(c => c.id === catInfo.id);
        if (matchedHashCat) {
            return handleCategoryFullPage(req, res, matchedHashCat, true);
        }
    }

    // 2. Check custom Full package page hashes (e.g. /แฟลชการ์ด-2-ภาษา-Jv5iFlfS)
    const hashFullKey = Object.keys(HASH_FULL_MAP).find(h => decoded.endsWith(`-${h}`) || decoded === h);
    if (hashFullKey) {
        const catInfo = HASH_FULL_MAP[hashFullKey];
        const matchedFullCat = CATEGORIES.find(c => c.id === catInfo.id);
        if (matchedFullCat) {
            return handleCategoryFullPage(req, res, matchedFullCat, false);
        }
    }

    // 3. Legacy -20 URLs -> Redirect 301 to new custom 20-book Hash URL
    if (decoded.endsWith('-20')) {
        const baseSlug = decoded.slice(0, -3).trim();
        const matched20 = findCategoryBySlug(baseSlug);
        if (matched20 && matched20.hash20) {
            const targetUrl = '/' + encodeURIComponent(matched20.slug + '-' + matched20.hash20);
            return res.redirect(301, targetUrl);
        } else if (matched20) {
            return handleCategoryFullPage(req, res, matched20, true);
        }
    }

    // 4. Legacy -full URLs -> Redirect 301 to new custom Full package Hash URL
    if (decoded.endsWith('-full')) {
        const baseSlug = decoded.slice(0, -5).trim();
        const matchedFull = findCategoryBySlug(baseSlug);
        if (matchedFull && matchedFull.hashFull) {
            const targetUrl = '/' + encodeURIComponent(matchedFull.slug + '-' + matchedFull.hashFull);
            return res.redirect(301, targetUrl);
        } else if (matchedFull) {
            return handleCategoryFullPage(req, res, matchedFull, false);
        }
    }

    // 5. Normal Category page
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