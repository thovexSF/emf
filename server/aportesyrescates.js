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
module.exports = { 
    pool,
    saveDataToDatabase,
    updateDataAndSave,
    updateSpecificDate,
    downloadExcel
};