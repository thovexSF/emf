import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExcel, faPlus, faTrash, faCheck, faEdit } from '@fortawesome/free-solid-svg-icons';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import '../styles/OperacionesAFinix.css';

const XLSX = require('xlsx');

export const DragDropCSVModalContent = {
    title: 'Transformar CSV',
    content: (
        <>
            <p>
                Esta herramienta permite transformar archivos CSV según formatos específicos.
            </p>
            <h3>Instrucciones:</h3>
            <ol>
                <li>Arrastra y suelta tu archivo CSV en el área designada</li>
                <li>Selecciona el formato de transformación deseado</li>
                <li>Descarga el archivo transformado</li>
            </ol>
        </>
    )
};

const OperacionesAFinix = ({ darkMode }) => {
    const [processingStatus, setProcessingStatus] = useState('');
    const [datosEntrada, setDatosEntrada] = useState(null);
    const [archivoEntrada, setArchivoEntrada] = useState(null);
    const [filasEditables, setFilasEditables] = useState(new Set());
    const [filasCompletadas, setFilasCompletadas] = useState(new Set());
    const [errorMessage, setErrorMessage] = useState('');
    const [fechaArchivo, setFechaArchivo] = useState('');
    const [descargaExitosa, setDescargaExitosa] = useState(false);
    const [showDateWarning, setShowDateWarning] = useState(false);
    const [warningMessage, setWarningMessage] = useState('');
    const [feriados, setFeriados] = useState([]);

    const corredores = useMemo(() => [
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
    ].map(corredor => ({
        ...corredor,
        nombre: corredor.nombre.trim()
    })), []);

    // Función para cargar los feriados desde boostr.cl
    const cargarFeriados = useCallback(async () => {
        // Si ya tenemos feriados cargados, no hacemos nada
        if (feriados.length > 0) return;

        try {
            console.log('Iniciando carga de feriados desde API boostr.cl...');
            const response = await fetch('https://api.boostr.cl/holidays.json');
            console.log('Respuesta de la API:', response.status, response.statusText);
            
            if (response.ok) {
                const data = await response.json();
                console.log('Datos recibidos de la API:', data);
                
                if (data.status === 'success' && Array.isArray(data.data)) {
                    // Convertir las fechas al formato MM-DD
                    const feriadosFormateados = data.data.map(feriado => {
                        // Parsear la fecha directamente del string para evitar problemas de zona horaria
                        // El formato de la API es YYYY-MM-DD
                        const partesFecha = feriado.date.split('-');
                        if (partesFecha.length === 3) {
                            const month = partesFecha[1];
                            const day = partesFecha[2];
                            const mesDia = `${month}-${day}`;
                            console.log('Feriado convertido:', feriado.date, '->', mesDia);
                            return mesDia;
                        } else {
                            // Fallback: si no es formato YYYY-MM-DD, usar Date pero con UTC
                            const fecha = new Date(feriado.date + 'T12:00:00Z'); // Usar mediodía UTC para evitar problemas
                            const mesDia = `${String(fecha.getUTCMonth() + 1).padStart(2, '0')}-${String(fecha.getUTCDate()).padStart(2, '0')}`;
                            console.log('Feriado convertido (fallback):', feriado.date, '->', mesDia);
                            return mesDia;
                        }
                    });
                    
                    console.log('Feriados formateados:', feriadosFormateados);
                    setFeriados(feriadosFormateados);
                } else {
                    console.error('Formato de datos inválido de la API');
                }
            } else {
                console.error('Error en la respuesta de la API:', response.status);
            }
        } catch (error) {
            console.error('Error al cargar feriados:', error);
        }
    }, [feriados]);

    // Cargar feriados al montar el componente
    useEffect(() => {
        cargarFeriados();
    }, [cargarFeriados]);

    // Forzar re-render cuando los feriados se cargan para recalcular fechas de pago
    useEffect(() => {
        if (feriados.length > 0 && datosEntrada) {
            // Los feriados se cargaron, forzar re-render de la tabla
            // Esto se hace automáticamente porque fechadepago depende de feriados
            console.log('Feriados cargados, tabla debería recalcular fechas de pago');
        }
    }, [feriados, datosEntrada]);

    // Función para verificar si una fecha es feriado
    const esFeriado = useCallback((fecha) => {
        // Normalizar la fecha a zona horaria local para evitar problemas con UTC
        const fechaLocal = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
        const mesDia = `${String(fechaLocal.getMonth() + 1).padStart(2, '0')}-${String(fechaLocal.getDate()).padStart(2, '0')}`;
        return feriados.includes(mesDia);
    }, [feriados]);

    // Función para obtener el siguiente día hábil
    const obtenerSiguienteDiaHabil = useCallback((fecha) => {
        // Normalizar la fecha a zona horaria local
        const fechaLocal = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
        let fechaActual = new Date(fechaLocal);
        fechaActual.setDate(fechaActual.getDate() + 1);
        
        while (fechaActual.getDay() === 0 || fechaActual.getDay() === 6 || esFeriado(fechaActual)) {
            fechaActual.setDate(fechaActual.getDate() + 1);
        }
        
        return fechaActual;
    }, [esFeriado]);

    const fechadepago = useCallback((fecha, condicion) => {
        // Normalizar la fecha a zona horaria local para evitar problemas con UTC
        // Extraer año, mes y día y crear una fecha local
        const fechaLocal = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
        let fechaPago = new Date(fechaLocal);
        
        switch (condicion) {
            case 'PM':
                // Para condición PM, la fecha de pago es un día hábil después
                fechaPago = obtenerSiguienteDiaHabil(fechaPago);
                break;
            
            case 'PH':
                // Para condición PH, se paga el mismo día
                // Si es fin de semana o feriado, se paga el siguiente día hábil
                if (fechaPago.getDay() === 0 || fechaPago.getDay() === 6 || esFeriado(fechaPago)) {
                    fechaPago = obtenerSiguienteDiaHabil(fechaPago);
                }
                break;
            
            case 'CN':
            default:
                // Para condición CN o cualquier otro caso, se suma 2 días hábiles
                // Primero avanzamos un día
                fechaPago.setDate(fechaPago.getDate() + 1);
                
                // Luego avanzamos hasta encontrar el primer día hábil
                while (fechaPago.getDay() === 0 || fechaPago.getDay() === 6 || esFeriado(fechaPago)) {
                    fechaPago.setDate(fechaPago.getDate() + 1);
                }
                
                // Avanzamos otro día
                fechaPago.setDate(fechaPago.getDate() + 1);
                
                // Y avanzamos hasta encontrar el segundo día hábil
                while (fechaPago.getDay() === 0 || fechaPago.getDay() === 6 || esFeriado(fechaPago)) {
                    fechaPago.setDate(fechaPago.getDate() + 1);
                }
                break;
        }
        
        return fechaPago;
    }, [obtenerSiguienteDiaHabil, esFeriado]);

    const mapearATablaDestino = useCallback((datos) => {
        return datos.map(({
            Fecha,
            CodigoVende,
            CorredorVende,
            CodigoCompra,
            CorredorCompra,
            Cantidad,
            Precio,
            Compra,
            Nemotecnico,
            Monto,
            Condicion
        }) => {
            // Extraer componentes de la fecha y crear fecha en zona horaria local
            const year = Fecha.substring(0, 4) || '';
            const month = Fecha.substring(4, 6) || '';
            const day = Fecha.substring(6, 8) || '';
            
            // Crear fecha en zona horaria local para evitar problemas con UTC
            const fecha = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            const fechaPago = fechadepago(fecha, Condicion);
            
            const esCompra = Compra === "832";
            const monto = Monto || '0';

            const corredorVendeNombre = corredores.find(c => c.codigo === CorredorVende)?.nombre?.trim() || CorredorVende;
            const corredorCompraNombre = corredores.find(c => c.codigo === CorredorCompra)?.nombre?.trim() || CorredorCompra;

            return {
                Fecha: fecha,
                Codigo: parseFloat(esCompra ? CodigoCompra : CodigoVende) || 0,
                'Tipo Operación': esCompra ? `Compra ${Nemotecnico.toLowerCase().trim()}` : `Venta ${Nemotecnico.toLowerCase().trim()}`,
                Cantidad: Cantidad || '0',
                Precio: Precio || '0',
                'Dcto.': 0,
                Comision: 0,
                Iva: 0,
                Abono: esCompra ? 0 : monto,
                Cargo: esCompra ? monto : 0,
                Saldo: 0,
                'Fecha Pago': fechaPago,
                Corredor: esCompra ? corredorCompraNombre : corredorVendeNombre,
                Tipo: esCompra ? 'Compra' : 'Venta',
                '': '',
                Tasa: '',
                Vcto: ''
            };
        });
    }, [fechadepago, corredores]);

    const getCondicion = (tipoOperacion) => {
        // Si el tipo de operación es exactamente PM o PH, mantener ese valor
        if (tipoOperacion === 'PM' || tipoOperacion === 'PH') {
            return tipoOperacion;
        }
        // Para cualquier otro valor (OE, VC, vacío, etc.), retornar CN
        return 'CN';
    };

    const onDrop = useCallback((acceptedFiles) => {
        const file = acceptedFiles[0];
        if (file) {
            setArchivoEntrada(file);
            const reader = new FileReader();
            
            reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];

                const headers = [
                    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P",
                    "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB"
                ];

                const datosOrigen = XLSX.utils.sheet_to_json(worksheet, {
                    header: headers,
                    raw: true, // Usar raw: true para obtener valores numéricos de fechas de Excel
                    defval: '',
                });

                const datosProcesados = datosOrigen.map(fila => {
                    // Normalizar la fecha de entrada para evitar problemas de zona horaria
                    let fechaNormalizada = fila.A;
                    
                    // Si la fecha es un número (serial de Excel), convertir a fecha
                    if (typeof fila.A === 'number') {
                        // Excel serial date: número de días desde 1900-01-01
                        // Convertir a fecha sin usar zona horaria
                        const excelEpoch = new Date(1899, 11, 30); // 30 de diciembre de 1899
                        const fecha = new Date(excelEpoch.getTime() + fila.A * 86400000);
                        // Extraer año, mes y día sin usar métodos que dependan de zona horaria
                        const year = fecha.getUTCFullYear();
                        const month = String(fecha.getUTCMonth() + 1).padStart(2, '0');
                        const day = String(fecha.getUTCDate()).padStart(2, '0');
                        fechaNormalizada = `${year}${month}${day}`;
                    } else if (fila.A instanceof Date) {
                        // Si la fecha es un objeto Date, usar UTC para evitar problemas de zona horaria
                        const year = fila.A.getUTCFullYear();
                        const month = String(fila.A.getUTCMonth() + 1).padStart(2, '0');
                        const day = String(fila.A.getUTCDate()).padStart(2, '0');
                        fechaNormalizada = `${year}${month}${day}`;
                    } else if (typeof fila.A === 'string') {
                        // Si es string, limpiar y normalizar a formato YYYYMMDD
                        const fechaLimpia = fila.A.replace(/[^0-9]/g, '');
                        if (fechaLimpia.length === 8) {
                            fechaNormalizada = fechaLimpia;
                        } else if (fechaLimpia.length === 6) {
                            // Formato YYMMDD, convertir a YYYYMMDD
                            const year = fechaLimpia.substring(0, 2);
                            const fechaCompleta = (parseInt(year) > 50 ? '19' : '20') + fechaLimpia;
                            fechaNormalizada = fechaCompleta;
                        }
                    }
                    
                    // Calcular el monto como cantidad por precio
                    const cantidad = parseFloat(fila.G?.replace(/\./g, '').replace(',', '.')) || 0;
                    const precio = parseFloat(fila.H?.replace(/\./g, '').replace(',', '.')) || 0;
                    const montoCalculado = (cantidad * precio).toLocaleString('es-CL', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 4
                    });

                    // Asegurarnos de que el tipo de operación se lea correctamente
                    const tipoOperacion = fila.I?.trim() || '';
                    const condicion = getCondicion(tipoOperacion);

                    console.log('Fecha original:', fila.A, 'Fecha normalizada:', fechaNormalizada); // Para debug
                    console.log('Tipo Operación:', tipoOperacion, 'Condición:', condicion); // Para debug

                    return {
                        Fecha: fechaNormalizada,
                        Operacion: fila.B,
                        CodigoVende: fila.C,
                        CorredorVende: fila.D,
                        CodigoCompra: fila.E,
                        CorredorCompra: fila.F,
                        Cantidad: fila.G,
                        Precio: fila.H,
                        TipoOperacion: tipoOperacion,
                        Condicion: condicion,
                        Horario: fila.J,
                        Hora: fila.K,
                        Nemotecnico: fila.L,
                        Monto: montoCalculado,
                        Venta: fila.R,
                        Compra: fila.S
                    };
                });

                // Extraer la fecha del archivo
                const primeraFilaConFecha = datosProcesados.find(fila => fila.Fecha);
                if (primeraFilaConFecha) {
                    const fechaArchivo = primeraFilaConFecha.Fecha;
                    setFechaArchivo(fechaArchivo);
                    
                    if (esFinDeSemana(fechaArchivo)) {
                        const fechaFormateada = `${fechaArchivo.substring(6, 8)}/${fechaArchivo.substring(4, 6)}/${fechaArchivo.substring(0, 4)}`;
                        setWarningMessage(`Advertencia: El archivo corresponde a un fin de semana (${fechaFormateada}). No se pueden procesar operaciones de fin de semana.`);
                        setShowDateWarning(true);
                        return;
                    }
                    
                    if (!verificarFechaArchivo(fechaArchivo)) {
                        const fechaFormateada = `${fechaArchivo.substring(6, 8)}/${fechaArchivo.substring(4, 6)}/${fechaArchivo.substring(0, 4)}`;
                        setWarningMessage(`Advertencia: El archivo corresponde a la fecha ${fechaFormateada}, no a la fecha actual.`);
                        setShowDateWarning(true);
                    }
                }

                setDatosEntrada(datosProcesados);
                setFilasEditables(new Set());
                setProcessingStatus('Archivo cargado exitosamente. Puede agregar filas y luego procesar.');
                
                // Asegurarse de que los feriados se carguen si no están cargados
                if (feriados.length === 0) {
                    cargarFeriados();
                }
            };

            reader.readAsArrayBuffer(file);
        }
    }, [feriados, cargarFeriados]);

    const agregarNuevaFila = useCallback(() => {
        if (!datosEntrada || datosEntrada.length === 0) return;

        const nuevaFila = {
            Fecha: fechaArchivo || '',
            Operacion: '',
            CodigoVende: '',
            CorredorVende: '',
            CodigoCompra: '',
            CorredorCompra: '',
            Cantidad: '',
            Precio: '',
            TipoOperacion: '',
            Condicion: 'CN',
            Horario: '',
            Hora: '',
            Nemotecnico: '',
            Monto: '',
            Venta: '',
            Compra: '',
            esNuevaFila: true // Marcador para identificar filas nuevas
        };
        
        setDatosEntrada(prev => [nuevaFila, ...prev]);
        setFilasEditables(prev => new Set([0, ...Array.from(prev).map(i => i + 1)]));
        setProcessingStatus('Nueva fila agregada. Complete los datos y apruebe la fila.');
        setErrorMessage('');
    }, [datosEntrada, fechaArchivo]);

    const aprobarFila = useCallback((index) => {
        // Validar que todos los campos requeridos estén completos
        const fila = datosEntrada[index];
        const camposRequeridos = ['Fecha', 'Nemotecnico', 'Cantidad', 'Precio', 'CorredorVende', 'CorredorCompra'];
        const camposFaltantes = camposRequeridos.filter(campo => !fila[campo] || fila[campo].toString().trim() === '');

        if (camposFaltantes.length > 0) {
            setErrorMessage(`Por favor complete los siguientes campos: ${camposFaltantes.join(', ')}`);
            return;
        }

        setFilasEditables(prev => {
            const nuevasFilasEditables = new Set(Array.from(prev));
            nuevasFilasEditables.delete(index);
            return nuevasFilasEditables;
        });

        setFilasCompletadas(prev => {
            const nuevasFilasCompletadas = new Set(prev);
            nuevasFilasCompletadas.add(index);
            return nuevasFilasCompletadas;
        });

        setProcessingStatus('Fila aprobada exitosamente.');
        setErrorMessage('');
    }, [datosEntrada]);

    const editarFila = useCallback((index) => {
        setFilasEditables(prev => {
            const nuevasFilasEditables = new Set(prev);
            nuevasFilasEditables.add(index);
            return nuevasFilasEditables;
        });

        setFilasCompletadas(prev => {
            const nuevasFilasCompletadas = new Set(prev);
            nuevasFilasCompletadas.delete(index);
            return nuevasFilasCompletadas;
        });

        setProcessingStatus('Fila en modo edición.');
    }, []);

    const formatDate = (dateString) => {
        if (!dateString) return '';
        
        // Si la fecha está en formato YYYYMMDD
        if (dateString.length === 8 && !dateString.includes('-')) {
            const year = dateString.substring(0, 4);
            const month = dateString.substring(4, 6);
            const day = dateString.substring(6, 8);
            return `${day}-${month}-${year}`;
        }
        
        // Si la fecha está en formato YYYY-MM-DD
        if (dateString.includes('-')) {
            const [year, month, day] = dateString.split('-');
            return `${day}-${month}-${year}`;
        }
        
        return dateString;
    };


    const actualizarCelda = useCallback((filaIndex, columna, valor) => {
        setDatosEntrada(prev => {
            const filasActualizadas = [...prev];
            const filaActualizada = { ...filasActualizadas[filaIndex] };
            
            // Aplicar formato según el tipo de campo
            switch (columna) {
                case 'Fecha':
                    if (valor instanceof Date) {
                        const year = valor.getFullYear();
                        const month = String(valor.getMonth() + 1).padStart(2, '0');
                        const day = String(valor.getDate()).padStart(2, '0');
                        filaActualizada[columna] = `${year}${month}${day}`;
                    } else {
                        filaActualizada[columna] = valor.replace(/\D/g, '').substring(0, 8);
                    }
                    break;
                case 'Cantidad':
                case 'Precio':
                case 'Monto':
                    // Mantener el valor original sin limpiar
                    filaActualizada[columna] = valor;
                    break;
                default:
                    filaActualizada[columna] = valor;
            }
            
            // Recalcular Monto si se actualiza Precio o Cantidad
            if (columna === 'Precio' || columna === 'Cantidad') {
                const cantidad = parseFloat(filaActualizada.Cantidad) || 0;
                const precio = parseFloat(filaActualizada.Precio) || 0;
                
                if (!isNaN(cantidad) && !isNaN(precio)) {
                    // Calcular el monto manteniendo el formato original
                    const monto = cantidad * precio;
                    filaActualizada.Monto = monto.toString();
                } else {
                    filaActualizada.Monto = '0';
                }
            }
            
            filasActualizadas[filaIndex] = filaActualizada;
            return filasActualizadas;
        });
        setErrorMessage('');
    }, []);

    const actualizarCorredor = useCallback((filaIndex, tipo, codigoCorredor) => {
        setDatosEntrada(prev => {
            const filasActualizadas = [...prev];
            const filaActualizada = { ...filasActualizadas[filaIndex] };
            
            if (tipo === 'CorredorVende') {
                filaActualizada.CodigoVende = codigoCorredor;
                filaActualizada.CorredorVende = corredores.find(c => c.codigo === parseInt(codigoCorredor))?.nombre || '';
            } else if (tipo === 'CorredorCompra') {
                filaActualizada.CodigoCompra = codigoCorredor;
                filaActualizada.CorredorCompra = corredores.find(c => c.codigo === parseInt(codigoCorredor))?.nombre || '';
            }
            
            filasActualizadas[filaIndex] = filaActualizada;
            return filasActualizadas;
        });
    }, [corredores]);

    const processFile = useCallback(async () => {
        if (!datosEntrada || !archivoEntrada) return;

        try {
            // Validar campos requeridos
            const camposRequeridos = ['Fecha', 'Nemotecnico', 'Cantidad', 'Precio', 'Monto', 'CorredorVende', 'CorredorCompra'];
            const filasIncompletas = datosEntrada.filter(fila => {
                return camposRequeridos.some(campo => !fila[campo] || fila[campo].toString().trim() === '');
            });

            if (filasIncompletas.length > 0) {
                const indices = filasIncompletas.map(fila => datosEntrada.indexOf(fila) + 1);
                setProcessingStatus(`Error: Las siguientes filas tienen campos incompletos: ${indices.join(', ')}`);
                setDescargaExitosa(false);
                return;
            }

            setDescargaExitosa(false);
            setProcessingStatus('Procesando archivo...');
            
            const datosProcesados = datosEntrada.map(fila => ({
                ...fila,
                Cantidad: fila.Cantidad,
                Precio: fila.Precio,
                Monto: fila.Monto
            }));
            
            const datosDestino = mapearATablaDestino(datosProcesados);

            const newWorkbook = XLSX.utils.book_new();

            const sheetsToCreate = ['FIP', 'Corredores', 'Operaciones Security', 'Hoja1', 'Hoja2'];
            sheetsToCreate.forEach((sheetName) => {
                const newSheet = XLSX.utils.json_to_sheet([[]]);
                XLSX.utils.book_append_sheet(newWorkbook, newSheet, sheetName);
            });

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

            const datosParaExcel = datosDestino.map(fila => {
                const parseNumber = (value) => {
                    if (typeof value === 'number') return value;
                    if (!value) return 0;
                    return parseFloat(value.toString().replace(/\./g, '').replace(',', '.')) || 0;
                };

                // Formatear fecha de pago como string para evitar problemas de zona horaria en Excel
                const fechaPagoFormateada = fila['Fecha Pago'] instanceof Date 
                    ? `${String(fila['Fecha Pago'].getDate()).padStart(2, '0')}-${String(fila['Fecha Pago'].getMonth() + 1).padStart(2, '0')}-${fila['Fecha Pago'].getFullYear()}`
                    : fila['Fecha Pago'];

                return {
                    Fecha: fila.Fecha,
                    Codigo: fila.Codigo,
                    'Tipo Operación': fila['Tipo Operación'].trim(),
                    Cantidad: parseNumber(fila.Cantidad),
                    Precio: parseNumber(fila.Precio),
                    'Dcto.': fila['Dcto.'],
                    Comision: fila.Comision,
                    Iva: fila.Iva,
                    Abono: Math.round(parseNumber(fila.Abono)),
                    Cargo: Math.round(parseNumber(fila.Cargo)),
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
                cellDates: true
            });

            // Asegurarnos de que los valores de texto no tengan espacios extra y aplicar formatos
            const range = XLSX.utils.decode_range(hojaFIP['!ref']);
            for (let R = range.s.r; R <= range.e.r; R++) {
                for (let C = range.s.c; C <= range.e.c; C++) {
                    const cell = XLSX.utils.encode_cell({r: R, c: C});
                    if (hojaFIP[cell]) {
                        // Limpiar espacios en valores de texto
                        if (hojaFIP[cell].t === 's') {
                            hojaFIP[cell].v = hojaFIP[cell].v.trim();
                        }
                        
                        // Aplicar formatos específicos
                        if (R > 0) { // No aplicar formatos a la fila de encabezados
                            if (C === 0) { // Columna de fecha (Fecha original)
                                // Si es un objeto Date, aplicar formato de fecha
                                if (hojaFIP[cell].t === 'd' || hojaFIP[cell].t === 'n') {
                                    hojaFIP[cell].z = 'dd-mm-yy';
                                    hojaFIP[cell].t = 'd';
                                }
                            } else if (C === 11) { // Columna de Fecha Pago (ahora es string)
                                // Forzar como texto para evitar problemas de zona horaria
                                hojaFIP[cell].t = 's';
                            } else if (C === 3) { // Columna de cantidad
                                hojaFIP[cell].t = 'n';
                                hojaFIP[cell].z = '#,##0';
                            } else if (C === 4) { // Columna de precio
                                hojaFIP[cell].t = 'n';
                                hojaFIP[cell].z = '#,##0.00';
                            } else if (C === 8 || C === 9) { // Columnas de abono y cargo
                                hojaFIP[cell].t = 'n';
                                hojaFIP[cell].z = '#,##0';
                            }
                        }
                    }
                }
            }

            newWorkbook.Sheets['FIP'] = hojaFIP;

            // Obtener la fecha del archivo y formatearla
            const primeraFila = datosEntrada[0];
            if (primeraFila && primeraFila.Fecha) {
                const fechaStr = primeraFila.Fecha;
                const year = fechaStr.substring(0, 4);
                const month = fechaStr.substring(4, 6);
                const day = fechaStr.substring(6, 8);
                const fechaFormateada = `${day}.${month}.${year}`;
                
                // Crear el nombre del archivo con el formato solicitado
                const nuevoNombre = `Control Operaciones Diarias FIP ${fechaFormateada}.xls`;

            const arrayBuffer = XLSX.write(newWorkbook, { 
                bookType: 'xls', 
                type: 'array',
                bookSST: true
            });
            
            const blob = new Blob([arrayBuffer], { 
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
            });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = nuevoNombre;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

                setDescargaExitosa(true);
                setProcessingStatus('');
            } else {
                setProcessingStatus('Error: No se pudo obtener la fecha del archivo');
                setDescargaExitosa(false);
            }
        } catch (error) {
            setProcessingStatus(`Error procesando archivo: ${error.message}`);
            setDescargaExitosa(false);
        }
    }, [mapearATablaDestino, datosEntrada, archivoEntrada]);

    const verificarFechaArchivo = (fechaStr) => {
        if (!fechaStr) return false;
        
        const hoy = new Date();
        const fechaArchivo = new Date(
            parseInt(fechaStr.substring(0, 4)),
            parseInt(fechaStr.substring(4, 6)) - 1,
            parseInt(fechaStr.substring(6, 8))
        );

        return hoy.toDateString() === fechaArchivo.toDateString();
    };

    const esFinDeSemana = (fechaStr) => {
        if (!fechaStr) return false;
        
        const fechaArchivo = new Date(
            parseInt(fechaStr.substring(0, 4)),
            parseInt(fechaStr.substring(4, 6)) - 1,
            parseInt(fechaStr.substring(6, 8))
        );

        return fechaArchivo.getDay() === 0 || fechaArchivo.getDay() === 6; // 0 es domingo, 6 es sábado
    };


    const eliminarFila = (index) => {
        setDatosEntrada(prev => {
            const nuevasDatos = [...prev];
            nuevasDatos.splice(index, 1);
            return nuevasDatos;
        });
        
        setFilasEditables(prev => {
            const nuevasFilasEditables = new Set(Array.from(prev).map(i => i > index ? i - 1 : i));
            nuevasFilasEditables.delete(index);
            return nuevasFilasEditables;
        });

        setFilasCompletadas(prev => {
            const nuevasFilasCompletadas = new Set(Array.from(prev).map(i => i > index ? i - 1 : i));
            nuevasFilasCompletadas.delete(index);
            return nuevasFilasCompletadas;
        });

        setProcessingStatus('Fila eliminada. Procese el archivo nuevamente.');
        setDescargaExitosa(false);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'text/csv': ['.csv'],
        },
        multiple: false
    });

    return (
        <div className="operaciones-finix-container">
            {showDateWarning && (
                <div className="date-warning-modal">
                    <div className="date-warning-content">
                        <h3>Advertencia</h3>
                        <p>{warningMessage}</p>
                        <div className="warning-buttons">
                            <button onClick={() => setShowDateWarning(false)}>Continuar</button>
                            <button onClick={() => {
                                setShowDateWarning(false);
                                setDatosEntrada(null);
                                setArchivoEntrada(null);
                            }}>Cancelar</button>
                        </div>
                    </div>
                </div>
            )}
                <div
                    {...getRootProps()}
                className={`operaciones-finix-dropzone ${isDragActive ? 'active' : ''}`}
                >
                    <input {...getInputProps()} />
                <FontAwesomeIcon icon={faFileExcel} className="operaciones-finix-excel-icon" />
                <p>
                            {isDragActive
                                ? 'Suelta el archivo aquí'
                        : 'Arrastra y suelta un archivo Excel aquí, o haz clic para seleccionar'}
                        </p>
                    </div>

            {errorMessage && (
                <div className="error-message">
                    {errorMessage}
                </div>
            )}

            {datosEntrada && (
                <div className="operaciones-finix-container">
                {processingStatus && (
                        <div className="processing-status">
                            <p>{processingStatus}</p>
                    </div>
                )}

                    <div className="operaciones-finix-button-container">
                        <button
                            onClick={agregarNuevaFila}
                            className="operaciones-finix-add-button"
                        >
                            <FontAwesomeIcon icon={faPlus} />
                            Agregar Fila
                        </button>
                        <button
                            onClick={processFile}
                            className={`operaciones-finix-process-button ${descargaExitosa ? 'success' : ''}`}
                        >
                            <FontAwesomeIcon icon={faFileExcel} />
                            {descargaExitosa ? 'Descarga Exitosa' : 'Procesar Archivo'}
                        </button>
                    </div>

                    <div className="operaciones-finix-table-container">
                        <table className="operaciones-finix-data-table">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Tipo</th>
                                <th>Nemotecnico</th>
                                <th>Cantidad</th>
                                <th>Precio</th>
                                <th>Monto</th>
                                <th>Corredor Vende</th>
                                <th>Corredor Compra</th>
                                <th>Condición</th>
                                <th>Tipo Operación</th>
                                <th>Fecha Pago</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                                {datosEntrada.map((fila, index) => {
                                    const fechaBase = fila.Fecha ? new Date(
                                        fila.Fecha.substring(0, 4),
                                        parseInt(fila.Fecha.substring(4, 6)) - 1,
                                        fila.Fecha.substring(6, 8)
                                    ) : new Date();
                                    
                                    const fechaPago = fechadepago(fechaBase, fila.Condicion);
                                    const fechaPagoFormateada = fechaPago ? `${fechaPago.getDate().toString().padStart(2, '0')}-${(fechaPago.getMonth() + 1).toString().padStart(2, '0')}-${fechaPago.getFullYear()}` : '';

                                    return (
                                        <tr key={index} className={`${filasCompletadas.has(index) ? 'fila-completada' : ''} ${fila.esNuevaFila ? 'fila-nueva' : ''}`}>
                                            <td>
                                                {filasEditables.has(index) ? (
                                                    <DatePicker
                                                        selected={fila.Fecha ? new Date(
                                                            fila.Fecha.substring(0, 4),
                                                            parseInt(fila.Fecha.substring(4, 6)) - 1,
                                                            fila.Fecha.substring(6, 8)
                                                        ) : null}
                                                        onChange={(date) => actualizarCelda(index, 'Fecha', date)}
                                                        dateFormat="dd/MM/yyyy"
                                                        className="celda-input"
                                                        placeholderText="DD/MM/YYYY"
                                                    />
                                                ) : (
                                                    formatDate(fila.Fecha)
                                                )}
                                            </td>
                                            <td>
                                                {filasEditables.has(index) ? (
                                                    <select
                                                        className="celda-input"
                                                        value={fila.Tipo || ''}
                                                        onChange={(e) => actualizarCelda(index, 'Tipo', e.target.value)}
                                                    >
                                                        <option value="">Seleccionar</option>
                                                        <option value="Compra">Compra</option>
                                                        <option value="Venta">Venta</option>
                                                    </select>
                                                ) : (
                                                    fila.Tipo || (fila.Compra === "832" ? "Compra" : "Venta")
                                                )}
                                            </td>
                                            <td>
                                                {filasEditables.has(index) ? (
                                                    <input
                                                        type="text"
                                                        className="celda-input"
                                                        value={fila.Nemotecnico || ''}
                                                        onChange={(e) => actualizarCelda(index, 'Nemotecnico', e.target.value)}
                                                    />
                                                ) : (
                                                    fila.Nemotecnico
                                                )}
                                            </td>
                                            <td>
                                                {filasEditables.has(index) ? (
                                                    <input
                                                        type="text"
                                                        className="celda-input"
                                                        value={fila.Cantidad}
                                                        onChange={(e) => actualizarCelda(index, 'Cantidad', e.target.value)}
                                                        onBlur={(e) => {
                                                            const valor = e.target.value.replace(/[^\d]/g, '');
                                                            const cantidad = parseInt(valor) || 0;
                                                            actualizarCelda(index, 'Cantidad', cantidad.toLocaleString('es-CL', {
                                                                minimumFractionDigits: 0,
                                                                maximumFractionDigits: 0
                                                            }));
                                                        }}
                                                        placeholder="0"
                                                    />
                                                ) : (
                                                    parseInt(fila.Cantidad?.toString().replace(/\./g, ''))?.toLocaleString('es-CL', {
                                                        minimumFractionDigits: 0,
                                                        maximumFractionDigits: 0
                                                    }) || '0'
                                                )}
                                            </td>
                                            <td>
                                                {filasEditables.has(index) ? (
                                                    <input
                                                        type="text"
                                                        className="celda-input"
                                                        value={fila.Precio}
                                                        onChange={(e) => actualizarCelda(index, 'Precio', e.target.value)}
                                                        onBlur={(e) => {
                                                            const valor = e.target.value.replace(/[^\d,]/g, '').replace(/,/g, '.');
                                                            const precio = parseFloat(valor) || 0;
                                                            actualizarCelda(index, 'Precio', precio.toLocaleString('es-CL', {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2
                                                            }));
                                                        }}
                                                        placeholder="0,00"
                                                    />
                                                ) : (
                                                    parseFloat(fila.Precio?.toString().replace(/\./g, '').replace(',', '.'))?.toLocaleString('es-CL', {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2
                                                    }) || '0,00'
                                                )}
                                            </td>
                                            <td>
                                                {filasEditables.has(index) ? (
                                                    <input
                                                        type="text"
                                                        className="celda-input"
                                                        value={fila.Monto}
                                                        onChange={(e) => actualizarCelda(index, 'Monto', e.target.value)}
                                                        placeholder="Calculado automáticamente"
                                                        readOnly
                                                    />
                                                ) : (
                                                    Math.round(parseFloat(fila.Monto?.toString().replace(/\./g, '').replace(',', '.')) || 0).toLocaleString('es-CL', {
                                                        minimumFractionDigits: 0,
                                                        maximumFractionDigits: 0
                                                    })
                                                )}
                                            </td>
                                            <td>
                                                {filasEditables.has(index) ? (
                                                    <select
                                                        value={fila.CodigoVende || ''}
                                                        onChange={(e) => actualizarCorredor(index, 'CorredorVende', e.target.value)}
                                                        className="celda-input"
                                                    >
                                                        <option value="">Seleccionar</option>
                                                        {corredores.map((corredor) => (
                                                            <option key={corredor.codigo} value={corredor.codigo}>
                                                                {corredor.nombre}
                                                            </option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    fila.CorredorVende
                                                )}
                                            </td>
                                            <td>
                                                {filasEditables.has(index) ? (
                                                    <select
                                                        value={fila.CodigoCompra || ''}
                                                        onChange={(e) => actualizarCorredor(index, 'CorredorCompra', e.target.value)}
                                                        className="celda-input"
                                                    >
                                                        <option value="">Seleccionar</option>
                                                        {corredores.map((corredor) => (
                                                            <option key={corredor.codigo} value={corredor.codigo}>
                                                                {corredor.nombre}
                                                            </option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    fila.CorredorCompra
                                                )}
                                            </td>
                                            <td>
                                                {filasEditables.has(index) ? (
                                                    <select
                                                        value={fila.Condicion}
                                                        onChange={(e) => actualizarCelda(index, 'Condicion', e.target.value)}
                                                        className="celda-input"
                                                    >
                                                        <option value="CN">CN</option>
                                                        <option value="PM">PM</option>
                                                        <option value="PH">PH</option>
                                                    </select>
                                                ) : (
                                                    fila.Condicion
                                                )}
                                            </td>
                                            <td>
                                                {filasEditables.has(index) ? (
                                                    <input
                                                        type="text"
                                                        className="celda-input"
                                                        value={fila.TipoOperacion || ''}
                                                        onChange={(e) => {
                                                            const newValue = e.target.value;
                                                            actualizarCelda(index, 'TipoOperacion', newValue);
                                                            actualizarCelda(index, 'Condicion', getCondicion(newValue));
                                                        }}
                                                    />
                                                ) : (
                                                    fila.TipoOperacion || ''
                                                )}
                                            </td>
                                            <td>{fechaPagoFormateada}</td>
                                            <td className="acciones-column">
                                                <div>
                                                {filasEditables.has(index) ? (
                                                    <>
                                                        <button
                                                            onClick={() => aprobarFila(index)}
                                                            className="operaciones-finix-approve-button"
                                                            title="Aprobar fila"
                                                        >
                                                            <FontAwesomeIcon icon={faCheck} />
                                                        </button>
                                                        <button
                                                            onClick={() => eliminarFila(index)}
                                                            className="operaciones-finix-delete-button"
                                                            title="Eliminar fila"
                                                        >
                                                            <FontAwesomeIcon icon={faTrash} />
                                                        </button>
                                                    </>
                                                ) : fila.esNuevaFila && (
                                                    <>
                                                        <button
                                                            onClick={() => editarFila(index)}
                                                            className="operaciones-finix-edit-button"
                                                            title="Editar fila"
                                                        >
                                                            <FontAwesomeIcon icon={faEdit} />
                                                        </button>
                                                        <button
                                                            onClick={() => eliminarFila(index)}
                                                            className="operaciones-finix-delete-button"
                                                            title="Eliminar fila"
                                                        >
                                                            <FontAwesomeIcon icon={faTrash} />
                                                        </button>
                                                    </>
                                                )}
                                                </div>
                                            </td>
                                </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>
            )}
        </div>
    );
};

export default OperacionesAFinix; 