const axios = require("axios");
const ExcelJS = require('exceljs');

class AYRScraper {
    constructor() {
        this.baseUrl = 'https://estadisticas2.aafm.cl/DailyStadistics/ExportDailyStadistics';
        this.headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Origin": "https://estadisticas2.aafm.cl",
            "Referer": "https://estadisticas2.aafm.cl/DailyStadistics"
        };
    }

    formatDate(date) {
        const dateObj = new Date(date);
        return dateObj.toLocaleDateString('en-US') + ' 12:00:00 AM';
    }

    createFormData(date) {
        const formattedDate = this.formatDate(date);
        
        return new URLSearchParams({
            'Apv': '3',
            'InversionType': 'N',
            'Date': formattedDate,
            'ContributedFlow': 'True',
            'RescuedFlow': 'True',
            'QuoteValue': 'False',
            'CirculationQuote': 'False',
            'ContributedQuote': 'False',
            'RescueQuote': 'False',
            'InstitutionalParticipants': 'False',
            'OtherParticipants': 'False',
            'TotalParticipants': 'False',
            'EffectivePatrimony': 'False',
            'NetPatrimony': 'False',
            'Remunerations': 'False',
            'Commissions': 'False',
            'Expenses': 'False',
            'Money': 'False',
            'CategoryCmf': 'False',
            'BloombergCode': 'False',
            'PensionFund': 'False',
            'ListAdministrators': '',
            'ListCategoryAafm': '9,42,57,43,16'
        });
    }

    async downloadExcelFile(date, retries = 3) {
        const formData = this.createFormData(date);
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.log(`[${new Date().toISOString()}] Downloading Excel for ${date} (attempt ${attempt}/${retries})`);
                
                const response = await axios.post(this.baseUrl, formData, {
                    headers: this.headers,
                    timeout: 20000 // Más tiempo para Railway
                });

                if (response.status !== 200) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                if (!response.data || !response.data.FileContents) {
                    throw new Error("No Excel file received in response");
                }

                console.log(`[${new Date().toISOString()}] Excel downloaded successfully: ${response.data.FileContents.length} bytes`);
                return Buffer.from(response.data.FileContents);

            } catch (error) {
                console.error(`[${new Date().toISOString()}] Attempt ${attempt} failed:`, error.message);
                
                if (attempt === retries) {
                    throw new Error(`Failed to download Excel after ${retries} attempts: ${error.message}`);
                }
                
                // Backoff exponencial
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async parseExcelData(buffer, date) {
        try {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);
            
            if (workbook.worksheets.length === 0) {
                throw new Error("No worksheets found in Excel file");
            }

            const worksheet = workbook.worksheets[0];
            console.log(`[${new Date().toISOString()}] Processing worksheet: ${worksheet.name} (${worksheet.rowCount}x${worksheet.columnCount})`);

            // Estrategia 1: Buscar por headers específicos
            const headerResult = this.findDataByHeaders(worksheet, date);
            if (headerResult.found) {
                console.log(`[${new Date().toISOString()}] Data found by headers`);
                return headerResult.data;
            }

            // Estrategia 2: Buscar fila TOTAL
            console.log(`[${new Date().toISOString()}] Headers not found, searching for TOTAL row...`);
            const totalResult = this.findDataInTotals(worksheet, date);
            if (totalResult.found) {
                console.log(`[${new Date().toISOString()}] Data found in TOTAL row`);
                return totalResult.data;
            }

            // Estrategia 3: Análisis de números grandes
            console.log(`[${new Date().toISOString()}] TOTAL not found, analyzing large numbers...`);
            const numberResult = this.analyzeLargeNumbers(worksheet, date);
            return numberResult;

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error parsing Excel:`, error.message);
            throw error;
        }
    }

    findDataByHeaders(worksheet, date) {
        let aportesColumn = -1;
        let rescatesColumn = -1;
        
        // Buscar headers en las primeras 10 filas
        for (let rowNum = 1; rowNum <= Math.min(10, worksheet.rowCount); rowNum++) {
            const row = worksheet.getRow(rowNum);
            
            row.eachCell((cell, colNumber) => {
                const cellValue = cell.value ? cell.value.toString().toLowerCase() : '';
                
                if (cellValue.includes('flujo aporte')) {
                    aportesColumn = colNumber;
                    console.log(`[${new Date().toISOString()}] Found Aportes column: ${colNumber}`);
                }
                if (cellValue.includes('flujo rescate')) {
                    rescatesColumn = colNumber;
                    console.log(`[${new Date().toISOString()}] Found Rescates column: ${colNumber}`);
                }
            });
        }

        if (aportesColumn > 0 && rescatesColumn > 0) {
            let flujo_aportes = 0;
            let flujo_rescates = 0;
            let rowsWithData = 0;
            
            // Sumar desde fila 9 en adelante
            for (let rowNum = 9; rowNum <= worksheet.rowCount; rowNum++) {
                const row = worksheet.getRow(rowNum);
                
                const aportesValue = parseFloat(row.getCell(aportesColumn).value) || 0;
                const rescatesValue = parseFloat(row.getCell(rescatesColumn).value) || 0;
                
                if (aportesValue !== 0 || rescatesValue !== 0) {
                    flujo_aportes += aportesValue;
                    flujo_rescates += rescatesValue;
                    rowsWithData++;
                }
            }

            console.log(`[${new Date().toISOString()}] Processed ${rowsWithData} data rows. Totals: ${flujo_aportes}, ${flujo_rescates}`);

            return {
                found: true,
                data: {
                    fecha: date,
                    flujo_aportes: Math.round(flujo_aportes),
                    flujo_rescates: Math.round(flujo_rescates)
                }
            };
        }

        return { found: false };
    }

    findDataInTotals(worksheet, date) {
        for (let rowNum = 1; rowNum <= worksheet.rowCount; rowNum++) {
            const row = worksheet.getRow(rowNum);
            
            let isTotalRow = false;
            row.eachCell((cell, colNumber) => {
                const cellValue = cell.value ? cell.value.toString().toUpperCase() : '';
                if (cellValue === 'TOTAL') {
                    isTotalRow = true;
                }
            });
            
            if (isTotalRow) {
                console.log(`[${new Date().toISOString()}] Found TOTAL row at ${rowNum}`);
                
                // Columnas 6 y 7 basado en la estructura conocida
                const aportesValue = parseFloat(row.getCell(6).value) || 0;
                const rescatesValue = parseFloat(row.getCell(7).value) || 0;
                
                console.log(`[${new Date().toISOString()}] TOTAL values: Aportes=${aportesValue}, Rescates=${rescatesValue}`);
                
                return {
                    found: true,
                    data: {
                        fecha: date,
                        flujo_aportes: Math.round(aportesValue),
                        flujo_rescates: Math.round(rescatesValue)
                    }
                };
            }
        }

        return { found: false };
    }

    analyzeLargeNumbers(worksheet, date) {
        const largeNumbers = [];
        
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber <= 8) return; // Saltar headers
            
            row.eachCell((cell, colNumber) => {
                const value = parseFloat(cell.value);
                if (!isNaN(value) && value > 1000) { // Buscar números > 1000
                    largeNumbers.push({ value, row: rowNumber, col: colNumber });
                }
            });
        });

        console.log(`[${new Date().toISOString()}] Found ${largeNumbers.length} numbers > 1000`);

        if (largeNumbers.length >= 2) {
            largeNumbers.sort((a, b) => b.value - a.value);
            const flujo_aportes = largeNumbers[0].value;
            const flujo_rescates = largeNumbers[1].value;
            
            console.log(`[${new Date().toISOString()}] Using largest numbers: ${flujo_aportes}, ${flujo_rescates}`);
            
            return {
                fecha: date,
                flujo_aportes: Math.round(flujo_aportes),
                flujo_rescates: Math.round(flujo_rescates)
            };
        }

        // Retornar ceros si no se encuentra nada
        console.log(`[${new Date().toISOString()}] No significant numbers found, returning zeros`);
        return {
            fecha: date,
            flujo_aportes: 0,
            flujo_rescates: 0
        };
    }

    async scrapeAYRData(date) {
        const startTime = Date.now();
        
        try {
            console.log(`[${new Date().toISOString()}] Starting AYR scrape for ${date}`);
            
            // Validar fecha
            if (!date || !this.isValidDate(date)) {
                throw new Error("Invalid date format. Expected YYYY-MM-DD");
            }
            
            const buffer = await this.downloadExcelFile(date);
            const data = await this.parseExcelData(buffer, date);
            
            // Validar resultados
            this.validateData(data);
            
            const duration = Date.now() - startTime;
            console.log(`[${new Date().toISOString()}] Scrape completed for ${date} in ${duration}ms:`, data);
            
            return data;
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[${new Date().toISOString()}] Scrape failed for ${date} after ${duration}ms:`, error.message);
            throw error;
        }
    }

    isValidDate(dateString) {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(dateString)) return false;
        
        const date = new Date(dateString);
        return date instanceof Date && !isNaN(date);
    }

    validateData(data) {
        if (!data.fecha) {
            throw new Error("Missing date in extracted data");
        }
        
        if (data.flujo_aportes < 0 || data.flujo_rescates < 0) {
            throw new Error("Negative values detected in extracted data");
        }
        
        const maxValue = 50000000000; // 50 mil millones
        if (data.flujo_aportes > maxValue || data.flujo_rescates > maxValue) {
            throw new Error("Values seem unreasonably large");
        }
        
        return true;
    }
}

module.exports = AYRScraper; 