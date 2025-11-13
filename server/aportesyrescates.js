const axios = require('axios');
const { getDay, format, addDays, subDays, isSameMonth, getDate, parseISO, addHours } = require('date-fns');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const SimpleAYRScraper = require('./SimpleAYRScraper'); // Usar el scraper simple

// Configuración de la conexión a PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false
});

// Función para verificar la conexión a la base de datos
const checkDatabaseConnection = async () => {
    try {
        const client = await pool.connect();
        client.release();
        console.log('Conexión a la base de datos establecida correctamente');
        return true;
    } catch (error) {
        console.error('Error al conectar con la base de datos:', error);
        return false;
    }
};

// Verificar la conexión al iniciar
checkDatabaseConnection();

// Usar el scraper simple directamente en lugar del complejo
const getDataFromSource = async (fecha) => {
    try {
        console.log(`Scraping data with simple scraper for date: ${fecha}`);
        
        // Verificar que SimpleAYRScraper se pueda importar correctamente
        const scraper = new SimpleAYRScraper();
        
        // Añadir timeout para evitar que el proceso se cuelgue
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Scraping timeout after 30 seconds')), 30000);
        });
        
        const scrapePromise = scraper.scrapeAYRData(fecha);
        const data = await Promise.race([scrapePromise, timeoutPromise]);
        
        console.log(`Successfully scraped data for ${fecha}:`, data);
        
        // Validar que los datos sean válidos
        if (!data || typeof data.flujo_aportes !== 'number' || typeof data.flujo_rescates !== 'number') {
            console.error(`Invalid data structure for ${fecha}:`, data);
            return null;
        }
        
        return data;
    } catch (error) {
        console.error(`Error scraping data for ${fecha}:`, error.message);
        console.error('Stack trace:', error.stack);
        
        // En caso de error, devolver valores cero para no romper el flujo
        if (error.message.includes('timeout') || error.message.includes('HTTP') || error.message.includes('network')) {
            console.log(`Returning zero values for ${fecha} due to scraping error`);
            return {
                fecha: fecha,
                flujo_aportes: 0,
                flujo_rescates: 0
            };
        }
        
        return null;
    }
};

const saveDataToDatabase = async (data) => {
    if (!Array.isArray(data)) {
        throw new TypeError("Data is not iterable");
    }
    
    if (data.length === 0) {
        console.log("No data to save");
        return;
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("Started database transaction");

        for (const entry of data) {
            const entryDate = parseISO(entry.fecha);
            const dayOfWeek = getDay(entryDate);
            const dayOfMonth = getDate(entryDate);
            
            console.log(`Procesando entrada para ${entry.fecha}, día: ${dayOfMonth}, día de la semana: ${dayOfWeek}`);
            
            // Saltar fines de semana
            if (dayOfWeek === 6 || dayOfWeek === 0) {
                console.log(`Saltando ${entry.fecha} porque es fin de semana`);
                continue;
            }

            let acumulado_aportes = 0;
            let acumulado_rescates = 0;

            // Reiniciar acumulados si estamos en el primer día de un nuevo mes
            if (dayOfMonth === 1) {
                acumulado_aportes = 0;
                acumulado_rescates = 0;
                console.log(`Reiniciando acumulados para ${entry.fecha} (primer día del mes)`);
            } else {
                // Consultar el último registro del mismo mes para obtener los valores acumulados actuales
                const result = await client.query(
                    `SELECT * FROM daily_statistics 
                     WHERE fecha < $1 
                     AND EXTRACT(YEAR FROM fecha) = EXTRACT(YEAR FROM $1::date)
                     AND EXTRACT(MONTH FROM fecha) = EXTRACT(MONTH FROM $1::date)
                     ORDER BY fecha DESC 
                     LIMIT 1`, 
                    [entry.fecha]
                );
                
                if (result.rows.length > 0) {
                    acumulado_aportes = parseFloat(result.rows[0].acumulado_aportes) || 0;
                    acumulado_rescates = parseFloat(result.rows[0].acumulado_rescates) || 0;
                    console.log(`Usando acumulados previos: aportes=${acumulado_aportes}, rescates=${acumulado_rescates}`);
                } else {
                    console.log(`No se encontraron registros previos para ${entry.fecha} en el mismo mes`);
                }
            }

            // Actualizar los acumulados con los nuevos datos de flujo_aportes y flujo_rescates
            acumulado_aportes += entry.flujo_aportes;
            acumulado_rescates += entry.flujo_rescates;

            console.log(`Nuevos valores: flujo_aportes=${entry.flujo_aportes}, flujo_rescates=${entry.flujo_rescates}`);
            console.log(`Acumulados actualizados: aportes=${acumulado_aportes}, rescates=${acumulado_rescates}`);

            // Insertar o actualizar los datos en la tabla daily_statistics
            const insertResult = await client.query(`
                INSERT INTO daily_statistics (fecha, flujo_aportes, flujo_rescates, neto_aportes_rescates, acumulado_aportes, acumulado_rescates, neto_acumulado) 
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (fecha) DO UPDATE SET
                flujo_aportes = EXCLUDED.flujo_aportes,
                flujo_rescates = EXCLUDED.flujo_rescates,
                neto_aportes_rescates = EXCLUDED.neto_aportes_rescates,
                acumulado_aportes = EXCLUDED.acumulado_aportes,
                acumulado_rescates = EXCLUDED.acumulado_rescates,
                neto_acumulado = EXCLUDED.neto_acumulado
                RETURNING *`,
                [
                    entry.fecha, 
                    entry.flujo_aportes, 
                    entry.flujo_rescates, 
                    entry.flujo_aportes - entry.flujo_rescates,
                    acumulado_aportes, 
                    acumulado_rescates, 
                    acumulado_aportes - acumulado_rescates
                ]
            );

            console.log(`Registro guardado/actualizado para ${entry.fecha}:`, insertResult.rows[0]);
        }

        await client.query('COMMIT');
        console.log("Transaction committed successfully");
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Transaction rolled back due to error:", err.message);
        throw err;
    } finally {
        client.release();
    }
};

const updateDataAndSave = async () => {
    const client = await pool.connect();
    try {
        console.log("Starting updateDataAndSave process...");
        
        // Verificar que el scraper funcione antes de proceder
        try {
            const scraper = new SimpleAYRScraper();
            console.log("SimpleAYRScraper loaded successfully");
        } catch (scraperError) {
            console.error("Failed to load SimpleAYRScraper:", scraperError.message);
            throw new Error(`Scraper initialization failed: ${scraperError.message}`);
        }
        
        // Determinar la fecha de inicio y de fin
        const startDate = new Date('2024-01-01');
        const endDate = subDays(new Date(), 1); // Fecha de fin es el día anterior a la fecha actual
        
        console.log(`Date range: ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);

        // Obtener todas las fechas registradas
        const result = await client.query('SELECT fecha FROM daily_statistics ORDER BY fecha');
        const registeredDates = new Set(result.rows.map(row => {
            // PostgreSQL devuelve fechas como Date objects, no strings
            const dateObj = row.fecha instanceof Date ? row.fecha : new Date(row.fecha);
            return format(dateObj, 'yyyy-MM-dd');
        }));
        
        console.log(`Found ${registeredDates.size} dates already registered in database`);

        let currentDate = startDate;
        const datesToProcess = [];

        while (currentDate <= endDate) {
            const day = getDay(currentDate);
            const formattedDate = format(currentDate, 'yyyy-MM-dd');

            // Si el día no es sábado (6) o domingo (0) y la fecha no está registrada, agregarla a la lista
            if (day !== 0 && day !== 6 && !registeredDates.has(formattedDate)) {
                datesToProcess.push(formattedDate);
            }

            currentDate = addDays(currentDate, 1);
        }

        console.log(`Found ${datesToProcess.length} dates to process:`, datesToProcess.slice(0, 10), datesToProcess.length > 10 ? '...' : '');

        if (datesToProcess.length === 0) {
            console.log('No dates to process. All data is up to date.');
            return { success: true, message: 'All data is up to date', processed: 0, errors: 0 };
        }

        // Limitar el número de fechas a procesar en una sola ejecución para evitar timeouts
        const maxDatesToProcess = 10;
        const limitedDates = datesToProcess.slice(0, maxDatesToProcess);
        
        if (datesToProcess.length > maxDatesToProcess) {
            console.log(`Limiting to ${maxDatesToProcess} dates to avoid timeout. Remaining ${datesToProcess.length - maxDatesToProcess} will be processed in next run.`);
        }

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // Procesar las fechas en orden con reintentos
        for (const date of limitedDates) {
            console.log(`\n--- Processing ${date} (${successCount + errorCount + 1}/${limitedDates.length}) ---`);
            
            let retryCount = 0;
            const maxRetries = 2; // Reducir reintentos para evitar timeouts
            let success = false;

            while (retryCount < maxRetries && !success) {
                try {
                    if (retryCount > 0) {
                        console.log(`Retry attempt ${retryCount} for ${date}`);
                        // Esperar antes de reintentar (backoff exponencial)
                        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
                    }

                    console.log(`Fetching data for ${date}`);
                    const data = await getDataFromSource(date);
                    
                    if (data) {
                        // Ajustar la fecha para evitar problemas de timezone
                        data.fecha = format(addHours(new Date(data.fecha), 12), 'yyyy-MM-dd');
                        
                        console.log(`Saving data for ${date}:`, data);
                        await saveDataToDatabase([data]);
                        
                        console.log(`✅ Successfully processed ${date}`);
                        successCount++;
                        success = true;
                    } else {
                        throw new Error(`No data received for ${date}`);
                    }
                } catch (err) {
                    retryCount++;
                    console.error(`❌ Error processing ${date} (attempt ${retryCount}):`, err.message);
                    
                    if (retryCount >= maxRetries) {
                        errors.push({ date, error: err.message });
                        errorCount++;
                    }
                }
            }

            // Pausa entre fechas para evitar sobrecargar el servidor
            if (limitedDates.indexOf(date) < limitedDates.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // Aumentar pausa
            }
        }

        // Resumen final
        console.log(`\n=== PROCESS COMPLETED ===`);
        console.log(`Total dates processed: ${limitedDates.length}`);
        console.log(`Successful: ${successCount}`);
        console.log(`Failed: ${errorCount}`);
        
        if (errors.length > 0) {
            console.log(`\nErrors encountered:`);
            errors.forEach(({ date, error }) => {
                console.log(`  ${date}: ${error}`);
            });
        }

        console.log('Daily data update process finished');

        return {
            success: true,
            message: `Processed ${successCount} dates successfully, ${errorCount} failed`,
            processed: successCount,
            errors: errorCount,
            errorDetails: errors
        };

    } catch (err) {
        console.error('Fatal error in updateDataAndSave:', err.message);
        console.error('Stack trace:', err.stack);
        
        // No lanzar el error, devolver información sobre el fallo
        return {
            success: false,
            message: `Fatal error: ${err.message}`,
            processed: 0,
            errors: 1,
            errorDetails: [{ date: 'general', error: err.message }]
        };
    } finally {
        client.release();
    }
};

const updateSpecificDate = async (date) => {
    try {
        const data = await getDataFromSource(date);
        if (data) {
            data.fecha = format(addHours(new Date(data.fecha), 12), 'yyyy-MM-dd'); // Ajusta la fecha
            await saveDataToDatabase([data]);
            console.log(`Datos actualizados para la fecha ${date}`);
        } else {
            console.log(`No se pudieron obtener datos para la fecha ${date}`);
        }
    } catch (err) {
        console.error(`Error actualizando datos para la fecha ${date}:`, err.message);
    }
};

const downloadExcel = async (res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM daily_statistics ORDER BY fecha');
        const rows = result.rows;
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Aportes y Rescates');

        worksheet.columns = [
            { header: 'Fecha', key: 'fecha', width: 15 },
            { header: 'Flujo Aportes', key: 'flujo_aportes', width: 15 },
            { header: 'Flujo Rescates', key: 'flujo_rescates', width: 15 },
            { header: 'Neto Aportes-Rescates', key: 'neto_aportes_rescates', width: 20 },
            { header: 'Acumulado Aportes', key: 'acumulado_aportes', width: 20 },
            { header: 'Acumulado Rescates', key: 'acumulado_rescates', width: 20 },
            { header: 'Neto Acumulado', key: 'neto_acumulado', width: 15 }
        ];

        rows.forEach(row => {
            worksheet.addRow({
                fecha: format(addHours(new Date(row.fecha), 12), 'dd-MM-yyyy'), // Ajusta la fecha
                flujo_aportes: row.flujo_aportes,
                flujo_rescates: row.flujo_rescates,
                neto_aportes_rescates: row.neto_aportes_rescates,
                acumulado_aportes: row.acumulado_aportes,
                acumulado_rescates: row.acumulado_rescates,
                neto_acumulado: row.neto_acumulado
            });
        });
        
        // Formatear columnas B a H como números
        ['B', 'C', 'D', 'E', 'F', 'G'].forEach(col => {
            worksheet.getColumn(col).numFmt = '#,##0';
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=Aportes_y_Rescates.xlsx');
            await workbook.xlsx.write(res);
            res.end();
        } catch (err) {
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
        }
}

const updateDataAndSaveForced = async () => {
    const client = await pool.connect();
    try {
        console.log("Starting SMART FORCED updateDataAndSave process...");
        
        // Verificar que el scraper funcione antes de proceder
        try {
            const scraper = new SimpleAYRScraper();
            console.log("SimpleAYRScraper loaded successfully");
        } catch (scraperError) {
            console.error("Failed to load SimpleAYRScraper:", scraperError.message);
            throw new Error(`Scraper initialization failed: ${scraperError.message}`);
        }
        
        // Encontrar la primera fecha (más antigua) que tenga valores en 0
        const firstZeroResult = await client.query(`
            SELECT fecha FROM daily_statistics 
            WHERE (flujo_aportes = 0 OR flujo_rescates = 0) 
            ORDER BY fecha ASC 
            LIMIT 1
        `);
        
        let startDate;
        if (firstZeroResult.rows.length > 0) {
            // Si hay fechas con 0, empezar desde esa fecha
            startDate = new Date(firstZeroResult.rows[0].fecha);
            console.log(`Found first date with zero values: ${format(startDate, 'yyyy-MM-dd')}`);
        } else {
            // Si no hay fechas con 0, verificar si hay fechas faltantes desde hace una semana
            startDate = subDays(new Date(), 7);
            console.log(`No zero values found, checking for missing dates from: ${format(startDate, 'yyyy-MM-dd')}`);
        }
        
        const endDate = subDays(new Date(), 1); // Fecha de fin es el día anterior a la fecha actual
        
        console.log(`Smart date range: ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);

        // Obtener todas las fechas con valores en 0 en el rango inteligente
        const result = await client.query(`
            SELECT fecha FROM daily_statistics 
            WHERE (flujo_aportes = 0 OR flujo_rescates = 0) 
            AND fecha >= $1 AND fecha <= $2
            ORDER BY fecha ASC
        `, [format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd')]);
        
        const zeroValueDates = new Set(result.rows.map(row => {
            const dateObj = row.fecha instanceof Date ? row.fecha : new Date(row.fecha);
            return format(dateObj, 'yyyy-MM-dd');
        }));
        
        console.log(`Found ${zeroValueDates.size} dates with zero values in smart range`);
        if (zeroValueDates.size > 0) {
            console.log('Sample zero dates:', Array.from(zeroValueDates).slice(0, 5));
        }

        // También verificar fechas faltantes en el rango inteligente
        const allRegisteredResult = await client.query(
            'SELECT fecha FROM daily_statistics WHERE fecha >= $1 AND fecha <= $2 ORDER BY fecha',
            [format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd')]
        );
        const registeredDates = new Set(allRegisteredResult.rows.map(row => {
            const dateObj = row.fecha instanceof Date ? row.fecha : new Date(row.fecha);
            return format(dateObj, 'yyyy-MM-dd');
        }));

        let currentDate = startDate;
        const datesToProcess = [];

        while (currentDate <= endDate) {
            const day = getDay(currentDate);
            const formattedDate = format(currentDate, 'yyyy-MM-dd');

            // Procesar si: 1) no es fin de semana Y 2) (no está registrado O tiene valores en 0)
            if (day !== 0 && day !== 6) {
                if (!registeredDates.has(formattedDate) || zeroValueDates.has(formattedDate)) {
                    datesToProcess.push(formattedDate);
                }
            }

            currentDate = addDays(currentDate, 1);
        }

        console.log(`Smart processing found ${datesToProcess.length} dates to update`);
        console.log('Dates to process:', datesToProcess.slice(0, 10), datesToProcess.length > 10 ? `... and ${datesToProcess.length - 10} more` : '');

        if (datesToProcess.length === 0) {
            console.log('No dates to process in smart range. All recent data is up to date.');
            return { success: true, message: 'No hay fechas con valores 0 que actualizar', processed: 0, errors: 0 };
        }

        // Procesar todas las fechas encontradas (ya es un rango inteligente, no necesitamos limitar tanto)
        const maxDatesToProcess = Math.min(25, datesToProcess.length);
        const limitedDates = datesToProcess.slice(0, maxDatesToProcess);
        
        if (datesToProcess.length > maxDatesToProcess) {
            console.log(`Processing ${maxDatesToProcess} dates in this run. Remaining ${datesToProcess.length - maxDatesToProcess} will be processed in next run.`);
        }

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // Procesar las fechas en orden con reintentos
        for (const date of limitedDates) {
            console.log(`\n--- SMART Processing ${date} (${successCount + errorCount + 1}/${limitedDates.length}) ---`);
            
            let retryCount = 0;
            const maxRetries = 2;
            let success = false;

            while (retryCount < maxRetries && !success) {
                try {
                    if (retryCount > 0) {
                        console.log(`Retry attempt ${retryCount} for ${date}`);
                        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
                    }

                    console.log(`Fetching data for ${date}`);
                    const data = await getDataFromSource(date);
                    
                    if (data) {
                        data.fecha = format(addHours(new Date(data.fecha), 12), 'yyyy-MM-dd');
                        
                        console.log(`Saving/updating data for ${date}:`, data);
                        await saveDataToDatabase([data]);
                        
                        console.log(`✅ Successfully processed ${date}`);
                        successCount++;
                        success = true;
                    } else {
                        throw new Error(`No data received for ${date}`);
                    }
                } catch (err) {
                    retryCount++;
                    console.error(`❌ Error processing ${date} (attempt ${retryCount}):`, err.message);
                    
                    if (retryCount >= maxRetries) {
                        errors.push({ date, error: err.message });
                        errorCount++;
                    }
                }
            }

            // Pausa entre fechas
            if (limitedDates.indexOf(date) < limitedDates.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Resumen final
        console.log(`\n=== SMART FORCED PROCESS COMPLETED ===`);
        console.log(`Total dates processed: ${limitedDates.length}`);
        console.log(`Successful: ${successCount}`);
        console.log(`Failed: ${errorCount}`);
        
        if (errors.length > 0) {
            console.log(`\nErrors encountered:`);
            errors.forEach(({ date, error }) => {
                console.log(`  ${date}: ${error}`);
            });
        }

        console.log('SMART forced daily data update process finished');

        return {
            success: true,
            message: `Actualización inteligente: ${successCount} fechas procesadas exitosamente, ${errorCount} fallaron`,
            processed: successCount,
            errors: errorCount,
            errorDetails: errors,
            dateRange: `${format(startDate, 'yyyy-MM-dd')} a ${format(endDate, 'yyyy-MM-dd')}`
        };

    } catch (err) {
        console.error('Fatal error in updateDataAndSaveForced:', err.message);
        console.error('Stack trace:', err.stack);
        
        return {
            success: false,
            message: `Fatal error: ${err.message}`,
            processed: 0,
            errors: 1,
            errorDetails: [{ date: 'general', error: err.message }]
        };
    } finally {
        client.release();
    }
};

const updateDataFromDate = async (fromDate) => {
    const client = await pool.connect();
    try {
        console.log(`Starting PARALLEL updateDataFromDate process from: ${fromDate}`);
        
        // Verificar que el scraper funcione antes de proceder
        try {
            const scraper = new SimpleAYRScraper();
            console.log("SimpleAYRScraper loaded successfully");
        } catch (scraperError) {
            console.error("Failed to load SimpleAYRScraper:", scraperError.message);
            throw new Error(`Scraper initialization failed: ${scraperError.message}`);
        }

        // Usar la fecha proporcionada directamente
        const startDate = new Date(fromDate);
        const endDate = subDays(new Date(), 1); // Hasta ayer
        
        console.log(`📅 PARALLEL Processing range: ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);

        // Pre-cargar feriados una sola vez para mejor performance
        console.log('🗓️ Pre-loading Chilean holidays...');
        const holidays = await getChileanHolidays();
        console.log(`✅ Loaded ${holidays.length} holidays from API`);

        // Función helper para verificar feriados sin hacer llamadas repetidas a la API
        const isHoliday = (date) => {
            const formattedDate = format(new Date(date), 'MM-dd');
            return holidays.some(holiday => holiday.date === formattedDate);
        };

        // Generar todas las fechas hábiles a procesar
        let currentDate = startDate;
        const datesToProcess = [];

        while (currentDate <= endDate) {
            const day = getDay(currentDate);
            const formattedDate = format(currentDate, 'yyyy-MM-dd');

            // Solo días hábiles (lunes a viernes) Y que no sean feriados chilenos
            if (day !== 0 && day !== 6 && !isHoliday(currentDate)) {
                datesToProcess.push(formattedDate);
            } else if (isHoliday(currentDate)) {
                const holidayName = holidays.find(h => h.date === format(currentDate, 'MM-dd'))?.name || 'Feriado';
                console.log(`🗓️ Skipping holiday: ${formattedDate} (${holidayName})`);
            }

            currentDate = addDays(currentDate, 1);
        }

        console.log(`🎯 Found ${datesToProcess.length} business days to process`);
        
        if (datesToProcess.length === 0) {
            console.log('✅ No dates to process - all data is up to date!');
            return { 
                success: true, 
                message: 'No hay fechas válidas en el rango seleccionado', 
                processed: 0, 
                errors: 0,
                upToDate: true 
            };
        }

        console.log(`📋 Processing dates: ${datesToProcess[0]} ... ${datesToProcess[datesToProcess.length - 1]}`);

        // PROCESAMIENTO EN PARALELO
        const parallelBatchSize = 15; // Procesar 15 fechas simultáneamente
        const results = [];
        let totalProcessed = 0;
        let totalErrors = 0;

        // Función para procesar una fecha individual
        const processDate = async (date) => {
            const maxRetries = 2;
            let attempt = 0;
            
            while (attempt < maxRetries) {
                try {
                    attempt++;
                    console.log(`🔄 [${date}] Processing (attempt ${attempt})`);
                    
                    const data = await getDataFromSource(date);
                    
                    if (data) {
                        data.fecha = format(addHours(new Date(data.fecha), 12), 'yyyy-MM-dd');
                        await saveDataToDatabase([data]);
                        
                        console.log(`✅ [${date}] Success: ₱${data.flujo_aportes.toLocaleString()} / ₱${data.flujo_rescates.toLocaleString()}`);
                        return { success: true, date, data };
                    } else {
                        throw new Error(`No data received`);
                    }
                } catch (error) {
                    console.log(`❌ [${date}] Attempt ${attempt} failed: ${error.message}`);
                    
                    if (attempt >= maxRetries) {
                        console.error(`💥 [${date}] Final failure after ${maxRetries} attempts`);
                        return { success: false, date, error: error.message };
                    }
                    
                    // Pausa antes de reintentar
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        };

        // Procesar en lotes paralelos
        for (let i = 0; i < datesToProcess.length; i += parallelBatchSize) {
            const currentBatch = datesToProcess.slice(i, i + parallelBatchSize);
            const batchNumber = Math.floor(i / parallelBatchSize) + 1;
            const totalBatches = Math.ceil(datesToProcess.length / parallelBatchSize);
            
            console.log(`\n🚀 === PARALLEL BATCH ${batchNumber}/${totalBatches} ===`);
            console.log(`📦 Processing ${currentBatch.length} dates simultaneously: ${currentBatch[0]} to ${currentBatch[currentBatch.length - 1]}`);
            
            const batchStartTime = Date.now();

            // Procesar todas las fechas del lote EN PARALELO
            const batchPromises = currentBatch.map(date => processDate(date));
            const batchResults = await Promise.all(batchPromises);

            // Analizar resultados del lote
            const batchSuccess = batchResults.filter(r => r.success).length;
            const batchErrors = batchResults.filter(r => !r.success).length;
            const batchTime = ((Date.now() - batchStartTime) / 1000).toFixed(1);

            totalProcessed += batchSuccess;
            totalErrors += batchErrors;
            results.push(...batchResults);

            console.log(`⚡ BATCH ${batchNumber} COMPLETED in ${batchTime}s:`);
            console.log(`   ✅ Success: ${batchSuccess}/${currentBatch.length}`);
            console.log(`   ❌ Errors: ${batchErrors}/${currentBatch.length}`);
            console.log(`   📊 Overall progress: ${totalProcessed + totalErrors}/${datesToProcess.length} (${((totalProcessed + totalErrors) / datesToProcess.length * 100).toFixed(1)}%)`);

            // Pausa más corta entre lotes (solo 3 segundos)
            if (i + parallelBatchSize < datesToProcess.length) {
                console.log(`⏸️  Brief pause (3s) before next batch...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        // Análisis final
        const successRate = ((totalProcessed / datesToProcess.length) * 100).toFixed(1);
        const errorDetails = results.filter(r => !r.success).map(r => ({ date: r.date, error: r.error }));

        console.log(`\n🎉 === PARALLEL PROCESSING COMPLETED ===`);
        console.log(`📈 Total dates: ${datesToProcess.length}`);
        console.log(`✅ Successful: ${totalProcessed} (${successRate}%)`);
        console.log(`❌ Failed: ${totalErrors}`);
        console.log(`⚡ Processing method: PARALLEL (${parallelBatchSize} simultaneous)`);
        
        if (errorDetails.length > 0 && errorDetails.length <= 10) {
            console.log(`\n⚠️  Error details:`);
            errorDetails.forEach(({ date, error }) => {
                console.log(`   ${date}: ${error}`);
            });
        } else if (errorDetails.length > 10) {
            console.log(`\n⚠️  ${errorDetails.length} errors occurred (showing first 5):`);
            errorDetails.slice(0, 5).forEach(({ date, error }) => {
                console.log(`   ${date}: ${error}`);
            });
        }

        console.log('🚀 PARALLEL update process completed successfully!');

        return {
            success: true,
            message: `Actualización paralela desde ${fromDate}: ${totalProcessed} fechas exitosas, ${totalErrors} fallaron`,
            processed: totalProcessed,
            errors: totalErrors,
            errorDetails: errorDetails.slice(0, 20),
            dateRange: `${format(startDate, 'yyyy-MM-dd')} a ${format(endDate, 'yyyy-MM-dd')}`,
            totalDates: datesToProcess.length,
            successRate: parseFloat(successRate),
            processingMethod: 'PARALLEL',
            batchSize: parallelBatchSize,
            batchesProcessed: Math.ceil(datesToProcess.length / parallelBatchSize)
        };

    } catch (err) {
        console.error('💥 Fatal error in PARALLEL updateDataFromDate:', err.message);
        console.error('Stack trace:', err.stack);
        
        return {
            success: false,
            message: `Fatal error: ${err.message}`,
            processed: 0,
            errors: 1,
            errorDetails: [{ date: 'general', error: err.message }]
        };
    } finally {
        client.release();
    }
};

// Función para obtener feriados chilenos dinámicamente desde API
const getChileanHolidays = async () => {
    try {
        console.log('📅 Fetching Chilean holidays from boostr.cl API...');
        const response = await axios.get('https://api.boostr.cl/holidays.json', {
            timeout: 10000 // 10 segundos timeout
        });
        
        if (response.data.status === 'success' && Array.isArray(response.data.data)) {
            const holidays = response.data.data.map(holiday => {
                // Parsear fecha directamente desde string YYYY-MM-DD para evitar problemas de timezone
                let monthDay;
                if (typeof holiday.date === 'string' && holiday.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    // Si viene como YYYY-MM-DD, extraer directamente
                    const partes = holiday.date.split('-');
                    monthDay = `${partes[1]}-${partes[2]}`;
                } else {
                    // Si viene en otro formato, usar Date pero normalizar
                    const date = new Date(holiday.date);
                    monthDay = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                }
                return {
                    date: monthDay,
                    name: holiday.name || 'Feriado',
                    fullDate: holiday.date
                };
            });
            
            console.log(`✅ Successfully loaded ${holidays.length} Chilean holidays from API:`, holidays.map(h => `${h.date} (${h.name})`).join(', '));
            return holidays;
        } else {
            throw new Error('Invalid response format from holidays API');
        }
    } catch (error) {
        console.error('❌ Error fetching holidays from API:', error.message);
        
        // Fallback a lista básica si falla la API
        console.log('📋 Using fallback static holiday list...');
        return [
            { date: '01-01', name: 'Año Nuevo' },
            { date: '05-01', name: 'Día del Trabajador' },
            { date: '05-21', name: 'Día de las Glorias Navales' },
            { date: '06-29', name: 'San Pedro y San Pablo' },
            { date: '07-16', name: 'Virgen del Carmen' },
            { date: '08-15', name: 'Asunción de la Virgen' },
            { date: '09-18', name: 'Independencia Nacional' },
            { date: '09-19', name: 'Día de las Glorias del Ejército' },
            { date: '10-12', name: 'Encuentro de Dos Mundos' },
            { date: '11-01', name: 'Día de Todos los Santos' },
            { date: '12-08', name: 'Inmaculada Concepción' },
            { date: '12-25', name: 'Navidad' }
        ];
    }
};

// Función para verificar si una fecha es feriado chileno (usando API dinámica)
const isChileanHoliday = async (date) => {
    try {
        const holidays = await getChileanHolidays();
        const formattedDate = format(new Date(date), 'MM-dd');
        return holidays.some(holiday => holiday.date === formattedDate);
    } catch (error) {
        console.error('Error checking if date is holiday:', error);
        return false; // En caso de error, asumir que no es feriado
    }
};

// Nueva función para eliminar feriados de la base de datos (usando API dinámica)
const removeHolidaysFromDatabase = async () => {
    const client = await pool.connect();
    try {
        console.log('🗓️ Starting removal of holiday records from database...');
        
        // Obtener feriados dinámicamente desde la API
        const chileanHolidays = await getChileanHolidays();
        
        if (chileanHolidays.length === 0) {
            console.log('⚠️ No holidays found from API');
            return {
                success: false,
                message: 'No se pudieron obtener los feriados desde la API',
                deletedCount: 0,
                deletedDates: []
            };
        }
        
        console.log(`🎯 Found ${chileanHolidays.length} holidays from API to check`);
        
        let deletedCount = 0;
        const deletedDates = [];
        
        // Buscar y eliminar registros de feriados
        for (const holiday of chileanHolidays) {
            const [month, day] = holiday.date.split('-');
            
            // Buscar registros de este feriado en cualquier año
            const selectResult = await client.query(
                'SELECT fecha FROM daily_statistics WHERE EXTRACT(month FROM fecha) = $1 AND EXTRACT(day FROM fecha) = $2 ORDER BY fecha',
                [parseInt(month), parseInt(day)]
            );
            
            if (selectResult.rows.length > 0) {
                console.log(`🎯 Found ${selectResult.rows.length} records for ${holiday.name} (${day}/${month}):`);
                selectResult.rows.forEach(row => {
                    console.log(`   - ${format(row.fecha, 'yyyy-MM-dd')}`);
                });
                
                // Eliminar registros
                const deleteResult = await client.query(
                    'DELETE FROM daily_statistics WHERE EXTRACT(month FROM fecha) = $1 AND EXTRACT(day FROM fecha) = $2',
                    [parseInt(month), parseInt(day)]
                );
                
                deletedCount += deleteResult.rowCount;
                deletedDates.push(...selectResult.rows.map(row => format(row.fecha, 'yyyy-MM-dd')));
                
                console.log(`✅ Deleted ${deleteResult.rowCount} records for ${holiday.name}`);
            }
        }
        
        console.log(`\n🎉 === DYNAMIC HOLIDAY CLEANUP COMPLETED ===`);
        console.log(`📊 Total holiday records deleted: ${deletedCount}`);
        console.log(`🌐 Used dynamic API with ${chileanHolidays.length} holidays`);
        
        if (deletedDates.length > 0) {
            console.log(`🗓️ Deleted dates:`);
            deletedDates.forEach(date => console.log(`   - ${date}`));
        } else {
            console.log('✨ No holiday records found to delete');
        }
        
        return {
            success: true,
            message: `Se eliminaron ${deletedCount} registros de feriados usando API dinámica`,
            deletedCount,
            deletedDates: deletedDates.slice(0, 10), // Mostrar solo los primeros 10
            apiHolidays: chileanHolidays.length
        };
        
    } catch (err) {
        console.error('💥 Error removing holidays:', err.message);
        console.error('Stack trace:', err.stack);
        
        return {
            success: false,
            message: `Error al eliminar feriados: ${err.message}`,
            deletedCount: 0,
            deletedDates: []
        };
    } finally {
        client.release();
    }
};

// Función para inicializar las tablas de operaciones de acciones
const initOperacionesTable = async () => {
    const client = await pool.connect();
    try {
        // Crear tabla de operaciones
        await client.query(`
            CREATE TABLE IF NOT EXISTS operaciones_acciones (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                nemotecnico VARCHAR(50) NOT NULL,
                cantidad NUMERIC(18, 3) NOT NULL,
                precio NUMERIC(18, 2) NOT NULL,
                monto NUMERIC(18, 2) NOT NULL,
                tipo_operacion VARCHAR(10) NOT NULL, -- 'Compra' o 'Venta'
                codigo_corredor INTEGER NOT NULL,
                nombre_corredor VARCHAR(100),
                fecha_pago DATE,
                precio_cierre NUMERIC(18, 2),
                origen VARCHAR(20) DEFAULT 'csv', -- 'csv' o 'balance_base'
                nombre_archivo VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Actualizar tipos de columnas numéricas si ya existen (para migración)
        try {
            // Verificar si las columnas existen y tienen el tipo antiguo
            const checkQuery = await client.query(`
                SELECT column_name, data_type, numeric_precision, numeric_scale
                FROM information_schema.columns
                WHERE table_name = 'operaciones_acciones' 
                AND column_name IN ('cantidad', 'precio', 'monto')
            `);
            
            if (checkQuery.rows.length > 0) {
                for (const col of checkQuery.rows) {
                    const currentPrecision = parseInt(col.numeric_precision) || 0;
                    if (currentPrecision < 18) {
                        try {
                            await client.query(`
                                ALTER TABLE operaciones_acciones 
                                ALTER COLUMN ${col.column_name} TYPE NUMERIC(18, ${col.column_name === 'cantidad' ? '3' : '2'})
                            `);
                            console.log(`✓ Columna ${col.column_name} actualizada de NUMERIC(${currentPrecision}, ${col.numeric_scale}) a NUMERIC(18, ${col.column_name === 'cantidad' ? '3' : '2'})`);
                        } catch (alterError) {
                            console.log(`⚠ No se pudo actualizar ${col.column_name}:`, alterError.message);
                        }
                    } else {
                        console.log(`✓ Columna ${col.column_name} ya tiene precisión suficiente (${currentPrecision})`);
                    }
                }
            }
        } catch (e) {
            console.log('Error al verificar tipos de columnas:', e.message);
        }
        
        // Agregar columnas si no existen (para migración)
        try {
            await client.query(`
                ALTER TABLE operaciones_acciones 
                ADD COLUMN IF NOT EXISTS origen VARCHAR(20) DEFAULT 'csv'
            `);
        } catch (e) {
            // Columna ya existe
        }
        
        try {
            await client.query(`
                ALTER TABLE operaciones_acciones 
                ADD COLUMN IF NOT EXISTS nombre_archivo VARCHAR(255)
            `);
        } catch (e) {
            // Columna ya existe
        }
        
        try {
            await client.query(`
                ALTER TABLE operaciones_acciones 
                ADD COLUMN IF NOT EXISTS historial_id INTEGER
            `);
        } catch (e) {
            // Columna ya existe
        }
        
        try {
            await client.query(`
                ALTER TABLE operaciones_acciones 
                ADD COLUMN IF NOT EXISTS precio_cierre NUMERIC(18, 2)
            `);
        } catch (e) {
            // Columna ya existe
        }
        
        // Agregar foreign key si no existe (PostgreSQL no soporta IF NOT EXISTS para constraints)
        try {
            // Primero verificar si la constraint ya existe
            const constraintCheck = await client.query(`
                SELECT constraint_name 
                FROM information_schema.table_constraints 
                WHERE table_name = 'operaciones_acciones' 
                  AND constraint_name = 'fk_operaciones_historial'
            `);
            
            if (constraintCheck.rows.length === 0) {
                await client.query(`
                    ALTER TABLE operaciones_acciones 
                    ADD CONSTRAINT fk_operaciones_historial 
                    FOREIGN KEY (historial_id) REFERENCES historial_archivos(id) ON DELETE CASCADE
                `);
                console.log('Foreign key constraint fk_operaciones_historial creada');
            }
        } catch (e) {
            // Constraint ya existe o hay un problema
            console.log('Note: Foreign key constraint may already exist:', e.message);
        }
        
        // Migración: asignar historial_id a operaciones existentes que no lo tengan
        try {
            const migrationResult = await client.query(`
                UPDATE operaciones_acciones oa
                SET historial_id = ha.id
                FROM historial_archivos ha
                WHERE oa.historial_id IS NULL
                  AND oa.nombre_archivo = ha.nombre_archivo
                  AND oa.origen = ha.tipo
                  AND oa.created_at >= ha.fecha_procesamiento - INTERVAL '1 minute'
                  AND oa.created_at <= ha.fecha_procesamiento + INTERVAL '1 minute'
            `);
            if (migrationResult.rowCount > 0) {
                console.log(`Migración: ${migrationResult.rowCount} operaciones asignadas a historial_id`);
            }
        } catch (e) {
            console.log('Note: Error en migración de historial_id:', e.message);
        }
        
        // Crear tabla de historial de archivos
        await client.query(`
            CREATE TABLE IF NOT EXISTS historial_archivos (
                id SERIAL PRIMARY KEY,
                nombre_archivo VARCHAR(255) NOT NULL,
                tipo VARCHAR(20) NOT NULL, -- 'csv' o 'balance_base'
                fecha_procesamiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                cantidad_operaciones INTEGER DEFAULT 0,
                fecha_archivo DATE,
                archivo_original BYTEA
            )
        `);
        
        // Agregar columna archivo_original si no existe (para migración)
        try {
            await client.query(`
                ALTER TABLE historial_archivos 
                ADD COLUMN IF NOT EXISTS archivo_original BYTEA
            `);
        } catch (e) {
            // Columna ya existe o hay un problema
            console.log('Note: Columna archivo_original may already exist:', e.message);
        }
        
        // Crear índices para mejorar el rendimiento
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_operaciones_nemotecnico 
            ON operaciones_acciones(nemotecnico)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_operaciones_fecha 
            ON operaciones_acciones(fecha)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_operaciones_origen 
            ON operaciones_acciones(origen)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_historial_fecha 
            ON historial_archivos(fecha_procesamiento)
        `);
        
        console.log('Tablas de operaciones de acciones inicializadas correctamente');
    } catch (error) {
        console.error('Error al inicializar tablas de operaciones:', error);
        throw error;
    } finally {
        client.release();
    }
};

// Función para guardar operaciones en la base de datos
const saveOperacionesAcciones = async (operaciones, origen = 'csv', nombreArchivo = null, archivoBuffer = null) => {
    if (!Array.isArray(operaciones) || operaciones.length === 0) {
        console.log('No hay operaciones para guardar');
        return { success: true, saved: 0 };
    }
    
    console.log(`[saveOperacionesAcciones] Recibidas ${operaciones.length} operaciones para procesar`);
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        let saved = 0;
        let fechaArchivo = null;
        
        for (const op of operaciones) {
            // Extraer nemotécnico
            let nemotecnico = '';
            
            // Primero intentar obtenerlo directamente del campo Nemotecnico (para balance base)
            if (op.Nemotecnico) {
                nemotecnico = String(op.Nemotecnico).toUpperCase().trim();
                // Limpiar nemotécnico: extraer solo el código de acción (ej: "LTM 886" -> "LTM")
                // Si contiene espacios, tomar solo la primera palabra (el código de acción)
                if (nemotecnico.includes(' ')) {
                    nemotecnico = nemotecnico.split(' ')[0];
                }
                // Limpiar cualquier carácter no alfanumérico al final
                nemotecnico = nemotecnico.replace(/[^A-Za-z0-9]+$/, '').trim();
            }
            
            // Si no está, intentar extraerlo del campo 'Tipo Operación' (ej: "Compra BCI 241" -> "BCI")
            if (!nemotecnico && op['Tipo Operación']) {
                const tipoOp = String(op['Tipo Operación']);
                // Remover "Compra " o "Venta " del inicio
                nemotecnico = tipoOp.replace(/^(Compra|Venta)\s+/i, '').trim().toUpperCase();
                // Limpiar: si contiene espacios, tomar solo la primera palabra
                if (nemotecnico.includes(' ')) {
                    nemotecnico = nemotecnico.split(' ')[0];
                }
                // Limpiar cualquier carácter no alfanumérico al final
                nemotecnico = nemotecnico.replace(/[^A-Za-z0-9]+$/, '').trim();
            }
            
            // Filtrar solo acciones (excluir CFIs y otros)
            if (!nemotecnico || nemotecnico.includes('CFI') || nemotecnico.includes('OSA') || nemotecnico.trim() === '') {
                console.log(`Operación descartada - Nemotécnico: "${nemotecnico}", Tipo Operación: "${op['Tipo Operación']}"`);
                continue;
            }
            
            console.log(`Procesando operación - Nemotécnico: "${nemotecnico}", Tipo: "${op.Tipo || 'N/A'}", Cantidad: ${op.Cantidad || 'N/A'}, Precio: ${op.Precio || 'N/A'}`);
            
            // Formatear fecha
            let fecha;
            if (op.Fecha instanceof Date) {
                fecha = format(op.Fecha, 'yyyy-MM-dd');
            } else if (typeof op.Fecha === 'string') {
                // Formato YYYYMMDD (8 dígitos)
                if (op.Fecha.length === 8 && /^\d{8}$/.test(op.Fecha)) {
                    const year = op.Fecha.substring(0, 4);
                    const month = op.Fecha.substring(4, 6);
                    const day = op.Fecha.substring(6, 8);
                    fecha = `${year}-${month}-${day}`;
                } 
                // Formato YYYY-MM-DD (ya está en formato correcto)
                else if (op.Fecha.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    fecha = op.Fecha;
                } else {
                    console.log(`Fecha inválida: ${op.Fecha}`);
                    continue;
                }
            } else {
                console.log(`Tipo de fecha no reconocido: ${typeof op.Fecha}`);
                continue;
            }
            
            // Formatear fecha de pago
            let fechaPago = null;
            if (op['Fecha Pago']) {
                if (op['Fecha Pago'] instanceof Date) {
                    fechaPago = format(op['Fecha Pago'], 'yyyy-MM-dd');
                } else if (typeof op['Fecha Pago'] === 'string') {
                    // Si ya viene como string YYYY-MM-DD, usarlo directamente
                    if (op['Fecha Pago'].match(/^\d{4}-\d{2}-\d{2}$/)) {
                        fechaPago = op['Fecha Pago'];
                    } else {
                        // Intentar parsear otros formatos
                        const fechaPagoDate = new Date(op['Fecha Pago']);
                        if (!isNaN(fechaPagoDate.getTime())) {
                            fechaPago = format(fechaPagoDate, 'yyyy-MM-dd');
                        }
                    }
                }
            }
            
            const esCompra = op.Tipo === 'Compra';
            
            // Parsear cantidad y precio
            let cantidad = 0;
            let precio = 0;
            let monto = 0;
            
            // Si viene como número, usarlo directamente (ya está en formato correcto)
            // Si viene como string, parsear formato latinoamericano (punto para miles, coma para decimales)
            if (op.Cantidad) {
                if (typeof op.Cantidad === 'number') {
                    cantidad = op.Cantidad;
                } else {
                    cantidad = parseFloat(String(op.Cantidad).replace(/\./g, '').replace(',', '.')) || 0;
                }
            }
            if (op.Precio) {
                if (typeof op.Precio === 'number') {
                    precio = op.Precio; // Ya está en formato numérico correcto
                } else {
                    // Parsear formato latinoamericano (punto para miles, coma para decimales)
                    precio = parseFloat(String(op.Precio).replace(/\./g, '').replace(',', '.')) || 0;
                }
            }
            if (esCompra && op.Cargo) {
                if (typeof op.Cargo === 'number') {
                    monto = op.Cargo;
                } else {
                    monto = parseFloat(String(op.Cargo).replace(/\./g, '').replace(',', '.')) || 0;
                }
            } else if (!esCompra && op.Abono) {
                if (typeof op.Abono === 'number') {
                    monto = op.Abono;
                } else {
                    monto = parseFloat(String(op.Abono).replace(/\./g, '').replace(',', '.')) || 0;
                }
            }
            
            // Validar que los valores no excedan los límites de NUMERIC(18, 2)
            // NUMERIC(18, 2) puede almacenar hasta 99999999999999.99 (14 dígitos antes del decimal + 2 decimales = 16 dígitos totales)
            // Pero PostgreSQL limita a 10^16, así que el máximo seguro es 999999999999999.99 (15 dígitos antes del decimal)
            const maxValue = 999999999999999.99;
            const maxPrecio = 999999999999999.99;
            const maxCantidad = 999999999999999.999; // Para cantidad con 3 decimales
            
            if (Math.abs(precio) > maxPrecio) {
                console.warn(`Precio muy grande, truncando: ${precio} -> ${Math.sign(precio) * maxPrecio}`);
                precio = Math.sign(precio) * maxPrecio;
            }
            if (Math.abs(monto) > maxValue) {
                console.warn(`Monto muy grande, truncando: ${monto} -> ${Math.sign(monto) * maxValue}`);
                monto = Math.sign(monto) * maxValue;
            }
            if (Math.abs(cantidad) > maxCantidad) {
                console.warn(`Cantidad muy grande, truncando: ${cantidad} -> ${Math.sign(cantidad) * maxCantidad}`);
                cantidad = Math.sign(cantidad) * maxCantidad;
            }
            
            // Obtener fecha del archivo de la primera operación
            if (!fechaArchivo && fecha) {
                fechaArchivo = fecha;
                console.log(`Fecha de archivo extraída de operación: ${fechaArchivo}`);
            }
            
            // Obtener precio de cierre si está disponible
            let precioCierre = null;
            if (op.PrecioCierre !== undefined && op.PrecioCierre !== null) {
                if (typeof op.PrecioCierre === 'number') {
                    precioCierre = op.PrecioCierre;
                } else {
                    precioCierre = parseFloat(String(op.PrecioCierre)) || null;
                }
            }
            
            await client.query(`
                INSERT INTO operaciones_acciones 
                (fecha, nemotecnico, cantidad, precio, monto, tipo_operacion, codigo_corredor, nombre_corredor, fecha_pago, precio_cierre, origen, nombre_archivo, historial_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, [
                fecha,
                nemotecnico,
                cantidad,
                precio,
                monto,
                op.Tipo || (esCompra ? 'Compra' : 'Venta'),
                op.Codigo || 0,
                op.Corredor || '',
                fechaPago,
                precioCierre,
                origen,
                nombreArchivo,
                null // Se actualizará después con el historial_id
            ]);
            
            saved++;
        }
        
        // Guardar en historial de archivos primero para obtener el ID
        let historialId = null;
        if (nombreArchivo && saved > 0) {
            // Asegurar que fechaArchivo esté en formato correcto
            let fechaArchivoFormateada = null;
            if (fechaArchivo) {
                if (typeof fechaArchivo === 'string') {
                    fechaArchivoFormateada = fechaArchivo; // Ya está en formato 'YYYY-MM-DD'
                } else if (fechaArchivo instanceof Date) {
                    fechaArchivoFormateada = format(fechaArchivo, 'yyyy-MM-dd');
                } else {
                    fechaArchivoFormateada = format(new Date(fechaArchivo), 'yyyy-MM-dd');
                }
            } else {
                // Si no hay fechaArchivo, intentar obtenerla de la primera operación guardada
                // Buscar en las operaciones que acabamos de insertar (las que tienen historial_id NULL)
                const primeraOpResult = await client.query(`
                    SELECT fecha FROM operaciones_acciones 
                    WHERE nombre_archivo = $1 AND origen = $2 AND historial_id IS NULL
                    ORDER BY created_at ASC LIMIT 1
                `, [nombreArchivo, origen]);
                if (primeraOpResult.rows.length > 0 && primeraOpResult.rows[0].fecha) {
                    fechaArchivoFormateada = typeof primeraOpResult.rows[0].fecha === 'string' 
                        ? primeraOpResult.rows[0].fecha 
                        : format(new Date(primeraOpResult.rows[0].fecha), 'yyyy-MM-dd');
                    console.log(`Fecha obtenida de primera operación guardada: ${fechaArchivoFormateada}`);
                } else {
                    console.log(`No se encontró fecha en operaciones para nombre_archivo=${nombreArchivo}, origen=${origen}`);
                }
            }
            console.log(`Guardando historial: nombre=${nombreArchivo}, tipo=${origen}, fecha_archivo=${fechaArchivoFormateada}, saved=${saved}, tiene_archivo=${archivoBuffer ? 'sí' : 'no'}`);
            
            const historialResult = await client.query(`
                INSERT INTO historial_archivos 
                (nombre_archivo, tipo, cantidad_operaciones, fecha_archivo, archivo_original)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
            `, [
                nombreArchivo,
                origen,
                saved,
                fechaArchivoFormateada,
                archivoBuffer // Guardar el buffer del archivo original
            ]);
            
            if (historialResult.rows.length > 0) {
                historialId = historialResult.rows[0].id;
                
                // Actualizar las operaciones recién insertadas con el historial_id
                // Identificamos las operaciones por nombre_archivo, origen y timestamp reciente
                await client.query(`
                    UPDATE operaciones_acciones 
                    SET historial_id = $1
                    WHERE nombre_archivo = $2 
                      AND origen = $3
                      AND historial_id IS NULL
                      AND created_at >= NOW() - INTERVAL '5 seconds'
                `, [historialId, nombreArchivo, origen]);
            }
        }
        
            await client.query('COMMIT');
            console.log(`Se guardaron ${saved} operaciones de acciones (${origen})`);
            return { success: true, saved };
        } catch (error) {
            await client.query('ROLLBACK');
            
            // Si es un error de overflow numérico, intentar aplicar migración automáticamente
            if (error.code === '22003' && error.detail && error.detail.includes('numeric field overflow')) {
                console.log('⚠ Detectado overflow numérico, intentando aplicar migración automáticamente...');
                client.release(); // Liberar el cliente actual antes de reintentar
                try {
                    const migrationClient = await pool.connect();
                    try {
                        await migrationClient.query('BEGIN');
                        await migrationClient.query(`
                            ALTER TABLE operaciones_acciones 
                            ALTER COLUMN cantidad TYPE NUMERIC(18, 3),
                            ALTER COLUMN precio TYPE NUMERIC(18, 2),
                            ALTER COLUMN monto TYPE NUMERIC(18, 2)
                        `);
                        await migrationClient.query('COMMIT');
                        console.log('✓ Migración aplicada automáticamente. Reintentando guardar operaciones...');
                        migrationClient.release();
                        
                        // Reintentar guardar las operaciones
                        return await saveOperacionesAcciones(operaciones, origen, nombreArchivo);
                    } catch (migrationError) {
                        await migrationClient.query('ROLLBACK');
                        migrationClient.release();
                        console.error('Error al aplicar migración automática:', migrationError);
                        throw new Error(`Error de overflow numérico. Por favor, ejecuta la migración manualmente visitando: /api/migrate-numeric-types. Error: ${error.message}`);
                    }
                } catch (migrationError) {
                    throw new Error(`Error de overflow numérico. Por favor, ejecuta la migración manualmente visitando: /api/migrate-numeric-types. Error: ${error.message}`);
                }
            }
            
            console.error('Error al guardar operaciones:', error);
            throw error;
        } finally {
            // Solo liberar si no se hizo antes (en caso de migración automática)
            // Verificamos si el cliente aún está disponible
            try {
                if (client && typeof client.release === 'function') {
                    client.release();
                }
            } catch (releaseError) {
                // Ignorar errores al liberar (puede estar ya liberado)
            }
        }
    };

// Función para obtener el balance de acciones
const getBalanceAcciones = async () => {
    const client = await pool.connect();
    try {
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
        
        // Obtener ajustes manuales
        const ajustesResult = await client.query(`
            SELECT nemotecnico, existencia, precio_compra, precio_cierre, valorizacion_compra
            FROM ajustes_manuales_balance
        `);
        const ajustes = {};
        ajustesResult.rows.forEach(row => {
            ajustes[row.nemotecnico.toUpperCase()] = {
                existencia: row.existencia !== null ? parseFloat(row.existencia) : null,
                precioCompra: row.precio_compra !== null ? parseFloat(row.precio_compra) : null,
                precioCierre: row.precio_cierre !== null ? parseFloat(row.precio_cierre) : null,
                valorizacionCompra: row.valorizacion_compra !== null ? parseFloat(row.valorizacion_compra) : null
            };
        });
        
        // Obtener todas las operaciones ordenadas por fecha
        const result = await client.query(`
            SELECT 
                fecha,
                nemotecnico,
                cantidad,
                precio,
                precio_cierre,
                monto,
                tipo_operacion,
                codigo_corredor,
                nombre_corredor,
                origen,
                nombre_archivo
            FROM operaciones_acciones
            ORDER BY fecha ASC, id ASC
        `);
        
        // Calcular balance agregado por nemotécnico
        const balance = {};
        
        // Función para normalizar nemotécnico (extraer solo el código de acción)
        const normalizarNemotecnico = (nemotecnico) => {
            if (!nemotecnico) return '';
            let normalizado = String(nemotecnico).toUpperCase().trim();
            // Si contiene espacios, tomar solo la primera palabra (el código de acción)
            if (normalizado.includes(' ')) {
                normalizado = normalizado.split(' ')[0];
            }
            // Limpiar cualquier carácter no alfanumérico al final
            normalizado = normalizado.replace(/[^A-Za-z0-9]+$/, '').trim();
            return normalizado;
        };
        
        console.log(`[getBalanceAcciones] Total de operaciones en BD: ${result.rows.length}`);
        
        result.rows.forEach((row, index) => {
            // Normalizar nemotécnico para que coincida con el formato usado al guardar
            const nemotecnico = normalizarNemotecnico(row.nemotecnico);
            
            if (index < 5 || index % 10 === 0) {
                console.log(`[getBalanceAcciones] Operación ${index + 1}: nemotécnico="${row.nemotecnico}" -> normalizado="${nemotecnico}", tipo=${row.tipo_operacion}, cantidad=${row.cantidad}`);
            }
            
            if (!balance[nemotecnico]) {
                balance[nemotecnico] = {
                    nemotecnico: nemotecnico,
                    existencia: 0,
                    precioCompraPromedio: 0,
                    precioCierre: null, // Precio de cierre más reciente
                    valorizacionCompra: 0,
                    totalCompras: 0,
                    totalCantidadCompras: 0,
                    totalVentas: 0,
                    totalCantidadVentas: 0,
                    tipoOperacion: 'Cartera' // Por defecto
                };
            }
            
            // Actualizar precio de cierre si está disponible (usar el más reciente)
            if (row.precio_cierre !== null && row.precio_cierre !== undefined) {
                balance[nemotecnico].precioCierre = parseFloat(row.precio_cierre) || null;
            }
            
            const cantidad = parseFloat(row.cantidad) || 0;
            const precio = parseFloat(row.precio) || 0;
            
            if (row.tipo_operacion === 'Compra') {
                // Agregar nueva compra
                balance[nemotecnico].existencia += cantidad;
                balance[nemotecnico].totalCompras += cantidad * precio;
                balance[nemotecnico].totalCantidadCompras += cantidad;
                
                // Log para LTM para debugging
                if (nemotecnico === 'LTM') {
                    console.log(`[getBalanceAcciones] LTM Compra: cantidad=${cantidad}, existencia después=${balance[nemotecnico].existencia}`);
                }
                
                // Recalcular precio promedio ponderado para compras
                if (balance[nemotecnico].totalCantidadCompras > 0) {
                    balance[nemotecnico].precioCompraPromedio = 
                        balance[nemotecnico].totalCompras / balance[nemotecnico].totalCantidadCompras;
                }
                
                // Si la existencia es positiva, es Cartera
                if (balance[nemotecnico].existencia > 0) {
                    balance[nemotecnico].tipoOperacion = 'Cartera';
                }
            } else if (row.tipo_operacion === 'Venta') {
                // Para ventas, reducir existencia
                balance[nemotecnico].existencia -= cantidad;
                balance[nemotecnico].totalVentas += cantidad * precio;
                balance[nemotecnico].totalCantidadVentas += cantidad;
                
                // Log para LTM para debugging
                if (nemotecnico === 'LTM') {
                    console.log(`[getBalanceAcciones] LTM Venta: cantidad=${cantidad}, existencia después=${balance[nemotecnico].existencia}`);
                }
                
                // Si la existencia es negativa (corto), usar el precio de la venta directamente
                // No calcular promedio, usar el precio de la operación de venta
                if (balance[nemotecnico].existencia < 0) {
                    // Para cortos, el precio es el precio de la venta (precio al que se hizo el corto)
                    // Usar el precio de la última operación de venta que creó el corto
                    balance[nemotecnico].precioCompraPromedio = precio; // Precio directo de la venta
                    balance[nemotecnico].tipoOperacion = 'Corto';
                }
            }
            
            // Calcular valorización con el precio correcto
            // Para existencias negativas (cortos), usar el precio de venta directo
            // Para existencias positivas (cartera), usar el precio promedio de compra
            // Para balance_base, el monto guardado es la valorización del Excel, usarlo directamente
            // Esto evita problemas de precisión decimal al multiplicar existencia × precio
            if (row.origen === 'balance_base' && row.monto && Math.abs(parseFloat(row.monto)) > 0) {
                // Para balance base, usar el monto (valorización) directamente del Excel
                // El monto ya viene de la columna VALORIZACIÓN COMPRA del Excel
                const montoValorizacion = parseFloat(row.monto) || 0;
                // Solo actualizar si es la primera vez o si es más reciente (última operación)
                // Para balance_base, todas las operaciones tienen el mismo monto, así que solo actualizamos una vez
                if (balance[nemotecnico].valorizacionCompra === 0 || row.origen === 'balance_base') {
                    // Si la existencia es negativa (corto), la valorización debe ser negativa
                    // Si viene positiva del Excel pero la existencia es negativa, convertirla a negativa
                    if (balance[nemotecnico].existencia < 0) {
                        // Para cortos, la valorización debe ser negativa
                        balance[nemotecnico].valorizacionCompra = -Math.abs(montoValorizacion);
                    } else {
                        // Para cartera (existencia positiva), mantener el signo del Excel
                        balance[nemotecnico].valorizacionCompra = montoValorizacion;
                    }
                }
            } else {
                // Para operaciones normales (CSV), calcular existencia × precio
                // Si la existencia es negativa, la valorización también será negativa
                balance[nemotecnico].valorizacionCompra = 
                    balance[nemotecnico].existencia * balance[nemotecnico].precioCompraPromedio;
                // Redondear a 2 decimales para evitar problemas de precisión
                balance[nemotecnico].valorizacionCompra = Math.round(balance[nemotecnico].valorizacionCompra * 100) / 100;
            }
        });
        
        // Aplicar ajustes manuales después de calcular el balance
        Object.keys(balance).forEach(nemotecnico => {
            if (ajustes[nemotecnico]) {
                const ajuste = ajustes[nemotecnico];
                let necesitaRecalcularValorizacion = false;
                
                if (ajuste.existencia !== null) {
                    balance[nemotecnico].existencia = ajuste.existencia;
                    necesitaRecalcularValorizacion = true;
                }
                if (ajuste.precioCompra !== null) {
                    balance[nemotecnico].precioCompraPromedio = ajuste.precioCompra;
                    necesitaRecalcularValorizacion = true;
                }
                if (ajuste.precioCierre !== null) {
                    balance[nemotecnico].precioCierre = ajuste.precioCierre;
                }
                
                // Recalcular valorizacionCompra solo si se modificó existencia o precio compra
                // valorizacionCompra es un campo calculado: existencia × precio compra promedio
                if (necesitaRecalcularValorizacion) {
                    balance[nemotecnico].valorizacionCompra = 
                        balance[nemotecnico].existencia * balance[nemotecnico].precioCompraPromedio;
                    // Redondear a 2 decimales para evitar problemas de precisión
                    balance[nemotecnico].valorizacionCompra = Math.round(balance[nemotecnico].valorizacionCompra * 100) / 100;
                }
            }
        });
        
        // NO filtrar por existencia > 0, mostrar todas las posiciones (incluyendo cortos negativos)
        // Esto permite ver las posiciones cortas (existencias negativas)
        const balanceCompleto = Object.values(balance).filter(item => item.existencia !== 0);
        
        // Detectar nemotécnicos que se netearon (existencia 0 pero tuvieron operaciones)
        const nemotecnicosNeteados = Object.values(balance)
            .filter(item => item.existencia === 0 && (item.totalCantidadCompras > 0 || item.totalCantidadVentas > 0))
            .map(item => item.nemotecnico);
        
        console.log(`[getBalanceAcciones] Balance calculado: ${Object.keys(balance).length} nemotécnicos únicos`);
        
        // Mostrar todos los nemotécnicos antes del filtro
        Object.keys(balance).forEach(nemotecnico => {
            const item = balance[nemotecnico];
            console.log(`[getBalanceAcciones] ANTES FILTRO - ${nemotecnico}: existencia=${item.existencia}, tipo=${item.tipoOperacion}, totalCompras=${item.totalCantidadCompras}, totalVentas=${item.totalCantidadVentas}`);
        });
        
        if (nemotecnicosNeteados.length > 0) {
            console.log(`[getBalanceAcciones] Nemotécnicos neteados (existencia 0): ${nemotecnicosNeteados.join(', ')}`);
        }
        
        console.log(`[getBalanceAcciones] Balance filtrado (existencia !== 0): ${balanceCompleto.length} nemotécnicos`);
        balanceCompleto.forEach(item => {
            console.log(`[getBalanceAcciones] DESPUÉS FILTRO - ${item.nemotecnico}: existencia=${item.existencia}, tipo=${item.tipoOperacion}`);
        });
        
        // Retornar balance completo y nemotécnicos neteados
        return {
            balance: balanceCompleto,
            nemotecnicosNeteados: nemotecnicosNeteados
        };
    } catch (error) {
        console.error('Error al obtener balance de acciones:', error);
        throw error;
    } finally {
        client.release();
    }
};

// Función para procesar balance base desde Excel
const procesarBalanceBase = async (buffer, nombreArchivo) => {
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        
        // Buscar la pestaña "Cartera Acciones" o que contenga "acciones" (case insensitive)
        let sheetName = null;
        for (const name of workbook.SheetNames) {
            const nameLower = name.toLowerCase();
            if (nameLower.includes('cartera') && nameLower.includes('acciones')) {
                sheetName = name;
                break;
            } else if (nameLower.includes('acciones')) {
                sheetName = name;
                break;
            }
        }
        
        if (!sheetName) {
            throw new Error(`No se encontró una pestaña con "acciones" en el Excel. Pestañas disponibles: ${workbook.SheetNames.join(', ')}`);
        }
        
        console.log(`Pestaña encontrada: "${sheetName}"`);
        
        const worksheet = workbook.Sheets[sheetName];
        
        // Leer datos directamente desde las celdas para obtener valores formateados como texto
        // Esto preserva el formato con puntos y comas
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        const datos = [];
        
        for (let R = range.s.r; R <= range.e.r; R++) {
            const row = [];
            for (let C = range.s.c; C <= range.e.c; C++) {
                const cellAddress = XLSX.utils.encode_cell({r: R, c: C});
                const cell = worksheet[cellAddress];
                if (cell) {
                    // Para números, usar el valor raw (v) que es más confiable
                    // El valor formateado (w) puede tener problemas de parseo
                    if (cell.t === 'n' && cell.v !== undefined && cell.v !== null) {
                        // Es un número, usar el valor raw directamente
                        row.push(cell.v);
                    } else if (cell.w) {
                        // Si no es número, usar el valor formateado como texto
                        row.push(cell.w);
                    } else {
                        row.push(cell.v !== undefined ? String(cell.v) : '');
                    }
                } else {
                    row.push('');
                }
            }
            datos.push(row);
        }
        
        console.log('Total de filas en la pestaña:', datos.length);
        console.log('Primeras 5 filas:', datos.slice(0, 5));
        
        // Buscar fila de encabezados
        let headerRow = -1;
        for (let i = 0; i < datos.length; i++) {
            const row = datos[i];
            if (Array.isArray(row)) {
                const rowStr = row.map(c => String(c).toUpperCase()).join(' ');
                if (rowStr.includes('INSTRUMENTO') || rowStr.includes('NEMOTECNICO') || rowStr.includes('EXISTENCIA')) {
                    headerRow = i;
                    console.log('Fila de encabezados encontrada en fila:', i);
                    console.log('Encabezados:', row);
                    break;
                }
            }
        }
        
        if (headerRow === -1) {
            throw new Error('No se encontraron encabezados válidos en la pestaña "acciones". Busca columnas: INSTRUMENTO o EXISTENCIA');
        }
        
        // Encontrar índices de columnas según el formato del Excel mostrado
        const headers = datos[headerRow].map(h => String(h).toUpperCase().trim());
        console.log('Encabezados procesados:', headers);
        
        const idxInstrumento = headers.findIndex(h => h.includes('INSTRUMENTO') || h.includes('NEMOTECNICO'));
        const idxExistencia = headers.findIndex(h => h.includes('EXISTENCIA'));
        const idxPrecioCompra = headers.findIndex(h => h.includes('PRECIO') && h.includes('COMPRA'));
        const idxPrecioCierre = headers.findIndex(h => h.includes('PRECIO') && h.includes('CIERRE'));
        const idxTipoOp = headers.findIndex(h => (h.includes('TIPO') && h.includes('OPERACION')) || h.includes('TIPO OPERACION'));
        // Buscar VALORIZACIÓN COMPRA de forma más flexible (puede tener acentos o variaciones)
        // Primero buscar directamente con acentos
        let idxValorizacionFinal = headers.findIndex(h => h.includes('VALORIZACI') && h.includes('COMPRA'));
        
        // Si no se encuentra, buscar sin acentos (normalizando)
        if (idxValorizacionFinal === -1) {
            idxValorizacionFinal = headers.findIndex(h => {
                const hClean = h.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remover acentos
                return hClean.includes('VALORIZACION') && hClean.includes('COMPRA');
            });
        }
        
        console.log('Índices encontrados:', {
            instrumento: idxInstrumento,
            existencia: idxExistencia,
            precioCompra: idxPrecioCompra,
            precioCierre: idxPrecioCierre,
            tipoOp: idxTipoOp,
            valorizacionCompra: idxValorizacionFinal,
            todosLosEncabezados: headers
        });
        
        if (idxInstrumento === -1 || idxExistencia === -1) {
            throw new Error(`Faltan columnas requeridas. INSTRUMENTO: ${idxInstrumento !== -1 ? 'OK' : 'NO ENCONTRADO'}, EXISTENCIA: ${idxExistencia !== -1 ? 'OK' : 'NO ENCONTRADO'}`);
        }
        
        // Si no hay columna de precio compra, intentar usar precio cierre
        let usarPrecioCierre = false;
        if (idxPrecioCompra === -1 && idxPrecioCierre !== -1) {
            usarPrecioCierre = true;
            console.log('Usando PRECIO CIERRE en lugar de PRECIO COMPRA');
        }
        
        // Procesar filas
        const operaciones = [];
        const fechaHoy = format(new Date(), 'yyyy-MM-dd');
        let filasProcesadas = 0;
        let filasRechazadas = 0;
        
        for (let i = headerRow + 1; i < datos.length; i++) {
            const row = datos[i];
            if (!row || !Array.isArray(row)) continue;
            
            // Verificar si es una fila de totales o vacía
            const primeraColumna = String(row[0] || '').trim().toUpperCase();
            if (primeraColumna === '' || primeraColumna.includes('TOTAL') || primeraColumna.includes('VALORIZACION')) {
                filasRechazadas++;
                continue;
            }
            
            const instrumento = String(row[idxInstrumento] || '').trim().toUpperCase();
            const existenciaRaw = String(row[idxExistencia] || '0').trim();
            
            // Manejar existencia negativa (cortos) - puede venir con paréntesis o signo negativo
            let existencia = 0;
            if (existenciaRaw) {
                // Detectar si tiene paréntesis (formato contable para negativos)
                const tieneParentesis = existenciaRaw.includes('(') || existenciaRaw.includes(')');
                const existenciaLimpia = existenciaRaw.replace(/[()]/g, '').replace(/\./g, '').replace(',', '.');
                existencia = parseFloat(existenciaLimpia) || 0;
                // Si tenía paréntesis, hacer el valor negativo
                if (tieneParentesis && existencia > 0) {
                    existencia = -existencia;
                }
            }
            
            console.log(`Fila ${i}: instrumento="${instrumento}", existenciaRaw="${existenciaRaw}", existencia=${existencia}`);
            
            // Filtrar solo acciones (excluir CFIs y otros)
            if (!instrumento || instrumento === '' || instrumento.includes('CFI') || instrumento.includes('OSA')) {
                console.log(`  → Rechazada: instrumento inválido o es CFI/OSA`);
                filasRechazadas++;
                continue;
            }
            
            // Verificar existencia (aceptar negativos para cortos, pero usar valor absoluto después)
            // Solo rechazar si es 0 o NaN (aceptar negativos)
            if (existencia === 0 || isNaN(existencia)) {
                console.log(`  → Rechazada: existencia inválida (${existencia})`);
                filasRechazadas++;
                continue;
            }
            
            // Obtener precio (compra o cierre según disponibilidad)
            let precioCompra = 0;
            if (idxPrecioCompra !== -1 && !usarPrecioCierre) {
                const precioRaw = row[idxPrecioCompra];
                // Si viene como número, usarlo directamente (valor raw de Excel)
                if (typeof precioRaw === 'number') {
                    precioCompra = precioRaw;
                    console.log(`  Precio desde PRECIO COMPRA (número raw): ${precioCompra}`);
                } else {
                    // Si viene como texto, parsear formato latinoamericano (punto para miles, coma para decimales)
                    const precioStr = String(precioRaw || '0').trim();
                    // Detectar si tiene paréntesis (formato contable para negativos)
                    const tieneParentesis = precioStr.includes('(') || precioStr.includes(')');
                    // Verificar si el string tiene formato de número grande (muchos puntos)
                    // Si tiene más de 3 puntos, puede ser un error de formato
                    const puntosCount = (precioStr.match(/\./g) || []).length;
                    if (puntosCount > 3) {
                        console.warn(`  ⚠ Precio tiene formato sospechoso (${puntosCount} puntos): "${precioStr}"`);
                        // Intentar parsear pero validar después
                    }
                    const precioLimpio = precioStr.replace(/[()]/g, '').replace(/\./g, '').replace(',', '.');
                    precioCompra = parseFloat(precioLimpio) || 0;
                    // Si tenía paréntesis, hacer el valor negativo
                    if (tieneParentesis && precioCompra > 0) {
                        precioCompra = -precioCompra;
                    }
                    console.log(`  Precio desde PRECIO COMPRA (texto): raw="${precioStr}", limpio="${precioLimpio}", parseado=${precioCompra}`);
                }
            } else if (usarPrecioCierre && idxPrecioCierre !== -1) {
                const precioRaw = row[idxPrecioCierre];
                // Si viene como número, usarlo directamente
                if (typeof precioRaw === 'number') {
                    precioCompra = precioRaw;
                    console.log(`  Precio desde PRECIO CIERRE (número raw): ${precioCompra}`);
                } else {
                    // Si viene como texto, parsear formato latinoamericano
                    const precioStr = String(precioRaw || '0').trim();
                    // Detectar si tiene paréntesis (formato contable para negativos)
                    const tieneParentesis = precioStr.includes('(') || precioStr.includes(')');
                    const precioLimpio = precioStr.replace(/[()]/g, '').replace(/\./g, '').replace(',', '.');
                    precioCompra = parseFloat(precioLimpio) || 0;
                    // Si tenía paréntesis, hacer el valor negativo
                    if (tieneParentesis && precioCompra > 0) {
                        precioCompra = -precioCompra;
                    }
                    console.log(`  Precio desde PRECIO CIERRE (texto): raw="${precioStr}", limpio="${precioLimpio}", parseado=${precioCompra}`);
                }
            }
            
            // Validar que el precio tenga sentido (no más de 1 millón por acción)
            // Si el precio es demasiado grande o no tiene sentido, calcularlo desde valorización
            // Aceptar valores negativos (para cortos)
            const precioMaximoRazonable = 1000000; // 1 millón por acción
            if (Math.abs(precioCompra) > precioMaximoRazonable || precioCompra === 0) {
                console.log(`  Precio ${precioCompra} inválido, intentando calcular desde valorización`);
                precioCompra = 0; // Resetear para calcular desde valorización
            }
            
            // Si no hay precio válido, calcular desde valorización compra si está disponible
            if (precioCompra === 0 && Math.abs(existencia) > 0 && idxValorizacionFinal !== -1) {
                const valorizacionRaw = String(row[idxValorizacionFinal] || '0').trim();
                // Detectar si tiene paréntesis (formato contable para negativos)
                const tieneParentesis = valorizacionRaw.includes('(') || valorizacionRaw.includes(')');
                const valorizacionLimpia = valorizacionRaw.replace(/[()]/g, '').replace(/\./g, '').replace(',', '.');
                let valorizacionCompra = parseFloat(valorizacionLimpia) || 0;
                // Si tenía paréntesis, hacer el valor negativo
                if (tieneParentesis && valorizacionCompra > 0) {
                    valorizacionCompra = -valorizacionCompra;
                }
                console.log(`  Valorización desde Excel: raw="${valorizacionRaw}", limpia="${valorizacionLimpia}", parseada=${valorizacionCompra}`);
                if (valorizacionCompra !== 0 && Math.abs(existencia) > 0) {
                    precioCompra = Math.abs(valorizacionCompra) / Math.abs(existencia);
                    // Si la valorización es negativa, el precio también debería ser negativo
                    if (valorizacionCompra < 0) {
                        precioCompra = -precioCompra;
                    }
                    console.log(`  Precio calculado desde valorización: ${precioCompra}`);
                    // Validar que el precio calculado tenga sentido (aceptar negativos para cortos)
                    if (Math.abs(precioCompra) > precioMaximoRazonable || !isFinite(precioCompra)) {
                        console.warn(`  Precio calculado inválido para ${instrumento}: ${precioCompra}, usando 0`);
                        precioCompra = 0;
                    }
                }
            }
            
            // Si aún no hay precio válido, rechazar esta fila
            if (precioCompra === 0 || !isFinite(precioCompra)) {
                console.warn(`  → Rechazada: No se pudo obtener precio válido para ${instrumento}. PRECIO COMPRA idx=${idxPrecioCompra}, VALORIZACIÓN COMPRA idx=${idxValorizacionFinal}`);
                filasRechazadas++;
                continue;
            }
            
            console.log(`  ✓ Precio válido: ${precioCompra}`);
            
            // Verificar tipo de operación (si existe la columna)
            // El tipo está en el índice 1 según los logs: 'Corto' o 'Cartera'
            let tipoOp = '';
            if (idxTipoOp !== -1) {
                tipoOp = String(row[idxTipoOp] || '').trim().toUpperCase();
            } else if (row[1]) {
                tipoOp = String(row[1]).trim().toUpperCase();
            } else {
                tipoOp = 'CARTERA'; // Por defecto asumir Cartera si no hay columna de tipo
            }
            
            console.log(`  Tipo operación: "${tipoOp}" (idxTipoOp=${idxTipoOp}, row[1]="${row[1]}")`);
            
            // Solo procesar si es tipo "CARTERA" o "CORTO" (acciones), o si no hay columna de tipo
            // Si no hay columna de tipo, asumir que es "CARTERA"
            if (idxTipoOp === -1 && !row[1]) {
                // No hay columna de tipo, asumir CARTERA
                tipoOp = 'CARTERA';
            } else if (tipoOp && !tipoOp.includes('CARTERA') && !tipoOp.includes('CORTO')) {
                console.log(`  → Rechazada: Tipo de operación "${tipoOp}" no es CARTERA ni CORTO`);
                filasRechazadas++;
                continue;
            }
            
            // Determinar tipo de operación según el tipo en el Excel y el signo de la existencia
            // Si el tipo es "CORTO" o la existencia es negativa, es una posición corta (venta)
            // Si es "CARTERA" y la existencia es positiva, es una posición larga (compra)
            const esCorto = tipoOp.includes('CORTO') || existencia < 0;
            const cantidadOperacion = Math.abs(existencia); // Cantidad absoluta para la operación
            const tipoOperacion = esCorto ? 'Venta' : 'Compra';
            
            console.log(`  Tipo operación determinada: ${tipoOperacion} (esCorto=${esCorto}, existencia=${existencia})`);
            
            // Obtener valorización compra directamente del Excel si está disponible
            let montoCalculado = existencia * precioCompra; // Mantener el signo de existencia
            if (idxValorizacionFinal !== -1) {
                const valorizacionRaw = String(row[idxValorizacionFinal] || '0').trim();
                // Detectar si tiene paréntesis (formato contable para negativos)
                const tieneParentesis = valorizacionRaw.includes('(') || valorizacionRaw.includes(')');
                const valorizacionLimpia = valorizacionRaw.replace(/[()]/g, '').replace(/\./g, '').replace(',', '.');
                let valorizacionCompra = parseFloat(valorizacionLimpia) || 0;
                // Si tenía paréntesis, hacer el valor negativo
                if (tieneParentesis && valorizacionCompra > 0) {
                    valorizacionCompra = -valorizacionCompra;
                }
                if (valorizacionCompra !== 0) {
                    montoCalculado = valorizacionCompra; // Mantener el signo (negativo si tenía paréntesis)
                    console.log(`  Usando valorización del Excel: ${montoCalculado} (raw: "${valorizacionRaw}")`);
                } else {
                    console.log(`  Valorización del Excel es 0, usando cálculo: ${montoCalculado}`);
                }
            } else {
                console.log(`  No hay columna VALORIZACIÓN COMPRA, usando cálculo: ${montoCalculado}`);
            }
            
            // Limitar el monto a un valor razonable (máximo 999,999,999,999,999.99)
            // Aceptar valores negativos (para cortos)
            const maxMonto = 999999999999999.99;
            if (Math.abs(montoCalculado) > maxMonto) {
                console.warn(`Monto calculado muy grande para ${instrumento}: ${montoCalculado}, usando ${Math.sign(montoCalculado) * maxMonto}`);
                montoCalculado = Math.sign(montoCalculado) * maxMonto;
            }
            
            // Obtener precio de cierre si está disponible (solo si no se usó como precio compra)
            let precioCierre = null;
            if (idxPrecioCierre !== -1 && !usarPrecioCierre) {
                const precioCierreRaw = row[idxPrecioCierre];
                if (precioCierreRaw !== undefined && precioCierreRaw !== null && precioCierreRaw !== '') {
                    if (typeof precioCierreRaw === 'number') {
                        precioCierre = precioCierreRaw;
                    } else {
                        const precioCierreStr = String(precioCierreRaw).trim();
                        if (precioCierreStr && precioCierreStr !== '0' && precioCierreStr !== '0.00' && precioCierreStr !== '0,00') {
                            // Detectar si tiene paréntesis (formato contable para negativos)
                            const tieneParentesis = precioCierreStr.includes('(') || precioCierreStr.includes(')');
                            const precioCierreLimpio = precioCierreStr.replace(/[()]/g, '').replace(/\./g, '').replace(',', '.');
                            precioCierre = parseFloat(precioCierreLimpio) || null;
                            // Si tenía paréntesis, hacer el valor negativo
                            if (precioCierre !== null && tieneParentesis && precioCierre > 0) {
                                precioCierre = -precioCierre;
                            }
                        }
                    }
                    if (precioCierre !== null) {
                        console.log(`  Precio cierre: ${precioCierre}`);
                    }
                }
            }
            
            // Crear operación según el tipo (Compra o Venta)
            // Para ventas cortas (tipo "CORTO" o existencia negativa), la cantidad será positiva pero el tipo será "Venta"
            // Esto hará que el balance reste la existencia, resultando en una existencia negativa
            console.log(`  ✓ Agregando operación: ${instrumento}, tipo=${tipoOperacion}, cantidad=${cantidadOperacion}, existencia=${existencia}, precio=${precioCompra}, precioCierre=${precioCierre}, monto=${montoCalculado}`);
            operaciones.push({
                Fecha: fechaHoy,
                Nemotecnico: instrumento,
                Cantidad: cantidadOperacion, // Cantidad absoluta
                Precio: precioCompra,
                PrecioCierre: precioCierre,
                Tipo: tipoOperacion, // 'Compra' o 'Venta' según el tipo en Excel y el signo de existencia
                Codigo: 1, // EMF por defecto
                Corredor: 'EMF',
                Cargo: esCorto ? 0 : montoCalculado, // Para cortos/ventas, el cargo es 0
                Abono: esCorto ? Math.abs(montoCalculado) : 0, // Para cortos/ventas, el abono es el monto
                'Fecha Pago': null
            });
            filasProcesadas++;
        }
        
        console.log(`Procesamiento completado: ${filasProcesadas} filas procesadas, ${filasRechazadas} filas rechazadas`);
        
        if (operaciones.length === 0) {
            const totalFilasRevisadas = datos.length - headerRow - 1;
            const errorMsg = `No se encontraron operaciones válidas en la pestaña "${sheetName}". 
Se revisaron ${totalFilasRevisadas} filas después de los encabezados. 
Filas procesadas: ${filasProcesadas}, Filas rechazadas: ${filasRechazadas}.

Verifica:
1. Que las columnas INSTRUMENTO y EXISTENCIA tengan datos válidos
2. Que las filas contengan valores de tipo "CARTERA" o "CORTO" (no CFI ni OSA)
3. Que haya una columna PRECIO COMPRA o VALORIZACIÓN COMPRA con valores válidos
4. Revisa los logs del servidor para ver qué filas se rechazaron y por qué

Índices de columnas encontrados:
- INSTRUMENTO: ${idxInstrumento}
- EXISTENCIA: ${idxExistencia}
- PRECIO COMPRA: ${idxPrecioCompra}
- PRECIO CIERRE: ${idxPrecioCierre}
- VALORIZACIÓN COMPRA: ${idxValorizacionFinal}
- TIPO OPERACIÓN: ${idxTipoOp}`;
            throw new Error(errorMsg);
        }
        
        // Guardar en base de datos
        const result = await saveOperacionesAcciones(operaciones, 'balance_base', nombreArchivo, buffer);
        return result;
    } catch (error) {
        console.error('Error al procesar balance base:', error);
        throw error;
    }
};

// Función para generar Excel transformado a FINIX desde operaciones del historial
const generarExcelTransformado = async (historialId) => {
    const client = await pool.connect();
    try {
        // Obtener operaciones del historial
        const result = await client.query(`
            SELECT 
                fecha,
                nemotecnico,
                cantidad,
                precio,
                monto,
                tipo_operacion,
                codigo_corredor,
                nombre_corredor,
                fecha_pago
            FROM operaciones_acciones
            WHERE historial_id = $1
            ORDER BY fecha ASC, id ASC
        `, [historialId]);

        if (result.rows.length === 0) {
            throw new Error('No se encontraron operaciones para este archivo');
        }

        // Importar XLSX
        const XLSX = require('xlsx');

        // Lista de corredores (misma que en OperacionesAFinix)
        const corredores = [
            { codigo: 1, nombre: 'EMF' },
            { codigo: 20, nombre: 'SECURITY' },
            { codigo: 35, nombre: 'LARRAIN VIAL' },
            { codigo: 47, nombre: 'GBM' },
            { codigo: 56, nombre: 'DEUTSCHE' },
            { codigo: 58, nombre: 'BCI' },
            { codigo: 88, nombre: 'SANTANDER' },
            { codigo: 61, nombre: 'MERRIL' },
            { codigo: 66, nombre: 'CREDICORP CAPITAL' },
            { codigo: 85, nombre: 'SCOTIA' },
            { codigo: 48, nombre: 'SCOTIA' },
            { codigo: 70, nombre: 'BTG PACTUAL' },
            { codigo: 72, nombre: 'CORPBANCA' },
            { codigo: 76, nombre: 'EUROAMERICA' },
            { codigo: 91, nombre: 'PENTA' },
            { codigo: 82, nombre: 'BICE' },
            { codigo: 83, nombre: 'CRUZ DEL SUR' },
            { codigo: 86, nombre: 'BANCHILE' },
            { codigo: 90, nombre: 'CONSORCIO' },
            { codigo: 51, nombre: 'NEVASA' }
        ];

        // Obtener feriados una sola vez para todas las operaciones
        const holidays = await getChileanHolidays();
        
        // Función para verificar si es feriado
        const esFeriado = (date) => {
            // Normalizar la fecha usando métodos locales para evitar problemas de timezone
            const fechaDate = new Date(date);
            const fechaLocal = new Date(fechaDate.getFullYear(), fechaDate.getMonth(), fechaDate.getDate());
            const month = String(fechaLocal.getMonth() + 1).padStart(2, '0');
            const day = String(fechaLocal.getDate()).padStart(2, '0');
            const formattedDate = `${month}-${day}`;
            
            const esFeriadoResult = holidays.some(holiday => holiday.date === formattedDate);
            // Log para debugging
            if (esFeriadoResult) {
                console.log(`[DEBUG esFeriado] ${fechaLocal.toISOString().split('T')[0]} (${formattedDate}) es feriado. Feriados disponibles:`, holidays.map(h => h.date).join(', '));
            }
            return esFeriadoResult;
        };
        
        // Función para obtener siguiente día hábil
        const obtenerSiguienteDiaHabil = (currentDate) => {
            let nextDate = new Date(currentDate);
            nextDate.setDate(nextDate.getDate() + 1);
            const { getDay } = require('date-fns');
            while (getDay(nextDate) === 0 || getDay(nextDate) === 6 || esFeriado(nextDate)) {
                nextDate.setDate(nextDate.getDate() + 1);
            }
            return nextDate;
        };

        // Función para calcular fecha de pago (misma lógica que fechadepago en OperacionesAFinix.js)
        const calcularFechaPago = (fecha, fechaPagoGuardada, condicion = 'CN') => {
            // Siempre calcular de nuevo para asegurar que sea correcta
            // (ignorar fechaPagoGuardada ya que puede estar incorrecta)
            
            // Normalizar la fecha a zona horaria local para evitar problemas con UTC
            const fechaLocal = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
            let fechaPago = new Date(fechaLocal);
            
            const { getDay } = require('date-fns');
            
            // Log para debugging
            console.log(`[DEBUG calcularFechaPago] Fecha inicial: ${fechaLocal.toISOString().split('T')[0]}, Condición: ${condicion}`);
            
            switch (condicion) {
                case 'PM':
                    // Para condición PM, la fecha de pago es un día hábil después
                    fechaPago = obtenerSiguienteDiaHabil(fechaPago);
                    break;
                
                case 'PH':
                    // Para condición PH, se paga el mismo día
                    // Si es fin de semana o feriado, se paga el siguiente día hábil
                    if (getDay(fechaPago) === 0 || getDay(fechaPago) === 6 || esFeriado(fechaPago)) {
                        fechaPago = obtenerSiguienteDiaHabil(fechaPago);
                    }
                    break;
                
                case 'CN':
                default:
                    // Para condición CN o cualquier otro caso, se suma 2 días hábiles
                    // Primero avanzamos un día
                    fechaPago.setDate(fechaPago.getDate() + 1);
                    console.log(`[DEBUG CN] Después de +1 día: ${fechaPago.toISOString().split('T')[0]}, día semana: ${getDay(fechaPago)}, es feriado: ${esFeriado(fechaPago)}`);
                    
                    // Luego avanzamos hasta encontrar el primer día hábil
                    while (getDay(fechaPago) === 0 || getDay(fechaPago) === 6 || esFeriado(fechaPago)) {
                        console.log(`[DEBUG CN] Saltando día: ${fechaPago.toISOString().split('T')[0]} (día semana: ${getDay(fechaPago)}, es feriado: ${esFeriado(fechaPago)})`);
                        fechaPago.setDate(fechaPago.getDate() + 1);
                    }
                    console.log(`[DEBUG CN] Primer día hábil encontrado: ${fechaPago.toISOString().split('T')[0]}`);
                    
                    // Avanzamos otro día
                    fechaPago.setDate(fechaPago.getDate() + 1);
                    console.log(`[DEBUG CN] Después de +1 día más: ${fechaPago.toISOString().split('T')[0]}, día semana: ${getDay(fechaPago)}, es feriado: ${esFeriado(fechaPago)}`);
                    
                    // Y avanzamos hasta encontrar el segundo día hábil
                    while (getDay(fechaPago) === 0 || getDay(fechaPago) === 6 || esFeriado(fechaPago)) {
                        console.log(`[DEBUG CN] Saltando día: ${fechaPago.toISOString().split('T')[0]} (día semana: ${getDay(fechaPago)}, es feriado: ${esFeriado(fechaPago)})`);
                        fechaPago.setDate(fechaPago.getDate() + 1);
                    }
                    console.log(`[DEBUG CN] Segundo día hábil encontrado: ${fechaPago.toISOString().split('T')[0]}`);
                    break;
            }
            
            return fechaPago;
        };

        // Transformar operaciones al formato FINIX
        const datosDestino = result.rows.map((row) => {
            // Crear fecha usando métodos locales para evitar problemas de timezone
            // PostgreSQL devuelve fechas como string 'YYYY-MM-DD' o como Date object
            let fecha;
            if (typeof row.fecha === 'string') {
                // Si es string, parsear directamente como YYYY-MM-DD
                const partes = row.fecha.split('-');
                fecha = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
            } else if (row.fecha instanceof Date) {
                // Si es Date object de PostgreSQL, puede estar en UTC
                // Usar métodos UTC para extraer año, mes y día, luego crear fecha local
                const year = row.fecha.getUTCFullYear();
                const month = row.fecha.getUTCMonth();
                const day = row.fecha.getUTCDate();
                fecha = new Date(year, month, day);
            } else {
                // Si es otro tipo, intentar convertir a string primero
                const fechaStr = String(row.fecha);
                if (fechaStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                    const partes = fechaStr.split('-');
                    fecha = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
                } else {
                    // Último recurso: crear Date y normalizar
                    const fechaBD = new Date(row.fecha);
                    fecha = new Date(fechaBD.getUTCFullYear(), fechaBD.getUTCMonth(), fechaBD.getUTCDate());
                }
            }
            
            // Log para debugging (solo para la primera operación de cada historial)
            // Usar un contador estático o simplemente loggear la primera vez
            
            const esCompra = row.tipo_operacion === 'Compra';
            const codigoCorredor = parseInt(row.codigo_corredor) || 0;
            const corredorNombre = corredores.find(c => c.codigo === codigoCorredor)?.nombre || row.nombre_corredor || '';
            
            // Calcular fecha de pago (siempre calcular de nuevo para asegurar que sea correcta)
            const fechaPago = calcularFechaPago(fecha, row.fecha_pago, 'CN');
            
            // Log temporal para debugging
            if (row.nemotecnico && row.nemotecnico.length > 0) {
                const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${fecha.getFullYear()}`;
                const fechaPagoStr = `${String(fechaPago.getDate()).padStart(2, '0')}-${String(fechaPago.getMonth() + 1).padStart(2, '0')}-${fechaPago.getFullYear()}`;
                console.log(`[DEBUG] Fecha operación: ${fechaStr} (${fecha.toISOString()}), Fecha pago calculada: ${fechaPagoStr} (${fechaPago.toISOString()}), Nemotécnico: ${row.nemotecnico}, row.fecha original: ${row.fecha} (tipo: ${typeof row.fecha})`);
            }
            
            return {
                Fecha: fecha,
                Codigo: codigoCorredor,
                'Tipo Operación': esCompra ? `Compra ${row.nemotecnico.toLowerCase().trim()}` : `Venta ${row.nemotecnico.toLowerCase().trim()}`,
                Cantidad: parseFloat(row.cantidad) || 0,
                Precio: parseFloat(row.precio) || 0,
                'Dcto.': 0,
                Comision: 0,
                Iva: 0,
                Abono: esCompra ? 0 : Math.round(parseFloat(row.monto) || 0),
                Cargo: esCompra ? Math.round(parseFloat(row.monto) || 0) : 0,
                Saldo: 0,
                'Fecha Pago': fechaPago, // Devolver como Date, igual que en OperacionesAFinix.js
                Corredor: corredorNombre.trim(),
                Tipo: row.tipo_operacion,
                '': '',
                Tasa: '',
                Vcto: ''
            };
        });

        // Crear workbook
        const newWorkbook = XLSX.utils.book_new();

        // Crear hojas vacías
        const sheetsToCreate = ['FIP', 'Corredores', 'Operaciones Security', 'Hoja1', 'Hoja2'];
        sheetsToCreate.forEach((sheetName) => {
            const newSheet = XLSX.utils.json_to_sheet([[]]);
            XLSX.utils.book_append_sheet(newWorkbook, newSheet, sheetName);
        });

        // Agregar datos de corredores
        const corredoresData = [
            ['Cod.', 'Corredor', '%', '% Otros'],
            [1, 'EMF', '', ''],
            [20, 'SECURITY', '0.020%', ''],
            [35, 'LARRAIN VIAL', '0.050%', '0.100%'],
            [47, 'GBM', '0.021%', ''],
            [56, 'DEUTSCHE', '0.000%', ''],
            [58, 'BCI', '0.030%', ''],
            [88, 'SANTANDER', '0.040%', ''],
            [61, 'MERRIL', '0.000%', ''],
            [66, 'CREDICORP CAPITAL', '0.050%', ''],
            [85, 'SCOTIA', '0.050%', ''],
            [48, 'SCOTIA', '0.050%', ''],
            [70, 'BTG PACTUAL', '0.100%', '0.150%'],
            [72, 'CORPBANCA', '0.000%', ''],
            [76, 'EUROAMERICA', '0.000%', ''],
            [91, 'PENTA', '0.000%', ''],
            [82, 'BICE', '0.000%', ''],
            [83, 'CRUZ DEL SUR', '0.000%', ''],
            [86, 'BANCHILE', '0.030%', ''],
            [90, 'CONSORCIO', '0.025%', ''],
            [51, 'NEVASA', '0.050%', '']
        ];

        XLSX.utils.sheet_add_aoa(newWorkbook.Sheets['Corredores'], corredoresData, {
            skipHeader: true,
            origin: 'A1'
        });

        // Formatear datos para Excel
        const datosParaExcel = datosDestino.map(fila => {
            // Formatear fecha como YYYY-MM-DD
            let fechaFormateada = '';
            if (fila.Fecha instanceof Date) {
                const year = fila.Fecha.getFullYear();
                const month = String(fila.Fecha.getMonth() + 1).padStart(2, '0');
                const day = String(fila.Fecha.getDate()).padStart(2, '0');
                fechaFormateada = `${year}-${month}-${day}`;
            } else if (fila.Fecha) {
                fechaFormateada = String(fila.Fecha);
            }

            // Formatear fecha de pago como YYYY-MM-DD
            let fechaPagoFormateada = '';
            if (fila['Fecha Pago'] instanceof Date) {
                const year = fila['Fecha Pago'].getFullYear();
                const month = String(fila['Fecha Pago'].getMonth() + 1).padStart(2, '0');
                const day = String(fila['Fecha Pago'].getDate()).padStart(2, '0');
                fechaPagoFormateada = `${year}-${month}-${day}`;
            } else if (fila['Fecha Pago']) {
                fechaPagoFormateada = String(fila['Fecha Pago']);
            }

            return {
                Fecha: fechaFormateada,
                Codigo: fila.Codigo,
                'Tipo Operación': fila['Tipo Operación'].trim(),
                Cantidad: fila.Cantidad,
                Precio: fila.Precio,
                'Dcto.': fila['Dcto.'],
                Comision: fila.Comision,
                Iva: fila.Iva,
                Abono: fila.Abono,
                Cargo: fila.Cargo,
                Saldo: fila.Saldo,
                'Fecha Pago': fechaPagoFormateada,
                Corredor: fila.Corredor.trim(),
                Tipo: fila.Tipo.trim(),
                '': '',
                Tasa: '',
                Vcto: ''
            };
        });

        const hojaFIP = XLSX.utils.json_to_sheet(datosParaExcel, {
            skipHeader: false,
            origin: 'A1',
            cellDates: false // No usar cellDates porque las fechas ya están formateadas como strings
        });

        // Aplicar formatos
        const range = XLSX.utils.decode_range(hojaFIP['!ref']);
        const maxWidths = {}; // Para calcular anchos máximos por columna
        
        for (let R = range.s.r; R <= range.e.r; R++) {
            for (let C = range.s.c; C <= range.e.c; C++) {
                const cell = XLSX.utils.encode_cell({r: R, c: C});
                if (hojaFIP[cell]) {
                    if (hojaFIP[cell].t === 's') {
                        hojaFIP[cell].v = hojaFIP[cell].v.trim();
                    }
                    
                    // Calcular ancho máximo de la columna
                    let cellValue = '';
                    if (hojaFIP[cell].v !== null && hojaFIP[cell].v !== undefined) {
                        cellValue = String(hojaFIP[cell].v);
                    }
                    const cellWidth = cellValue.length;
                    if (!maxWidths[C] || cellWidth > maxWidths[C]) {
                        maxWidths[C] = cellWidth;
                    }
                    
                    if (R > 0) {
                        if (C === 0) { // Columna de fecha (ya formateada como string DD-MM-YYYY)
                            // Mantener como texto para conservar el formato DD-MM-YYYY
                            hojaFIP[cell].t = 's';
                        } else if (C === 11) { // Columna de Fecha Pago (ya formateada como string DD-MM-YYYY)
                            // Mantener como texto para conservar el formato DD-MM-YYYY
                            hojaFIP[cell].t = 's';
                        } else if (C === 3) {
                            hojaFIP[cell].t = 'n';
                            hojaFIP[cell].z = '#,##0';
                        } else if (C === 4) {
                            hojaFIP[cell].t = 'n';
                            hojaFIP[cell].z = '#,##0.00';
                        } else if (C === 8 || C === 9) {
                            hojaFIP[cell].t = 'n';
                            hojaFIP[cell].z = '#,##0';
                        }
                    }
                }
            }
        }

        // Autoajustar anchos de columna
        const colWidths = [];
        for (let C = range.s.c; C <= range.e.c; C++) {
            const maxWidth = maxWidths[C] || 10; // Mínimo 10 caracteres
            // Agregar un poco de padding (2 caracteres) y establecer un máximo razonable
            const width = Math.min(Math.max(maxWidth + 2, 10), 50);
            colWidths.push({ wch: width });
        }
        hojaFIP['!cols'] = colWidths;

        newWorkbook.Sheets['FIP'] = hojaFIP;

        // Generar buffer del Excel
        const buffer = XLSX.write(newWorkbook, { 
            bookType: 'xls', 
            type: 'buffer',
            bookSST: true
        });

        return buffer;
    } catch (error) {
        console.error('Error al generar Excel transformado:', error);
        throw error;
    } finally {
        client.release();
    }
};

// Función para eliminar un archivo del historial y sus operaciones relacionadas
const eliminarArchivoHistorial = async (id) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Primero obtener el nombre del archivo y contar operaciones
        const historialResult = await client.query(
            'SELECT nombre_archivo, tipo FROM historial_archivos WHERE id = $1',
            [id]
        );
        
        if (historialResult.rows.length === 0) {
            throw new Error('Archivo no encontrado en el historial');
        }
        
        const { nombre_archivo, tipo } = historialResult.rows[0];
        
        // Contar operaciones que se eliminarán
        const countResult = await client.query(
            'SELECT COUNT(*) as count FROM operaciones_acciones WHERE historial_id = $1',
            [id]
        );
        const operacionesEliminadas = parseInt(countResult.rows[0].count) || 0;
        
        // Eliminar primero las operaciones relacionadas con este historial_id
        // Esto asegura que solo se eliminen las operaciones de este archivo específico
        await client.query(
            'DELETE FROM operaciones_acciones WHERE historial_id = $1',
            [id]
        );
        
        // Eliminar el registro del historial
        await client.query(
            'DELETE FROM historial_archivos WHERE id = $1',
            [id]
        );
        
        await client.query('COMMIT');
        
        console.log(`Archivo "${nombre_archivo}" eliminado. Operaciones eliminadas: ${operacionesEliminadas}`);
        
        return {
            success: true,
            operacionesEliminadas: operacionesEliminadas,
            nombreArchivo: nombre_archivo
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al eliminar archivo del historial:', error);
        throw error;
    } finally {
        client.release();
    }
};

const getHistorialArchivos = async () => {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT 
                id,
                nombre_archivo,
                tipo,
                fecha_procesamiento,
                cantidad_operaciones,
                fecha_archivo
            FROM historial_archivos
            ORDER BY fecha_procesamiento DESC
        `);
        
        return result.rows.map(row => ({
            id: row.id,
            nombreArchivo: row.nombre_archivo,
            tipo: row.tipo,
            fechaProcesamiento: row.fecha_procesamiento,
            cantidadOperaciones: row.cantidad_operaciones,
            fechaArchivo: row.fecha_archivo ? format(new Date(row.fecha_archivo), 'yyyy-MM-dd') : null
        }));
    } catch (error) {
        console.error('Error al obtener historial:', error);
        throw error;
    } finally {
        client.release();
    }
};

// Inicializar tabla al cargar el módulo
initOperacionesTable().catch(console.error);

module.exports = { 
    pool,
    saveDataToDatabase,
    updateDataAndSave,
    saveOperacionesAcciones,
    getBalanceAcciones,
    procesarBalanceBase,
    eliminarArchivoHistorial,
    generarExcelTransformado,
    updateSpecificDate,
    downloadExcel,
    updateDataAndSaveForced,
    updateDataFromDate,
    removeHolidaysFromDatabase,
    isChileanHoliday,
    getChileanHolidays,
    saveOperacionesAcciones,
    getBalanceAcciones,
    procesarBalanceBase,
    getHistorialArchivos,
    eliminarArchivoHistorial
};