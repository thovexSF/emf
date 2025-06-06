const axios = require('axios');
const { getDay, format, addDays, subDays, isSameMonth, getDate, parseISO, addHours } = require('date-fns');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
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
                const date = new Date(holiday.date);
                const monthDay = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                return {
                    date: monthDay,
                    name: holiday.name || 'Feriado',
                    fullDate: holiday.date
                };
            });
            
            console.log(`✅ Successfully loaded ${holidays.length} Chilean holidays from API`);
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

module.exports = { 
    pool,
    saveDataToDatabase,
    updateDataAndSave,
    updateSpecificDate,
    downloadExcel,
    updateDataAndSaveForced,
    updateDataFromDate,
    removeHolidaysFromDatabase,
    isChileanHoliday,
    getChileanHolidays
};