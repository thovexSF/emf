const functions = require("firebase-functions");
const axios = require("axios");
const cheerio = require("cheerio");

exports.getDataFromSource = functions.https.onRequest(async (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).send("Date is required");
    }

    const url = `https://estadisticas2.aafm.cl/DailyStadistics?Date=${date}&IdCategoryAafm=9&IdCategoryAafm=42&IdCategoryAafm=57&IdCategoryAafm=43&IdCategoryAafm=16&IdAdministrator=0&Apv=3&InversionType=N&ContributedFlow=true&RescuedFlow=true`;
    const headers = {
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    };

    try {
        const response = await axios.post(url, {}, { headers });
        const html = response.data;
        const $ = cheerio.load(html);

        const flujo_aportes = parseFloat($("tfoot tr td").eq(4).text().trim().replace(/\./g, "").replace(/,/g, "."));
        const flujo_rescates = parseFloat($("tfoot tr td").eq(5).text().trim().replace(/\./g, "").replace(/,/g, "."));

        const data = {
            fecha: date,
            flujo_aportes: isNaN(flujo_aportes) ? 0 : Math.round(flujo_aportes),
            flujo_rescates: isNaN(flujo_rescates) ? 0 : Math.round(flujo_rescates)
        };

        res.json(data);
    } catch (error) {
        console.error(`Error fetching data for ${date}:`, error);
        res.status(500).json({ error: error.message });
    }
});