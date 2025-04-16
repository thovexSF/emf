require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const { pool, updateDataAndSave, updateSpecificDate, downloadExcel } = require('./aportesyrescates.js');
const path = require('path');
const { addHours, format } = require('date-fns');

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

// CORS configuration
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://tu-dominio-production.up.railway.app']
        : ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

// Middleware
app.use(cors(corsOptions));
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

// Servir archivos estáticos en producción
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../client/build')));
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
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
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