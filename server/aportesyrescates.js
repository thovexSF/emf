const axios = require('axios');
const { getDay, format, addDays, subDays, isSameMonth, getDate, parseISO, addHours } = require('date-fns');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

// Configuración de la conexión a PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
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

// Modificar para llamar a la función de Firebase
const getDataFromSource = async (fecha) => {
    const firebaseFunctionUrl = `https://us-central1-emf-ayr.cloudfunctions.net/getDataFromSource?date=${fecha}`;

    try {
        const response = await axios.get(firebaseFunctionUrl);
        const data = response.data;
        console.log(`Fetched data for ${fecha}:`, data);
        return data;
    } catch (error) {
        console.error(`Error fetching data for ${fecha}:`, error);
        return null;
    }
};

const saveDataToDatabase = async (data) => {
    if (!Array.isArray(data)) {
        throw new TypeError("Data is not iterable");
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let lastDate = null;
        let acumulado_aportes = 0;
        let acumulado_rescates = 0;

        for (const entry of data) {
            const entryDate = parseISO(entry.fecha);
            console.log(`Procesando entrada para ${entry.fecha}, día: ${getDate(entryDate)}`); // Depuración
            console.log(`Día de la semana: ${getDay(entryDate)}`);
            console.log(getDate(entryDate))
            if (getDay(entryDate) === 6 || getDay(entryDate) === 0) { // Si el día es sábado (6) o domingo (0), continuar
                continue;
            }

            // Reiniciar acumulados si estamos en el primer día de un nuevo mes
            if (getDate(entryDate) === 1) {
                acumulado_aportes = 0;
                acumulado_rescates = 0;
                console.log(`Reiniciando acumulados para ${entry.fecha}`);
            } else {
                // Consultar el último registro para obtener los valores acumulados actuales
                const result = await client.query('SELECT * FROM daily_statistics WHERE fecha < $1 ORDER BY fecha DESC LIMIT 1', [entry.fecha]);
                if (result.rows.length > 0 && isSameMonth(result.rows[0].fecha, entryDate)) {
                    acumulado_aportes = parseFloat(result.rows[0].acumulado_aportes) || 0;
                    acumulado_rescates = parseFloat(result.rows[0].acumulado_rescates) || 0;
                }
            }

            console.log(`Antes de actualización: acumulado_aportes=${acumulado_aportes}, acumulado_rescates=${acumulado_rescates}`);

            // Actualizar los acumulados con los nuevos datos de flujo_aportes y flujo_rescates
            acumulado_aportes += entry.flujo_aportes;
            acumulado_rescates += entry.flujo_rescates;

            console.log(`Después de actualización: acumulado_aportes=${acumulado_aportes}, acumulado_rescates=${acumulado_rescates}`);

            // Insertar o actualizar los datos en la tabla daily_statistics
            await client.query(`
                INSERT INTO daily_statistics (fecha, flujo_aportes, flujo_rescates, neto_aportes_rescates, acumulado_aportes, acumulado_rescates, neto_acumulado) 
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (fecha) DO UPDATE SET
                flujo_aportes = EXCLUDED.flujo_aportes,
                flujo_rescates = EXCLUDED.flujo_rescates,
                neto_aportes_rescates = EXCLUDED.neto_aportes_rescates,
                acumulado_aportes = EXCLUDED.acumulado_aportes,
                acumulado_rescates = EXCLUDED.acumulado_rescates,
                neto_acumulado = EXCLUDED.neto_acumulado`,
                [entry.fecha, entry.flujo_aportes, entry.flujo_rescates, entry.flujo_aportes - entry.flujo_rescates,
                 acumulado_aportes, acumulado_rescates, acumulado_aportes - acumulado_rescates]
            );

            lastDate = entry.fecha;
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const updateDataAndSave = async () => {
    const client = await pool.connect();
    try {
        // Determinar la fecha de inicio y de fin
        const startDate = new Date('2024-01-01');
        console.log(startDate)
        const endDate = subDays(new Date(), 1); // Fecha de fin es el día anterior a la fecha actual

        // Obtener todas las fechas registradas
        const result = await client.query('SELECT fecha FROM daily_statistics ORDER BY fecha');
        const registeredDates = new Set(result.rows.map(row => format(parseISO(row.fecha), 'yyyy-MM-dd')));

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

        console.log('Fechas a procesar:', datesToProcess);

         // Procesar las fechas en orden
         for (const date of datesToProcess) {
            console.log(`Obteniendo datos para ${date}`);
            const data = await getDataFromSource(date);
            if (data) {
                data.fecha = format(addHours(new Date(data.fecha), 12), 'yyyy-MM-dd'); // Ajusta la fecha
                console.log(`Guardando datos para ${date}`);
                await saveDataToDatabase([data]);
                console.log(`Datos procesados para ${date}`);
            } else {
                console.log(`No se obtuvieron datos para ${date}`);
            }
        }

        console.log('Datos diarios actualizados y guardados en la base de datos');

    } catch (err) {
        console.error('Error actualizando datos diarios:', err.message);
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