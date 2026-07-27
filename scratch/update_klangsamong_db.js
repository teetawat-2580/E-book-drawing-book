require('dotenv').config();
const mysql = require('mysql2/promise');

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
        const [res] = await pool.query("UPDATE books SET publisher = REPLACE(publisher, 'KLANGSOMONG', 'KLANGSAMONG')");
        console.log('Database updated successfully! Affected rows:', res.affectedRows);
        process.exit(0);
    } catch (e) {
        console.error('Error updating DB:', e.message);
        process.exit(1);
    }
})();
