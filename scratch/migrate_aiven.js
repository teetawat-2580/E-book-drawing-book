require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrateAivenColumns() {
    try {
        let dbUrl = process.env.DATABASE_URL.trim().split('?')[0];
        console.log('Connecting to Aiven MySQL...');
        const connection = await mysql.createConnection({
            uri: dbUrl,
            ssl: { rejectUnauthorized: false }
        });

        console.log('Modifying columns to LONGTEXT...');
        await connection.query(`ALTER TABLE books MODIFY COLUMN cover_image_url LONGTEXT`);
        console.log('Modified cover_image_url to LONGTEXT');
        
        await connection.query(`ALTER TABLE books MODIFY COLUMN file_path LONGTEXT`);
        console.log('Modified file_path to LONGTEXT');
        
        await connection.query(`ALTER TABLE books MODIFY COLUMN sample_file_path LONGTEXT`);
        console.log('Modified sample_file_path to LONGTEXT');

        await connection.end();
        console.log('Migration completed successfully on Aiven MySQL!');
    } catch (err) {
        console.error('Migration error:', err.message);
    }
}

migrateAivenColumns();
