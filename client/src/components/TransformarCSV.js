import React, { useState } from 'react';
import * as XLSX from 'xlsx';
// import { saveAs } from 'file-saver';
import { addDays, format } from 'date-fns';
import './TransformarCSV.css';

const TransformarCSV = () => {
    const [file, setFile] = useState(null);
    const [data, setData] = useState([]);

    const handleFileUpload = (event) => {
        setFile(event.target.files[0]);
    };

    const handleFileRead = async (event) => {
        event.preventDefault();
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const binaryStr = e.target.result;
                const workbook = XLSX.read(binaryStr, { type: 'binary' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                setData(jsonData);
            };
            reader.readAsBinaryString(file);
        }
    };

    const handleDownload = () => {
        const mappedData = mapearATablaDestino(data);
        const newWorkbook = XLSX.utils.book_new();
        const hojaFIP = XLSX.utils.json_to_sheet(mappedData);
        XLSX.utils.book_append_sheet(newWorkbook, hojaFIP, 'FIP');

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
        const hojaCorredores = XLSX.utils.aoa_to_sheet(corredoresData);
        XLSX.utils.book_append_sheet(newWorkbook, hojaCorredores, 'Corredores');

        const fechaOutput = format(new Date(), "dd.MM.yyyy");
        XLSX.writeFile(newWorkbook, `Control Operaciones Diarias FIP ${fechaOutput}.xlsx`);
    };

    const mapearATablaDestino = (datos) => {
        return datos.map(({
            Fecha,
            Cod_Corredor_Vende,
            Nombre_Corredor_Vende,
            Cod_Corredor_Compra,
            Nombre_Corredor_Compra,
            Cantidad,
            Precio,
            Compra,
            Nemotecnico,
            Monto
        }) => {
            const year = Fecha.substring(0, 4);
            const month = Fecha.substring(4, 6);
            const day = Fecha.substring(6, 8);

            const fecha = new Date(`${year}-${month}-${day}T20:00:00.000Z`);
            const fechaPago = fechadepago(fecha);

            const montoLimpio = String(Monto).trim().replace(/\./g, '').replace(',', '.');
            const precioLimpio = parseFloat(Precio.replace(',', '.'));
            const esCompra = Compra === "832";

            return {
                Fecha: fecha,
                Codigo: parseFloat(esCompra ? Cod_Corredor_Compra : Cod_Corredor_Vende),
                'Tipo Operación': esCompra ? `Compra ${Nemotecnico.toLowerCase().trim()}` : `Venta ${Nemotecnico.toLowerCase().trim()}`,
                Cantidad: parseInt(Cantidad),
                Precio: precioLimpio,
                'Dcto.': 0,
                Comision: 0,
                Iva: 0,
                Abono: esCompra ? 0 : parseFloat(montoLimpio),
                Cargo: esCompra ? parseFloat(montoLimpio) : 0,
                Saldo: 0,
                'Fecha Pago': fechaPago,
                Corredor: esCompra ? Nombre_Corredor_Compra.trim() : Nombre_Corredor_Vende.trim(),
                Tipo: esCompra ? 'Compra' : 'Venta',
                '': '',
                Tasa: '',
                Vcto: ''
            };
        });
    };

    const fechadepago = (fecha) => {
        const diaSemana = fecha.getDay();
        switch (diaSemana) {
            case 1:
            case 2:
            case 3:
                return addDays(fecha, 2);
            case 4:
                return addDays(fecha, 4);
            case 5:
                return addDays(fecha, 4);
            default:
                return fecha;
        }
    };

    return (
       
        <div className="transformar-csv-container">
            <h2>Transformar CSV a Excel</h2>
            <form onSubmit={handleFileRead}>
                <input type="file" accept=".csv" onChange={handleFileUpload} />
                <button type="submit">Cargar Archivo</button>
            </form>
            <button onClick={handleDownload} disabled={!data.length}>Descargar Excel</button>
        </div>
    );
};

export default TransformarCSV;