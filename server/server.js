// Load environment variables first
const dotenv = require('dotenv');
const result = dotenv.config({ path: __dirname + '/.env' });

if (result.error) {
    console.error('Error loading .env file:', result.error);
    process.exit(1);
}

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const { pool, updateDataAndSave, updateSpecificDate, downloadExcel } = require('./aportesyrescates.js');
const path = require('path');
const { addHours, format } = require('date-fns');

// Debug environment variables
console.log('Environment Variables:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Present' : 'Missing');
console.log('RAILWAY_PUBLIC_DOMAIN:', process.env.RAILWAY_PUBLIC_DOMAIN);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration - Aplicar CORS antes que cualquier otro middleware
app.use(cors({
    origin: 'http://localhost:3001',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

// Middleware
app.use(express.json());
app.use(limiter);

// API Routes
app.get('/api/fetch-data', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM daily_statistics ORDER BY fecha');
        const formattedRows = formatDates(result.rows);
        const rows = formattedRows.map(row => ({
            ...row,
            flujo_aportes: parseFloat(row.flujo_aportes),
            flujo_rescates: parseFloat(row.flujo_rescates),
            neto_aportes_rescates: parseFloat(row.neto_aportes_rescates),
            acumulado_aportes: parseFloat(row.acumulado_aportes),
            acumulado_rescates: parseFloat(row.acumulado_rescates),
            neto_acumulado: parseFloat(row.neto_acumulado)
        }));
        res.json(rows);
    } catch (error) {
        console.error('Error en /api/fetch-data:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

app.get('/api/updateall', async (req, res) => {
    try {
        await updateDataAndSave();
        res.json({ message: 'Datos actualizados' });
    } catch (error) {
        console.error('Error en /api/updateall:', error);
        res.status(500).json({ error: error.message });
    }
});

// Validación de fecha
const validateDate = (date) => {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(date)) {
        return false;
    }
    const d = new Date(date);
    return d instanceof Date && !isNaN(d) && d < new Date();
};

app.get('/api/update/:date', async (req, res) => {
    const { date } = req.params;
    
    if (!validateDate(date)) {
        return res.status(400).json({ error: 'Fecha inválida. Debe estar en formato YYYY-MM-DD y ser anterior a hoy.' });
    }

    try {
        await updateSpecificDate(date);
        res.json({ message: `Datos actualizados para la fecha ${date}` });
    } catch (error) {
        console.error('Error en /api/update/:date:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/download-excel', async (req, res) => {
    try {
        await downloadExcel(res);
    } catch (error) {
        console.error('Error en /api/download-excel:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    // Serve static files from the React app
    app.use(express.static(path.join(__dirname, '../client/build')));

    // Handle React routing, return all requests to React app
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('RAILWAY_PUBLIC_DOMAIN:', process.env.RAILWAY_PUBLIC_DOMAIN);
});

// Programar cron para las 20:17 (8:17 PM) todos los días
cron.schedule('17 20 * * *', updateDataAndSave);

// Helper function
const formatDates = (rows) => {
    return rows.map(row => ({
        ...row,
        fecha: format(addHours(new Date(row.fecha), 12), 'yyyy-MM-dd')
    }));
};