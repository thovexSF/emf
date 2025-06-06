const axios = require("axios");
const cheerio = require("cheerio");

class SimpleAYRScraper {
    constructor() {
        this.baseUrl = 'https://estadisticas2.aafm.cl/DailyStadistics';
        this.headers = {
            "Cache-Control": "no-cache",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
        };
    }

    formatDateForUrl(date) {
        // Convertir YYYY-MM-DD a formato MM/DD/YYYY
        const [year, month, day] = date.split('-');
        return `${month}/${day}/${year}`;
    }

    buildUrl(date) {
        const formattedDate = this.formatDateForUrl(date);
        return `${this.baseUrl}?Date=${formattedDate}&IdCategoryAafm=9&IdCategoryAafm=42&IdCategoryAafm=57&IdCategoryAafm=43&IdCategoryAafm=16&IdAdministrator=0&Apv=3&InversionType=N&ContributedFlow=true&RescuedFlow=true`;
    }

    async scrapeAYRData(date) {
        const startTime = Date.now();
        
        try {
            console.log(`[${new Date().toISOString()}] Starting simple AYR scrape for ${date}`);
            
            // Validar fecha
            if (!date || !this.isValidDate(date)) {
                throw new Error("Invalid date format. Expected YYYY-MM-DD");
            }
            
            const url = this.buildUrl(date);
            console.log(`[${new Date().toISOString()}] Fetching URL: ${url}`);
            
            const response = await axios.post(url, {}, { 
                headers: this.headers,
                timeout: 15000 // 15 segundos timeout
            });
            
            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const html = response.data;
            const $ = cheerio.load(html);
            
            // Extraer datos del HTML usando la misma lógica que funcionaba antes
            const flujo_aportes = parseFloat($("tfoot tr td").eq(4).text().trim().replace(/\./g, "").replace(/,/g, "."));
            const flujo_rescates = parseFloat($("tfoot tr td").eq(5).text().trim().replace(/\./g, "").replace(/,/g, "."));
            
            const data = {
                fecha: date,
                flujo_aportes: isNaN(flujo_aportes) ? 0 : Math.round(flujo_aportes),
                flujo_rescates: isNaN(flujo_rescates) ? 0 : Math.round(flujo_rescates)
            };
            
            // Validar resultados
            this.validateData(data);
            
            const duration = Date.now() - startTime;
            console.log(`[${new Date().toISOString()}] Simple scrape completed for ${date} in ${duration}ms:`, data);
            
            return data;
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[${new Date().toISOString()}] Simple scrape failed for ${date} after ${duration}ms:`, error.message);
            
            // En caso de error, devolver valores cero para no romper el flujo
            return {
                fecha: date,
                flujo_aportes: 0,
                flujo_rescates: 0
            };
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
            console.warn(`Values seem unusually high for ${data.fecha}, but accepting:`, data);
        }
        
        return true;
    }
}

module.exports = SimpleAYRScraper; 