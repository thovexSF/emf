// Load environment variables first
const dotenv = require('dotenv');
// Solo cargar .env en desarrollo
if (process.env.NODE_ENV !== 'production') {
    const result = dotenv.config({ path: __dirname + '/.env' });
    if (result.error) {
        console.error('Error loading .env file:', result.error);
    }
}

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const { pool, updateDataAndSave, updateSpecificDate, downloadExcel, updateDataAndSaveForced, updateDataFromDate, removeHolidaysFromDatabase, getChileanHolidays } = require('./aportesyrescates.js');
const path = require('path');
const { addHours, format } = require('date-fns');
const fs = require('fs');

// Debug environment variables
console.log('Environment Variables:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Present' : 'Missing');
console.log('RAILWAY_PUBLIC_DOMAIN:', process.env.RAILWAY_PUBLIC_DOMAIN);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration - Aplicar CORS antes que cualquier otro middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? process.env.RAILWAY_PUBLIC_DOMAIN || 'http://localhost:3001'
        : 'http://localhost:3001',
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
        console.log('Starting updateall process...');
        const result = await updateDataAndSave();
        
        // Si updateDataAndSave devuelve un objeto con información del resultado
        if (result && typeof result === 'object') {
            if (result.success) {
                res.json({ 
                    message: result.message,
                    processed: result.processed,
                    errors: result.errors,
                    success: true
                });
            } else {
                res.status(500).json({ 
                    error: result.message,
                    processed: result.processed,
                    errors: result.errors,
                    errorDetails: result.errorDetails,
                    success: false
                });
            }
        } else {
            // Mantener compatibilidad con versión anterior
            res.json({ message: 'Datos actualizados', success: true });
        }
    } catch (error) {
        console.error('Error en /api/updateall:', error);
        res.status(500).json({ 
            error: error.message,
            success: false,
            processed: 0,
            errors: 1
        });
    }
});

// Nuevo endpoint para actualización forzada que incluye registros con valores 0
app.get('/api/updateall-forced', async (req, res) => {
    try {
        console.log('Starting FORCED updateall process...');
        const result = await updateDataAndSaveForced();
        
        if (result && typeof result === 'object') {
            if (result.success) {
                res.json({ 
                    message: result.message,
                    processed: result.processed,
                    errors: result.errors,
                    success: true
                });
            } else {
                res.status(500).json({ 
                    error: result.message,
                    processed: result.processed,
                    errors: result.errors,
                    errorDetails: result.errorDetails,
                    success: false
                });
            }
        } else {
            res.json({ message: 'Datos actualizados forzadamente', success: true });
        }
    } catch (error) {
        console.error('Error en /api/updateall-forced:', error);
        res.status(500).json({ 
            error: error.message,
            success: false,
            processed: 0,
            errors: 1
        });
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

// Endpoint para actualizar desde una fecha específica hasta hoy
app.get('/api/updatefrom/:date', async (req, res) => {
    const { date } = req.params;
    
    if (!validateDate(date)) {
        return res.status(400).json({ error: 'Fecha inválida. Debe estar en formato YYYY-MM-DD y ser anterior a hoy.' });
    }

    try {
        console.log(`Starting update from date: ${date}`);
        const result = await updateDataFromDate(date);
        
        if (result && typeof result === 'object') {
            if (result.success) {
                res.json({ 
                    message: result.message,
                    processed: result.processed,
                    errors: result.errors,
                    dateRange: result.dateRange,
                    processedDates: result.processedDates,
                    success: true
                });
            } else {
                res.status(500).json({ 
                    error: result.message,
                    processed: result.processed,
                    errors: result.errors,
                    errorDetails: result.errorDetails,
                    success: false
                });
            }
        } else {
            res.json({ message: `Datos actualizados desde ${date}`, success: true });
        }
    } catch (error) {
        console.error(`Error en /api/updatefrom/${date}:`, error);
        res.status(500).json({ 
            error: error.message,
            success: false,
            processed: 0,
            errors: 1
        });
    }
});

// Endpoint para limpiar feriados de la base de datos
app.get('/api/remove-holidays', async (req, res) => {
    try {
        console.log('Starting holiday removal process...');
        const result = await removeHolidaysFromDatabase();
        
        if (result && typeof result === 'object') {
            if (result.success) {
                res.json({ 
                    message: result.message,
                    deletedCount: result.deletedCount,
                    deletedDates: result.deletedDates,
                    success: true
                });
            } else {
                res.status(500).json({ 
                    error: result.message,
                    deletedCount: result.deletedCount,
                    success: false
                });
            }
        } else {
            res.json({ message: 'Holiday cleanup completed', success: true });
        }
    } catch (error) {
        console.error('Error en /api/remove-holidays:', error);
        res.status(500).json({ 
            error: error.message,
            success: false,
            deletedCount: 0
        });
    }
});

// Endpoint para probar la API de feriados chilenos
app.get('/api/test-holidays', async (req, res) => {
    try {
        console.log('Testing Chilean holidays API...');
        const holidays = await getChileanHolidays();
        
        res.json({
            success: true,
            message: 'Chilean holidays API test successful',
            holidaysCount: holidays.length,
            holidays: holidays.slice(0, 10), // Mostrar solo los primeros 10
            source: 'boostr.cl API'
        });
    } catch (error) {
        console.error('Chilean holidays API test failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch holidays from API'
        });
    }
});

// Endpoint de diagnóstico
app.get('/api/health', async (req, res) => {
    try {
        const diagnostics = {
            timestamp: new Date().toISOString(),
            nodeVersion: process.version,
            environment: process.env.NODE_ENV,
            databaseUrl: process.env.DATABASE_URL ? 'Present' : 'Missing',
            dependencies: {},
            scraper: {}
        };

        // Verificar dependencias críticas
        try {
            const axios = require('axios');
            diagnostics.dependencies.axios = 'OK';
        } catch (e) {
            diagnostics.dependencies.axios = `Error: ${e.message}`;
        }

        try {
            const ExcelJS = require('exceljs');
            diagnostics.dependencies.exceljs = 'OK';
        } catch (e) {
            diagnostics.dependencies.exceljs = `Error: ${e.message}`;
        }

        // Verificar AYRScraper
        try {
            const SimpleAYRScraper = require('./SimpleAYRScraper');
            const scraper = new SimpleAYRScraper();
            diagnostics.scraper.load = 'OK';
            diagnostics.scraper.baseUrl = scraper.baseUrl;
        } catch (e) {
            diagnostics.scraper.load = `Error: ${e.message}`;
        }

        // Verificar conexión a base de datos
        try {
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
            diagnostics.database = 'Connected';
        } catch (e) {
            diagnostics.database = `Error: ${e.message}`;
        }

        res.json({
            status: 'healthy',
            diagnostics
        });
    } catch (error) {
        console.error('Error in health check:', error);
        res.status(500).json({ 
            status: 'unhealthy',
            error: error.message,
            stack: error.stack
        });
    }
});

// Endpoint de test para scraper
app.get('/api/test-scraper', async (req, res) => {
    try {
        console.log('Testing simple scraper functionality...');
        
        const SimpleAYRScraper = require('./SimpleAYRScraper');
        const scraper = new SimpleAYRScraper();
        
        // Probar con una fecha reciente
        const testDate = '2024-12-13';
        console.log(`Testing simple scraper with date: ${testDate}`);
        
        const data = await scraper.scrapeAYRData(testDate);
        
        res.json({
            success: true,
            testDate,
            scrapedData: data,
            message: 'Simple scraper test successful'
        });
    } catch (error) {
        console.error('Simple scraper test failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

// Serve static files only in production
if (process.env.NODE_ENV === 'production') {
    const buildPath = path.join(__dirname, '../client/build');
    if (fs.existsSync(buildPath)) {
        // Serve static files from the React app
        app.use(express.static(buildPath));

        // Handle React routing, return all requests to React app
        app.get('*', (req, res) => {
            res.sendFile(path.join(buildPath, 'index.html'));
        });
    } else {
        console.warn('React build directory not found. Skipping static file serving.');
    }
} else {
    // In development, just serve the API
    app.get('/', (req, res) => {
        res.send('API Server running in development mode. Frontend should be running on port 3001.');
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