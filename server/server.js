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
const multer = require('multer');
const { pool, updateDataAndSave, updateSpecificDate, downloadExcel, updateDataAndSaveForced, updateDataFromDate, removeHolidaysFromDatabase, getChileanHolidays, saveOperacionesAcciones, getBalanceAcciones, procesarBalanceBase, getHistorialArchivos, eliminarArchivoHistorial } = require('./aportesyrescates.js');
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
    origin: function (origin, callback) {
        // En producción, permitir el mismo dominio (cuando cliente y servidor están juntos)
        // o el dominio de Railway si está configurado
        if (process.env.NODE_ENV === 'production') {
            // Permitir requests sin origin (mismo dominio) o desde Railway
            if (!origin || origin.includes('railway.app') || origin === process.env.RAILWAY_PUBLIC_DOMAIN) {
                callback(null, true);
            } else {
                callback(null, true); // Permitir todos en producción por ahora
            }
        } else {
            // En desarrollo, permitir localhost
            callback(null, true);
        }
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Disposition'], // Exponer Content-Disposition para que el frontend pueda leerlo
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

// Configuración de multer para subir archivos
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

// Endpoint para guardar operaciones de acciones (con archivo)
app.post('/api/save-operaciones', upload.single('archivo'), async (req, res) => {
    try {
        // Parsear operaciones desde JSON string si viene en FormData
        let operaciones, nombreArchivo;
        if (req.body.operaciones) {
            operaciones = typeof req.body.operaciones === 'string' 
                ? JSON.parse(req.body.operaciones) 
                : req.body.operaciones;
            nombreArchivo = req.body.nombreArchivo;
        } else {
            // Si viene como JSON directo (compatibilidad)
            operaciones = req.body.operaciones;
            nombreArchivo = req.body.nombreArchivo;
        }
        
        if (!Array.isArray(operaciones)) {
            return res.status(400).json({ error: 'Las operaciones deben ser un array' });
        }
        
        // Obtener el buffer del archivo si está presente
        const archivoBuffer = req.file ? req.file.buffer : null;
        
        const result = await saveOperacionesAcciones(operaciones, 'csv', nombreArchivo || null, archivoBuffer);
        res.json(result);
    } catch (error) {
        console.error('Error al guardar operaciones:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para obtener balance de acciones
app.get('/api/balance-acciones', async (req, res) => {
    try {
        const result = await getBalanceAcciones();
        // Si el resultado tiene la nueva estructura con balance y nemotecnicosNeteados
        if (result.balance && result.nemotecnicosNeteados !== undefined) {
            res.json(result);
        } else {
            // Compatibilidad con formato anterior
            res.json({
                balance: result,
                nemotecnicosNeteados: []
            });
        }
    } catch (error) {
        console.error('Error al obtener balance:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para subir balance base desde Excel
app.post('/api/upload-balance-base', upload.single('archivo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se recibió ningún archivo' });
        }
        
        const nombreArchivo = req.file.originalname || 'balance_base.xlsx';
        const result = await procesarBalanceBase(req.file.buffer, nombreArchivo);
        res.json(result);
    } catch (error) {
        console.error('Error al procesar balance base:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para obtener historial de archivos
app.get('/api/historial-archivos', async (req, res) => {
    try {
        const historial = await getHistorialArchivos();
        res.json(historial);
    } catch (error) {
        console.error('Error al obtener historial:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para eliminar un archivo del historial y sus operaciones
app.delete('/api/historial-archivos/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        
        const result = await eliminarArchivoHistorial(id);
        res.json(result);
    } catch (error) {
        console.error('Error al eliminar archivo del historial:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para actualizar precio de cierre
app.post('/api/actualizar-precio-cierre', async (req, res) => {
    try {
        const { nemotecnico, precioCierre } = req.body;
        
        if (!nemotecnico || precioCierre === undefined || precioCierre === null) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos: nemotecnico y precioCierre' });
        }
        
        // Actualizar el precio de cierre de todas las operaciones de este nemotécnico
        // que tienen precio_cierre NULL o que sean las más recientes
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Actualizar precio_cierre en todas las operaciones del nemotécnico que sean de tipo Compra
            // y que tengan precio_cierre NULL (para mantener consistencia)
            const updateResult = await client.query(`
                UPDATE operaciones_acciones 
                SET precio_cierre = $1
                WHERE nemotecnico = $2 
                  AND tipo_operacion = 'Compra'
                  AND (precio_cierre IS NULL OR precio_cierre = 0)
            `, [precioCierre, nemotecnico.toUpperCase()]);
            
            await client.query('COMMIT');
            
            res.json({ 
                success: true, 
                operacionesActualizadas: updateResult.rowCount,
                nemotecnico: nemotecnico.toUpperCase(),
                precioCierre: precioCierre
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error al actualizar precio de cierre:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para actualizar todos los campos de una fila del balance
app.post('/api/actualizar-fila-balance', async (req, res) => {
    try {
        const { nemotecnico, existencia, precioCompra, precioCierre } = req.body;
        
        if (!nemotecnico) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos: nemotecnico' });
        }
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Crear tabla de ajustes manuales si no existe
            await client.query(`
                CREATE TABLE IF NOT EXISTS ajustes_manuales_balance (
                    id SERIAL PRIMARY KEY,
                    nemotecnico VARCHAR(20) NOT NULL UNIQUE,
                    existencia NUMERIC(18, 3),
                    precio_compra NUMERIC(18, 2),
                    precio_cierre NUMERIC(18, 2),
                    valorizacion_compra NUMERIC(18, 2),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            // Actualizar o insertar ajuste manual (sin valorizacion_compra porque es calculado)
            await client.query(`
                INSERT INTO ajustes_manuales_balance 
                (nemotecnico, existencia, precio_compra, precio_cierre)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (nemotecnico) 
                DO UPDATE SET
                    existencia = COALESCE(EXCLUDED.existencia, ajustes_manuales_balance.existencia),
                    precio_compra = COALESCE(EXCLUDED.precio_compra, ajustes_manuales_balance.precio_compra),
                    precio_cierre = COALESCE(EXCLUDED.precio_cierre, ajustes_manuales_balance.precio_cierre),
                    updated_at = CURRENT_TIMESTAMP
            `, [
                nemotecnico.toUpperCase(),
                existencia !== undefined ? existencia : null,
                precioCompra !== undefined ? precioCompra : null,
                precioCierre !== undefined ? precioCierre : null
            ]);
            
            // También actualizar precio_cierre en operaciones_acciones si se proporciona
            if (precioCierre !== undefined && precioCierre !== null) {
                await client.query(`
                    UPDATE operaciones_acciones 
                    SET precio_cierre = $1
                    WHERE nemotecnico = $2 
                      AND tipo_operacion = 'Compra'
                      AND (precio_cierre IS NULL OR precio_cierre = 0)
                `, [precioCierre, nemotecnico.toUpperCase()]);
            }
            
            await client.query('COMMIT');
            
            res.json({ 
                success: true,
                nemotecnico: nemotecnico.toUpperCase()
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error al actualizar fila del balance:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para eliminar un ajuste manual del balance
app.delete('/api/ajuste-manual-balance/:nemotecnico', async (req, res) => {
    try {
        const { nemotecnico } = req.params;
        
        if (!nemotecnico) {
            return res.status(400).json({ error: 'Falta el parámetro nemotecnico' });
        }
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Verificar si existe el ajuste manual
            const checkResult = await client.query(
                'SELECT id FROM ajustes_manuales_balance WHERE nemotecnico = $1',
                [nemotecnico.toUpperCase()]
            );
            
            if (checkResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'No se encontró un ajuste manual para este nemotécnico' });
            }
            
            // Eliminar el ajuste manual
            await client.query(
                'DELETE FROM ajustes_manuales_balance WHERE nemotecnico = $1',
                [nemotecnico.toUpperCase()]
            );
            
            await client.query('COMMIT');
            
            res.json({ 
                success: true,
                nemotecnico: nemotecnico.toUpperCase(),
                message: 'Ajuste manual eliminado exitosamente'
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error al eliminar ajuste manual:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para descargar CSV transformado a FINIX
app.get('/api/descargar-csv-transformado/:id', async (req, res) => {
    try {
        const historialId = parseInt(req.params.id);
        if (isNaN(historialId)) {
            return res.status(400).json({ error: 'ID de historial inválido' });
        }

        const { generarExcelTransformado } = require('./aportesyrescates');
        const excelBuffer = await generarExcelTransformado(historialId);

        // Obtener fecha del archivo del historial o de las operaciones para generar el nombre
        const client = await pool.connect();
        try {
            // Primero intentar obtener fecha_archivo del historial
            const historialResult = await client.query(
                'SELECT fecha_archivo, nombre_archivo FROM historial_archivos WHERE id = $1',
                [historialId]
            );
            
            console.log(`Buscando fecha para historial ${historialId}:`, historialResult.rows[0]);
            
            let fechaArchivo = null;
            if (historialResult.rows.length > 0) {
                const row = historialResult.rows[0];
                if (row.fecha_archivo) {
                    fechaArchivo = row.fecha_archivo;
                    console.log(`Fecha obtenida del historial: ${fechaArchivo} (tipo: ${typeof fechaArchivo}, valor: ${JSON.stringify(fechaArchivo)})`);
                } else {
                    console.log(`fecha_archivo es null en historial ${historialId}, buscando en operaciones...`);
                    // Si no hay fecha en el historial, obtenerla de la primera operación
                    const operacionResult = await client.query(
                        'SELECT fecha FROM operaciones_acciones WHERE historial_id = $1 ORDER BY fecha ASC LIMIT 1',
                        [historialId]
                    );
                    if (operacionResult.rows.length > 0 && operacionResult.rows[0].fecha) {
                        fechaArchivo = operacionResult.rows[0].fecha;
                        console.log(`Fecha obtenida de operación: ${fechaArchivo} (tipo: ${typeof fechaArchivo})`);
                    } else {
                        console.log(`No se encontró fecha en operaciones para historial ${historialId}`);
                    }
                }
            } else {
                console.log(`No se encontró historial con id ${historialId}`);
            }
            
            let filename = 'Control Operaciones Diarias FIP.xls';
            if (fechaArchivo) {
                // Parsear la fecha (PostgreSQL puede devolverla como string 'YYYY-MM-DD' o como Date)
                let fecha;
                if (fechaArchivo instanceof Date) {
                    fecha = fechaArchivo;
                } else if (typeof fechaArchivo === 'string') {
                    // Si viene como string, puede ser 'YYYY-MM-DD' o ISO string
                    if (fechaArchivo.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        // Formato 'YYYY-MM-DD', agregar hora para evitar problemas de timezone
                        fecha = new Date(fechaArchivo + 'T00:00:00');
                    } else {
                        // Intentar parsear como ISO string
                        fecha = new Date(fechaArchivo);
                    }
                } else {
                    fecha = new Date(fechaArchivo);
                }
                
                if (!isNaN(fecha.getTime())) {
                    // Usar métodos locales para obtener día, mes y año correctos
                    const day = String(fecha.getDate()).padStart(2, '0');
                    const month = String(fecha.getMonth() + 1).padStart(2, '0');
                    const year = fecha.getFullYear();
                    filename = `Control Operaciones Diarias FIP ${day}.${month}.${year}.xls`;
                    console.log(`Nombre de archivo generado: ${filename} (fecha original: ${fechaArchivo}, fecha parseada: ${fecha.toISOString()})`);
                } else {
                    console.log(`Fecha inválida para historial ${historialId}: ${fechaArchivo} (tipo: ${typeof fechaArchivo})`);
                }
            } else {
                console.log(`No se encontró fecha_archivo para historial ${historialId}`);
            }
            
            // Codificar el nombre del archivo para el header Content-Disposition
            // Usar encodeURIComponent para caracteres especiales y espacios
            const encodedFilename = encodeURIComponent(filename);
            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`);
            console.log(`Enviando archivo con nombre: ${filename}, header: attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`);
            res.send(excelBuffer);
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error al generar CSV transformado:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para descargar archivo original del historial
app.get('/api/descargar-archivo-original/:id', async (req, res) => {
    try {
        const historialId = parseInt(req.params.id);
        if (isNaN(historialId)) {
            return res.status(400).json({ error: 'ID de historial inválido' });
        }

        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT nombre_archivo, archivo_original, tipo FROM historial_archivos WHERE id = $1',
                [historialId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Archivo no encontrado en el historial' });
            }

            const { nombre_archivo, archivo_original, tipo } = result.rows[0];

            if (!archivo_original) {
                return res.status(404).json({ error: 'El archivo original no está disponible' });
            }

            // Determinar el Content-Type según el tipo de archivo
            let contentType = 'application/octet-stream';
            if (nombre_archivo.endsWith('.csv')) {
                contentType = 'text/csv';
            } else if (nombre_archivo.endsWith('.xlsx')) {
                contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            } else if (nombre_archivo.endsWith('.xls')) {
                contentType = 'application/vnd.ms-excel';
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${nombre_archivo}"`);
            res.send(archivo_original);
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error al descargar archivo original:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint temporal para aplicar migración de tipos numéricos
app.post('/api/migrate-numeric-types', async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            await client.query(`
                ALTER TABLE operaciones_acciones 
                ALTER COLUMN cantidad TYPE NUMERIC(18, 3),
                ALTER COLUMN precio TYPE NUMERIC(18, 2),
                ALTER COLUMN monto TYPE NUMERIC(18, 2)
            `);
            
            await client.query('COMMIT');
            res.json({ success: true, message: 'Migración aplicada correctamente' });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error al aplicar migración:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve static files only in production - DEBE estar después de todas las rutas de API
if (process.env.NODE_ENV === 'production') {
    const buildPath = path.join(__dirname, '../client/build');
    if (fs.existsSync(buildPath)) {
        // Serve static files from the React app
        app.use(express.static(buildPath));

        // Handle React routing, return all requests to React app
        // IMPORTANTE: Solo capturar rutas que NO empiecen con /api
        app.get('*', (req, res) => {
            // Si la ruta empieza con /api, no debería llegar aquí (debería haber sido manejada antes)
            if (req.path.startsWith('/api')) {
                return res.status(404).json({ error: 'API endpoint not found' });
            }
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