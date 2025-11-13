import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSync, faFileExcel, faUpload, faFileAlt, faTrash, faEdit, faDownload, faCheck, faTimes, faSort, faSortUp, faSortDown, faEye, faPlus } from '@fortawesome/free-solid-svg-icons';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { useDropzone } from 'react-dropzone';
import '../styles/BalanceAcciones.css';
import ExcelJS from 'exceljs';

const XLSX = require('xlsx');

// Lista de corredores
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

const BalanceAcciones = ({ darkMode }) => {
    const [balance, setBalance] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [preciosCierre, setPreciosCierre] = useState({});
    const [historial, setHistorial] = useState([]);
    const [uploadingBalance, setUploadingBalance] = useState(false);
    const [nemotecnicosNeteados, setNemotecnicosNeteados] = useState([]);
    const [editingItem, setEditingItem] = useState(null);
    const [editingData, setEditingData] = useState({});
    
    // Inicializar filasModificadas desde sessionStorage si existe
    const inicializarFilasModificadas = () => {
        try {
            const guardado = sessionStorage.getItem('balanceFilasModificadas');
            if (guardado) {
                const array = JSON.parse(guardado);
                return new Set(array);
            }
        } catch (e) {
            console.error('Error al cargar filas modificadas desde sessionStorage:', e);
        }
        return new Set();
    };
    
    const [filasModificadas, setFilasModificadas] = useState(inicializarFilasModificadas);
    
    // Función helper para actualizar filas modificadas y guardar en sessionStorage
    const actualizarFilasModificadas = (nuevasFilas) => {
        setFilasModificadas(nuevasFilas);
        try {
            if (nuevasFilas.size > 0) {
                sessionStorage.setItem('balanceFilasModificadas', JSON.stringify(Array.from(nuevasFilas)));
            } else {
                sessionStorage.removeItem('balanceFilasModificadas');
            }
        } catch (e) {
            console.error('Error al guardar filas modificadas en sessionStorage:', e);
        }
    };
    
    const [sortColumn, setSortColumn] = useState('valorizacionCierre');
    const [sortDirection, setSortDirection] = useState('desc');
    const [notification, setNotification] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const balanceRef = useRef([]);
    
    // Estados para el modal de visualización de operaciones
    const [showOperacionesModal, setShowOperacionesModal] = useState(false);
    const [operacionesModal, setOperacionesModal] = useState([]);
    const [historialIdModal, setHistorialIdModal] = useState(null);
    const [filasEditables, setFilasEditables] = useState(new Set());

    const API_URL = process.env.NODE_ENV === 'production'
        ? process.env.REACT_APP_API_URL || window.location.origin + '/api'
        : process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

    const cargarBalance = useCallback(async (compararCambios = false) => {
        setLoading(true);
        setError(null);
        try {
            let balanceAnterior = null;
            if (compararCambios) {
                // Obtener balance actual antes de cargar el nuevo usando ref
                balanceAnterior = balanceRef.current.length > 0 ? JSON.parse(JSON.stringify(balanceRef.current)) : null;
            }
            
            const response = await fetch(`${API_URL}/balance-acciones`);
            if (!response.ok) {
                throw new Error(`Error al cargar el balance: ${response.status} ${response.statusText}`);
            }
            
            // Verificar que la respuesta sea JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                // Si recibimos HTML, puede ser que Railway esté desplegando o hay un error
                if (text.includes('<!doctype') || text.includes('<html')) {
                    throw new Error(`El servidor está devolviendo HTML en lugar de JSON. Esto puede ocurrir durante el despliegue en Railway. Por favor, espera unos momentos y recarga la página.`);
                }
                throw new Error(`El servidor devolvió un formato inesperado. Content-Type: ${contentType}`);
            }
            
            const result = await response.json();
            
            // Manejar nuevo formato con balance y nemotecnicosNeteados, o formato antiguo
            const balanceData = result.balance || result;
            const neteados = result.nemotecnicosNeteados || [];
            
            setBalance(balanceData);
            setNemotecnicosNeteados(neteados);
            balanceRef.current = balanceData; // Actualizar ref
            
            // Cargar precios de cierre desde el balance (desde la base de datos)
            const preciosDesdeBD = {};
            balanceData.forEach(item => {
                if (item.precioCierre !== null && item.precioCierre !== undefined) {
                    preciosDesdeBD[item.nemotecnico] = item.precioCierre;
                }
            });
            setPreciosCierre(prev => ({ ...prev, ...preciosDesdeBD }));
            
            // Detectar filas modificadas si se solicitó comparación
            if (compararCambios && balanceAnterior && balanceAnterior.length > 0) {
                const modificadas = new Set();
                balanceData.forEach(itemNuevo => {
                    const itemAnterior = balanceAnterior.find(item => item.nemotecnico === itemNuevo.nemotecnico);
                    if (!itemAnterior) {
                        // Nueva fila
                        modificadas.add(itemNuevo.nemotecnico);
                    } else {
                        // Comparar valores clave
                        if (
                            Math.abs(parseFloat(itemAnterior.existencia) - parseFloat(itemNuevo.existencia)) > 0.001 ||
                            Math.abs(parseFloat(itemAnterior.precioCompraPromedio || 0) - parseFloat(itemNuevo.precioCompraPromedio || 0)) > 0.01 ||
                            Math.abs(parseFloat(itemAnterior.valorizacionCompra || 0) - parseFloat(itemNuevo.valorizacionCompra || 0)) > 0.01
                        ) {
                            modificadas.add(itemNuevo.nemotecnico);
                        }
                    }
                });
                actualizarFilasModificadas(modificadas);
            }
        } catch (err) {
            let errorMessage = err.message;
            
            // Detectar si el error es por respuesta HTML en lugar de JSON
            if (err.message.includes('Unexpected token') || err.message.includes('<!doctype') || err.message.includes('HTML')) {
                errorMessage = `Error de conexión: El servidor no está respondiendo correctamente. Verifica que el servidor esté corriendo en ${API_URL.replace('/api', '')}. Si estás en producción, verifica la configuración de la API.`;
            }
            
            setError(errorMessage);
            console.error('Error al cargar balance:', err);
        } finally {
            setLoading(false);
        }
    }, [API_URL]);

    const cargarHistorial = useCallback(async () => {
        try {
            const response = await fetch(`${API_URL}/historial-archivos`);
            if (response.ok) {
                const data = await response.json();
                setHistorial(data);
            }
        } catch (err) {
            console.error('Error al cargar historial:', err);
        }
    }, [API_URL]);

    const mostrarNotificacion = useCallback((mensaje, tipo = 'success', duracion = 3000) => {
        setNotification({ mensaje, tipo });
        setTimeout(() => {
            setNotification(null);
        }, duracion);
    }, []);

    const eliminarArchivo = useCallback(async (id, nombreArchivo, event) => {
        // Mostrar diálogo de confirmación personalizado
        setConfirmDialog({
            mensaje: `¿Estás seguro de que quieres eliminar el archivo "${nombreArchivo}" y todas sus operaciones relacionadas?`,
            onConfirm: async () => {
                setConfirmDialog(null);
                try {
                    const response = await fetch(`${API_URL}/historial-archivos/${id}`, {
                        method: 'DELETE',
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || 'Error al eliminar el archivo');
                    }

                    // Si se elimina un CSV, limpiar filas modificadas y recargar balance e historial
                    // Esto hará que las filas vuelvan a su estado normal
                    actualizarFilasModificadas(new Set());
                    await cargarBalance();
                    await cargarHistorial();
                    mostrarNotificacion('Archivo eliminado exitosamente', 'success');
                } catch (err) {
                    setError(err.message);
                    console.error('Error al eliminar archivo:', err);
                    mostrarNotificacion(`Error al eliminar archivo: ${err.message}`, 'error');
                }
            },
            onCancel: () => {
                setConfirmDialog(null);
            }
        });
    }, [API_URL, cargarBalance, cargarHistorial, mostrarNotificacion]);

    const descargarArchivoOriginal = useCallback(async (id, nombreArchivo) => {
        try {
            setLoading(true);
            const response = await fetch(`${API_URL}/descargar-archivo-original/${id}`, {
                method: 'GET',
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error al descargar archivo original');
            }

            // Obtener el blob del archivo
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            
            // Obtener el nombre del archivo del header Content-Disposition
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = nombreArchivo || 'archivo';
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?([^'";]+)"?/i);
                if (filenameMatch) {
                    filename = filenameMatch[1];
                }
            }
            
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            alert('Archivo original descargado exitosamente');
        } catch (err) {
            setError(err.message);
            console.error('Error al descargar archivo original:', err);
            alert(`Error al descargar archivo original: ${err.message}`);
        } finally {
            setLoading(false);
        }
    }, [API_URL]);

    // Función para cargar operaciones del historial y abrir modal
    const verOperaciones = useCallback(async (historialId) => {
        try {
            setLoading(true);
            const response = await fetch(`${API_URL}/historial-operaciones/${historialId}`);
            if (!response.ok) {
                throw new Error('Error al cargar operaciones');
            }
            const operaciones = await response.json();
            
            // Convertir operaciones al formato esperado por el modal
            const operacionesFormateadas = operaciones.map(op => ({
                id: op.id,
                Fecha: op.fecha ? (typeof op.fecha === 'string' ? op.fecha.replace(/-/g, '') : 
                    `${op.fecha.getFullYear()}${String(op.fecha.getMonth() + 1).padStart(2, '0')}${String(op.fecha.getDate()).padStart(2, '0')}`) : '',
                Nemotecnico: op.nemotecnico || '',
                Cantidad: op.cantidad || '',
                Precio: op.precio || '',
                Monto: op.monto || '',
                Tipo: op.tipo_operacion || '',
                CorredorVende: op.tipo_operacion === 'Compra' ? '' : (op.nombre_corredor || ''),
                CorredorCompra: op.tipo_operacion === 'Compra' ? (op.nombre_corredor || '') : '',
                CodigoVende: op.tipo_operacion === 'Compra' ? '' : (op.codigo_corredor || ''),
                CodigoCompra: op.tipo_operacion === 'Compra' ? (op.codigo_corredor || '') : '',
                Condicion: 'CN',
                Compra: op.tipo_operacion === 'Compra' ? '832' : '',
                esNuevaFila: false
            }));
            
            setOperacionesModal(operacionesFormateadas);
            setHistorialIdModal(historialId);
            setShowOperacionesModal(true);
            setFilasEditables(new Set());
        } catch (error) {
            console.error('Error al cargar operaciones:', error);
            setError('Error al cargar las operaciones del historial');
        } finally {
            setLoading(false);
        }
    }, [API_URL]);

    const descargarCSVTransformado = useCallback(async (id, nombreArchivo) => {
        try {
            setLoading(true);
            const response = await fetch(`${API_URL}/descargar-csv-transformado/${id}`, {
                method: 'GET',
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error al generar CSV transformado');
            }

            // Obtener el nombre del archivo del header Content-Disposition
            const contentDisposition = response.headers.get('Content-Disposition');
            console.log('Content-Disposition header:', contentDisposition);
            let filename = 'Control Operaciones Diarias FIP.xls'; // Fallback por defecto
            
            if (contentDisposition) {
                // Intentar extraer el nombre del archivo del header
                // Formato: attachment; filename="nombre.xls"; filename*=UTF-8''nombre.xls
                let filenameMatch = contentDisposition.match(/filename\*?=['"]?([^'";]+)['"]?/i);
                if (filenameMatch) {
                    filename = filenameMatch[1];
                    // Decodificar si está codificado
                    try {
                        filename = decodeURIComponent(filename);
                    } catch (e) {
                        // Si falla la decodificación, usar el nombre tal cual
                        console.log('No se pudo decodificar el nombre del archivo, usando tal cual');
                    }
                } else {
                    // Intentar otro formato: filename="nombre.xls"
                    filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
                    if (filenameMatch) {
                        filename = filenameMatch[1];
                    }
                }
            }
            
            console.log('Nombre de archivo extraído:', filename);
            
            // Obtener el blob del Excel
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            alert('CSV transformado descargado exitosamente');
        } catch (err) {
            setError(err.message);
            console.error('Error al descargar CSV transformado:', err);
            alert(`Error al descargar CSV transformado: ${err.message}`);
        } finally {
            setLoading(false);
        }
    }, [API_URL]);

    useEffect(() => {
        cargarBalance();
        cargarHistorial();
    }, [cargarBalance, cargarHistorial]);
    
    // Actualizar ref cuando cambia el balance
    useEffect(() => {
        balanceRef.current = balance;
    }, [balance]);

    const onDropBalanceBase = useCallback(async (acceptedFiles) => {
        if (acceptedFiles.length === 0) return;

        const file = acceptedFiles[0];
        setUploadingBalance(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('archivo', file);

            const response = await fetch(`${API_URL}/upload-balance-base`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error al subir balance base');
            }

            const result = await response.json();
            
            // Limpiar filas modificadas y recargar balance e historial automáticamente
            actualizarFilasModificadas(new Set());
            await cargarBalance();
            await cargarHistorial();
            
            alert(`Balance base cargado exitosamente. Se procesaron ${result.saved} operaciones.`);
        } catch (err) {
            setError(err.message);
            console.error('Error al subir balance base:', err);
        } finally {
            setUploadingBalance(false);
        }
    }, [API_URL, cargarBalance, cargarHistorial]);

    const procesarCSV = useCallback(async (file) => {
        setUploadingBalance(true);
        setError(null);

        try {
            // Leer el archivo como ArrayBuffer para procesarlo igual que en OperacionesAFinix
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

                    const headers = [
                        "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P",
                        "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB"
                    ];

                    const datosOrigen = XLSX.utils.sheet_to_json(worksheet, {
                        header: headers,
                        raw: false,
                    });

                    if (datosOrigen.length === 0) {
                        throw new Error('El archivo CSV no contiene datos válidos');
                    }
                    
                    console.log(`Total de filas leídas del CSV: ${datosOrigen.length}`);
                    console.log('Primeras 3 filas de ejemplo:', datosOrigen.slice(0, 3).map(f => ({
                        A: f.A,
                        L: f.L,
                        G: f.G,
                        H: f.H
                    })));

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

                    // Cargar feriados para calcular fecha de pago correctamente
                    let feriados = [];
                    try {
                        const feriadosResponse = await fetch('https://api.boostr.cl/holidays.json');
                        if (feriadosResponse.ok) {
                            const feriadosData = await feriadosResponse.json();
                            if (feriadosData.status === 'success' && Array.isArray(feriadosData.data)) {
                                feriados = feriadosData.data.map(h => {
                                    const d = new Date(h.date);
                                    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                });
                            }
                        }
                    } catch (e) {
                        console.warn('No se pudieron cargar feriados, usando cálculo básico');
                    }

                    const esFeriado = (fecha) => {
                        const mesDia = `${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
                        return feriados.includes(mesDia);
                    };

                    const obtenerSiguienteDiaHabil = (fecha) => {
                        const fechaLocal = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
                        let fechaActual = new Date(fechaLocal);
                        fechaActual.setDate(fechaActual.getDate() + 1);
                        while (fechaActual.getDay() === 0 || fechaActual.getDay() === 6 || esFeriado(fechaActual)) {
                            fechaActual.setDate(fechaActual.getDate() + 1);
                        }
                        return fechaActual;
                    };

                    // Función para calcular fecha de pago (igual que en OperacionesAFinix)
                    const calcularFechaPago = (fecha, condicion = 'CN') => {
                        const fechaLocal = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
                        let fechaPago = new Date(fechaLocal);
                        
                        switch (condicion) {
                            case 'PM':
                                fechaPago = obtenerSiguienteDiaHabil(fechaPago);
                                break;
                            case 'PH':
                                if (fechaPago.getDay() === 0 || fechaPago.getDay() === 6 || esFeriado(fechaPago)) {
                                    fechaPago = obtenerSiguienteDiaHabil(fechaPago);
                                }
                                break;
                            case 'CN':
                            default:
                                fechaPago.setDate(fechaPago.getDate() + 1);
                                while (fechaPago.getDay() === 0 || fechaPago.getDay() === 6 || esFeriado(fechaPago)) {
                                    fechaPago.setDate(fechaPago.getDate() + 1);
                                }
                                fechaPago.setDate(fechaPago.getDate() + 1);
                                while (fechaPago.getDay() === 0 || fechaPago.getDay() === 6 || esFeriado(fechaPago)) {
                                    fechaPago.setDate(fechaPago.getDate() + 1);
                                }
                                break;
                        }
                        return fechaPago;
                    };

                    // Filtrar filas vacías o sin datos válidos antes de procesar
                    const filasValidas = datosOrigen.filter(fila => {
                        // Verificar que tenga al menos fecha y nemotécnico
                        const tieneFecha = fila.A && String(fila.A).trim() !== '';
                        const tieneNemotecnico = fila.L && String(fila.L).trim() !== '';
                        return tieneFecha && tieneNemotecnico;
                    });
                    
                    console.log(`Total de filas en CSV: ${datosOrigen.length}, Filas válidas: ${filasValidas.length}`);
                    
                    // Transformar datos al formato esperado (similar a mapearATablaDestino)
                    const operaciones = [];
                    filasValidas.forEach((fila, index) => {
                        try {
                        // Normalizar fecha
                        let fechaNormalizada = fila.A;
                        if (fila.A instanceof Date) {
                            const year = fila.A.getFullYear();
                            const month = String(fila.A.getMonth() + 1).padStart(2, '0');
                            const day = String(fila.A.getDate()).padStart(2, '0');
                            fechaNormalizada = `${year}${month}${day}`;
                        } else if (typeof fila.A === 'string') {
                            const fechaLimpia = fila.A.replace(/[^0-9]/g, '');
                            if (fechaLimpia.length === 8) {
                                fechaNormalizada = fechaLimpia;
                            }
                        }

                        const Fecha = fechaNormalizada;
                        const CodigoVende = fila.C || '0';
                        const CorredorVende = fila.D || '';
                        const CodigoCompra = fila.E || '0';
                        const CorredorCompra = fila.F || '';
                        const Cantidad = fila.G || '0';
                        const Precio = fila.H || '0';
                        const TipoOperacion = fila.I || '';
                        const Condicion = TipoOperacion === 'PM' || TipoOperacion === 'PH' ? TipoOperacion : 'CN';
                        // Limpiar nemotécnico: extraer solo el código de acción (ej: "LTM 886" -> "LTM")
                        let Nemotecnico = (fila.L || '').trim();
                        // Si contiene espacios, tomar solo la primera palabra (el código de acción)
                        if (Nemotecnico.includes(' ')) {
                            Nemotecnico = Nemotecnico.split(' ')[0];
                        }
                        // Limpiar cualquier carácter no alfanumérico al final
                        Nemotecnico = Nemotecnico.replace(/[^A-Za-z0-9]+$/, '').trim();
                        const Compra = fila.S || '0';
                        const Monto = (parseFloat(String(Cantidad).replace(/\./g, '').replace(',', '.')) || 0) * 
                                     (parseFloat(String(Precio).replace(/\./g, '').replace(',', '.')) || 0);

                        const esCompra = Compra === "832";
                        const codigoVendeNum = parseInt(CodigoVende) || 0;
                        const codigoCompraNum = parseInt(CodigoCompra) || 0;
                        const corredorVendeNombre = corredores.find(c => c.codigo === codigoVendeNum)?.nombre?.trim() || CorredorVende;
                        const corredorCompraNombre = corredores.find(c => c.codigo === codigoCompraNum)?.nombre?.trim() || CorredorCompra;

                        // Calcular fecha de pago (usar fecha en formato YYYYMMDD para crear Date)
                        const fecha = new Date(
                            parseInt(Fecha.substring(0, 4)),
                            parseInt(Fecha.substring(4, 6)) - 1,
                            parseInt(Fecha.substring(6, 8))
                        );
                        const fechaPago = calcularFechaPago(fecha, Condicion);

                        const operacion = {
                            Fecha: Fecha, // Enviar como string YYYYMMDD, no como objeto Date
                            Codigo: parseFloat(esCompra ? CodigoCompra : CodigoVende) || 0,
                            'Tipo Operación': esCompra ? `Compra ${Nemotecnico.toLowerCase().trim()}` : `Venta ${Nemotecnico.toLowerCase().trim()}`,
                            Nemotecnico: Nemotecnico,
                            Cantidad: Cantidad || '0',
                            Precio: Precio || '0',
                            'Dcto.': 0,
                            Comision: 0,
                            Iva: 0,
                            Abono: esCompra ? 0 : Monto,
                            Cargo: esCompra ? Monto : 0,
                            Saldo: 0,
                            'Fecha Pago': fechaPago ? `${String(fechaPago.getFullYear())}-${String(fechaPago.getMonth() + 1).padStart(2, '0')}-${String(fechaPago.getDate()).padStart(2, '0')}` : null,
                            Corredor: esCompra ? corredorCompraNombre : corredorVendeNombre,
                            Tipo: esCompra ? 'Compra' : 'Venta'
                        };
                        
                            console.log(`Operación ${index + 1}: Nemotécnico=${Nemotecnico}, Tipo=${operacion.Tipo}, Cantidad=${Cantidad}, Precio=${Precio}`);
                            
                            operaciones.push(operacion);
                        } catch (err) {
                            console.error(`Error al procesar fila ${index + 1}:`, err, fila);
                        }
                    });
                    
                    console.log(`Total de operaciones procesadas: ${operaciones.length}`);

                    // Guardar operaciones en la base de datos (enviar archivo como FormData)
                    const formData = new FormData();
                    formData.append('archivo', file);
                    formData.append('operaciones', JSON.stringify(operaciones));
                    formData.append('nombreArchivo', file.name);
                    
                    const response = await fetch(`${API_URL}/save-operaciones`, {
                        method: 'POST',
                        body: formData
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || 'Error al guardar operaciones CSV');
                    }

                    const result = await response.json();
                    
                    // Recargar balance e historial (con comparación de cambios)
                    // Esto actualizará automáticamente la tabla
                    await cargarBalance(true);
                    await cargarHistorial();
                    
                    alert(`Archivo CSV procesado exitosamente. Se guardaron ${result.saved} operaciones.`);
                } catch (err) {
                    setError(err.message);
                    console.error('Error al procesar CSV:', err);
                    alert(`Error al procesar CSV: ${err.message}`);
                } finally {
                    setUploadingBalance(false);
                }
            };

            reader.onerror = () => {
                setError('Error al leer el archivo');
                setUploadingBalance(false);
            };

            reader.readAsArrayBuffer(file);
        } catch (err) {
            setError(err.message);
            console.error('Error al procesar CSV:', err);
            alert(`Error al procesar CSV: ${err.message}`);
            setUploadingBalance(false);
        }
    }, [API_URL, cargarBalance, cargarHistorial]);

    const onDropArchivo = useCallback(async (acceptedFiles) => {
        if (acceptedFiles.length === 0) return;

        const file = acceptedFiles[0];
        const extension = file.name.split('.').pop().toLowerCase();

        if (extension === 'csv') {
            await procesarCSV(file);
        } else if (extension === 'xlsx' || extension === 'xls') {
            await onDropBalanceBase([file]);
        } else {
            setError('Tipo de archivo no soportado. Solo se aceptan archivos Excel (.xlsx, .xls) o CSV (.csv)');
        }
    }, [procesarCSV, onDropBalanceBase]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: onDropArchivo,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls'],
            'text/csv': ['.csv'],
        },
        multiple: false,
    });

    const formatearNumero = (numero) => {
        if (numero === null || numero === undefined || isNaN(numero)) return '0';
        // Redondear a entero (sin decimales)
        const numeroRedondeado = Math.round(parseFloat(numero));
        return numeroRedondeado.toLocaleString('es-CL', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
    };

    const formatearCantidad = (cantidad) => {
        if (cantidad === null || cantidad === undefined) return '0';
        // Redondear a entero (sin decimales) para la existencia
        const cantidadRedondeada = Math.round(parseFloat(cantidad));
        return cantidadRedondeada.toLocaleString('es-CL', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
    };

    const actualizarPrecioCierre = (nemotecnico, precio) => {
        setPreciosCierre(prev => ({
            ...prev,
            [nemotecnico]: parseFloat(precio) || 0
        }));
    };

    const iniciarEdicion = (item) => {
        setEditingItem(item.nemotecnico);
        setEditingData({
            existencia: item.existencia || 0,
            precioCompra: item.precioCompraPromedio || 0,
            precioCierre: preciosCierre[item.nemotecnico] || item.precioCierre || 0
        });
    };

    const cancelarEdicion = () => {
        setEditingItem(null);
        setEditingData({});
    };

    const guardarEdicion = async (nemotecnico) => {
        try {
            const response = await fetch(`${API_URL}/actualizar-fila-balance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nemotecnico: nemotecnico,
                    existencia: parseFloat(editingData.existencia) || 0,
                    precioCompra: parseFloat(editingData.precioCompra) || 0,
                    precioCierre: parseFloat(editingData.precioCierre) || 0
                    // valorizacionCompra NO se envía porque es un campo calculado
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error al actualizar fila');
            }

            // Actualizar el estado local
            if (editingData.precioCierre !== undefined) {
                actualizarPrecioCierre(nemotecnico, parseFloat(editingData.precioCierre) || 0);
            }
            
            // Recargar balance para asegurar sincronización
            await cargarBalance();
            
            setEditingItem(null);
            setEditingData({});
            mostrarNotificacion('Fila actualizada exitosamente', 'success');
        } catch (err) {
            mostrarNotificacion(`Error al actualizar fila: ${err.message}`, 'error');
            console.error('Error al actualizar fila:', err);
        }
    };

    const eliminarAjusteManual = async (nemotecnico) => {
        // Mostrar diálogo de confirmación
        setConfirmDialog({
            mensaje: `¿Estás seguro de que quieres eliminar el ajuste manual de ${nemotecnico}? Esto restaurará los valores calculados automáticamente desde las operaciones.`,
            onConfirm: async () => {
                setConfirmDialog(null);
                try {
                    const response = await fetch(`${API_URL}/ajuste-manual-balance/${nemotecnico}`, {
                        method: 'DELETE',
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        // Si no existe el ajuste, no es un error crítico
                        if (response.status === 404) {
                            mostrarNotificacion(`No hay ajuste manual para ${nemotecnico}`, 'info');
                            return;
                        }
                        throw new Error(errorData.error || 'Error al eliminar ajuste manual');
                    }

                    // Recargar balance para reflejar los cambios
                    await cargarBalance();
                    mostrarNotificacion(`Ajuste manual de ${nemotecnico} eliminado exitosamente`, 'success');
                } catch (err) {
                    mostrarNotificacion(`Error al eliminar ajuste manual: ${err.message}`, 'error');
                    console.error('Error al eliminar ajuste manual:', err);
                }
            },
            onCancel: () => {
                setConfirmDialog(null);
            }
        });
    };

    const calcularValorizacionCierre = (item) => {
        const precioCierre = preciosCierre[item.nemotecnico] || 0;
        return item.existencia * precioCierre;
    };

    const calcularAjusteMercado = (item) => {
        const valorizacionCierre = calcularValorizacionCierre(item);
        return valorizacionCierre - item.valorizacionCompra;
    };

    const handleSort = (column) => {
        if (sortColumn === column) {
            // Si ya está ordenado por esta columna, cambiar dirección
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // Si es una nueva columna, ordenar ascendente por defecto
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const getSortedBalance = () => {
        if (!balance || balance.length === 0) return balance;
        
        const sorted = [...balance].sort((a, b) => {
            let aValue, bValue;
            
            switch (sortColumn) {
                case 'nemotecnico':
                    aValue = a.nemotecnico || '';
                    bValue = b.nemotecnico || '';
                    break;
                case 'existencia':
                    aValue = parseFloat(a.existencia) || 0;
                    bValue = parseFloat(b.existencia) || 0;
                    break;
                case 'precioCompra':
                    aValue = parseFloat(a.precioCompraPromedio) || 0;
                    bValue = parseFloat(b.precioCompraPromedio) || 0;
                    break;
                case 'precioCierre':
                    aValue = parseFloat(preciosCierre[a.nemotecnico] || 0) || 0;
                    bValue = parseFloat(preciosCierre[b.nemotecnico] || 0) || 0;
                    break;
                case 'valorizacionCompra':
                    aValue = parseFloat(a.valorizacionCompra) || 0;
                    bValue = parseFloat(b.valorizacionCompra) || 0;
                    break;
                case 'valorizacionCierre':
                    aValue = calcularValorizacionCierre(a);
                    bValue = calcularValorizacionCierre(b);
                    break;
                case 'ajusteMercado':
                    aValue = calcularAjusteMercado(a);
                    bValue = calcularAjusteMercado(b);
                    break;
                default:
                    return 0;
            }
            
            if (typeof aValue === 'string') {
                return sortDirection === 'asc' 
                    ? aValue.localeCompare(bValue)
                    : bValue.localeCompare(aValue);
            } else {
                return sortDirection === 'asc' 
                    ? aValue - bValue
                    : bValue - aValue;
            }
        });
        
        return sorted;
    };

    const getSortIcon = (column) => {
        if (sortColumn !== column) {
            return <FontAwesomeIcon icon={faSort} className="sort-icon inactive" />;
        }
        return sortDirection === 'asc' 
            ? <FontAwesomeIcon icon={faSortUp} className="sort-icon active" />
            : <FontAwesomeIcon icon={faSortDown} className="sort-icon active" />;
    };

    const calcularTotal = (campo) => {
        return balance.reduce((sum, item) => {
            if (campo === 'valorizacionCompra') {
                return sum + (item.valorizacionCompra || 0);
            } else if (campo === 'valorizacionCierre') {
                return sum + (calcularValorizacionCierre(item) || 0);
            } else if (campo === 'ajusteMercado') {
                return sum + (calcularAjusteMercado(item) || 0);
            }
            return sum;
        }, 0);
    };

    const descargarExcel = async () => {
        // Obtener balance ordenado
        const balanceOrdenado = getSortedBalance();
        
        // Obtener fecha del último CSV cargado
        const ultimoCSV = historial.find(item => item.tipo === 'csv');
        let fechaFormateada = '';
        if (ultimoCSV && ultimoCSV.fechaArchivo) {
            // Formatear fecha de YYYY-MM-DD a DD/MM/YYYY
            const fecha = new Date(ultimoCSV.fechaArchivo);
            const dia = String(fecha.getDate()).padStart(2, '0');
            const mes = String(fecha.getMonth() + 1).padStart(2, '0');
            const año = fecha.getFullYear();
            fechaFormateada = `${dia}/${mes}/${año}`;
        } else {
            // Si no hay fecha, usar la fecha actual
            const hoy = new Date();
            const dia = String(hoy.getDate()).padStart(2, '0');
            const mes = String(hoy.getMonth() + 1).padStart(2, '0');
            const año = hoy.getFullYear();
            fechaFormateada = `${dia}/${mes}/${año}`;
        }
        
        // Crear nuevo workbook con ExcelJS
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Balance Acciones');

        // Agregar título en la primera fila
        const titulo = `CARTERA EMF RETORNO ABSOLUTO ACCIONES FIP AL ${fechaFormateada}`;
        const titleRow = worksheet.addRow([titulo]);
        titleRow.getCell(1).font = { bold: true, size: 14 };
        titleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
        // Combinar celdas para el título (9 columnas)
        worksheet.mergeCells(1, 1, 1, 9);
        titleRow.height = 30;

        // Agregar fila vacía
        worksheet.addRow([]);

        // Definir columnas con anchos
        worksheet.columns = [
            { header: 'N°', key: 'numero', width: 6 },
            { header: 'Tipo Operación', key: 'tipoOperacion', width: 18 },
            { header: 'INSTRUMENTO', key: 'instrumento', width: 15 },
            { header: 'EXISTENCIA', key: 'existencia', width: 15 },
            { header: 'PRECIO COMPRA', key: 'precioCompra', width: 15 },
            { header: 'PRECIO CIERRE', key: 'precioCierre', width: 15 },
            { header: 'VALORIZACIÓN COMPRA', key: 'valorizacionCompra', width: 20 },
            { header: 'VALORIZACIÓN CIERRE', key: 'valorizacionCierre', width: 20 },
            { header: 'AJUSTE A MERCADO', key: 'ajusteMercado', width: 18 }
        ];

        // Estilo para encabezados
        const headerStyle = {
            font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
            fill: {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4472C4' } // Azul
            },
            alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
            border: {
                top: { style: 'thin', color: { argb: 'FF000000' } },
                left: { style: 'thin', color: { argb: 'FF000000' } },
                bottom: { style: 'thin', color: { argb: 'FF000000' } },
                right: { style: 'thin', color: { argb: 'FF000000' } }
            }
        };

        // Aplicar estilo a encabezados (ahora en la fila 3 después del título y fila vacía)
        worksheet.getRow(3).eachCell((cell) => {
            cell.style = headerStyle;
        });
        worksheet.getRow(3).height = 25;

        // Agregar datos usando arrays para mantener el orden correcto
        balanceOrdenado.forEach((item, index) => {
            const precioCierre = preciosCierre[item.nemotecnico] || 0;
            const valorizacionCierre = item.existencia * precioCierre;
            const ajusteMercado = valorizacionCierre - item.valorizacionCompra;

            // Redondear valores numéricos
            const existenciaRedondeada = Math.round(item.existencia); // Sin decimales (números enteros)
            const precioCompraRedondeado = Math.round(item.precioCompraPromedio * 100) / 100; // 2 decimales
            const precioCierreRedondeado = Math.round(precioCierre * 100) / 100; // 2 decimales
            const valorizacionCompraRedondeada = Math.round(item.valorizacionCompra); // Sin decimales
            const valorizacionCierreRedondeada = Math.round(valorizacionCierre); // Sin decimales
            const ajusteMercadoRedondeado = Math.round(ajusteMercado); // Sin decimales

            // Usar array para mantener el orden exacto de las columnas
            const row = worksheet.addRow([
                index + 1, // N°
                item.tipoOperacion || (item.existencia < 0 ? 'Corto' : 'Cartera'), // Tipo Operación
                item.nemotecnico, // INSTRUMENTO
                existenciaRedondeada, // EXISTENCIA (sin decimales)
                precioCompraRedondeado, // PRECIO COMPRA (2 decimales)
                precioCierreRedondeado, // PRECIO CIERRE (2 decimales)
                valorizacionCompraRedondeada, // VALORIZACIÓN COMPRA (sin decimales)
                valorizacionCierreRedondeada, // VALORIZACIÓN CIERRE (sin decimales)
                ajusteMercadoRedondeado // AJUSTE A MERCADO (sin decimales)
            ]);

            // Estilo para filas de datos
            row.eachCell((cell, colNumber) => {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
                    left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
                    bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
                    right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
                };

                // Formato numérico según columna (colNumber es 1-indexed)
                // Columna 1: N°, Columna 2: Tipo, Columna 3: Instrumento
                // Columna 4: Existencia, Columna 5: Precio Compra, Columna 6: Precio Cierre
                // Columna 7: Valorización Compra, Columna 8: Valorización Cierre, Columna 9: Ajuste
                if (colNumber === 1) { // N°
                    cell.numFmt = '0';
                    cell.alignment = { horizontal: 'center' };
                } else if (colNumber === 4) { // EXISTENCIA
                    cell.numFmt = '#,##0'; // Sin decimales
                    cell.alignment = { horizontal: 'right' };
                } else if (colNumber === 5 || colNumber === 6) { // PRECIO COMPRA y PRECIO CIERRE
                    cell.numFmt = '#,##0.00';
                    cell.alignment = { horizontal: 'right' };
                } else if (colNumber >= 7 && colNumber <= 9) { // VALORIZACIONES y AJUSTE (sin decimales)
                    cell.numFmt = '#,##0';
                    cell.alignment = { horizontal: 'right' };
                } else {
                    cell.alignment = { horizontal: 'left' };
                }
            });
        });

        // Agregar fila de totales
        const totalValorizacionCompra = calcularTotal('valorizacionCompra');
        const totalValorizacionCierre = calcularTotal('valorizacionCierre');
        const totalAjusteMercado = calcularTotal('ajusteMercado');

        // Redondear totales
        const totalValorizacionCompraRedondeado = Math.round(totalValorizacionCompra * 100) / 100; // 2 decimales
        const totalValorizacionCierreRedondeado = Math.round(totalValorizacionCierre * 100) / 100; // 2 decimales
        const totalAjusteMercadoRedondeado = Math.round(totalAjusteMercado * 100) / 100; // 2 decimales

        // Agregar fila de totales usando array para mantener el orden correcto
        const totalRow = worksheet.addRow([
            null, // N°
            'Valorizacion de Cartera Acciones', // Tipo Operación
            null, // INSTRUMENTO
            null, // EXISTENCIA
            null, // PRECIO COMPRA
            null, // PRECIO CIERRE
            totalValorizacionCompraRedondeado, // VALORIZACIÓN COMPRA (2 decimales)
            totalValorizacionCierreRedondeado, // VALORIZACIÓN CIERRE (2 decimales)
            totalAjusteMercadoRedondeado // AJUSTE A MERCADO (2 decimales)
        ]);

        // Estilo para fila de totales - aplicar a todas las celdas explícitamente
        // Solo bordes horizontales (superior e inferior), sin bordes verticales
        const borderStyle = {
            top: { style: 'medium', color: { argb: 'FF000000' } },
            bottom: { style: 'medium', color: { argb: 'FF000000' } }
        };

        // Aplicar estilo a todas las celdas de la fila (1-9)
        for (let colNum = 1; colNum <= 9; colNum++) {
            const cell = totalRow.getCell(colNum);
            cell.font = { bold: true };
            cell.border = borderStyle;
            
            // Aplicar formato específico según columna
            if (colNum === 7) { // VALORIZACIÓN COMPRA
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE7E6E6' } // Gris claro
                };
                cell.numFmt = '#,##0'; // Sin decimales
                cell.alignment = { horizontal: 'right' };
            } else if (colNum === 8) { // VALORIZACIÓN CIERRE
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE7E6E6' } // Gris claro
                };
                cell.numFmt = '#,##0'; // Sin decimales
                cell.alignment = { horizontal: 'right' };
            } else if (colNum === 9) { // AJUSTE A MERCADO
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE7E6E6' } // Gris claro
                };
                cell.numFmt = '#,##0'; // Sin decimales
                cell.alignment = { horizontal: 'right' };
            } else {
                cell.alignment = { horizontal: 'left' };
            }
        }
        totalRow.height = 22;

        // Congelar fila de encabezados (fila 3, después del título)
        worksheet.views = [{ state: 'frozen', ySplit: 3 }];

        // Generar nombre del archivo con la fecha formateada
        const nombreArchivo = `CARTERA EMF RETORNO ABSOLUTO ACCIONES FIP AL ${fechaFormateada}.xlsx`;

        // Descargar archivo
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = nombreArchivo;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    };

    return (
        <div className={`balance-acciones-container ${darkMode ? 'dark-mode' : ''}`}>
            {error && (
                <div className="balance-acciones-error">
                    Error: {error}
                </div>
            )}

            {loading && balance.length === 0 && historial.length === 0 ? (
                <div className="balance-acciones-loading">
                    Cargando balance...
                </div>
            ) : (
                <div className="balance-content-wrapper">
                    <div className="balance-table-section">
                        <div className="balance-table-actions">
                            <div className="balance-info-text">
                                {(() => {
                                    const balanceBase = historial.find(item => item.tipo === 'balance_base');
                                    const fechaCarga = balanceBase?.fechaProcesamiento 
                                        ? new Date(balanceBase.fechaProcesamiento).toLocaleDateString('es-CL', { 
                                            day: '2-digit', 
                                            month: '2-digit', 
                                            year: 'numeric' 
                                        })
                                        : null;
                                    return (
                                        <p>
                                            Cartera base Acciones nacionales {fechaCarga ? `cargada el ${fechaCarga}` : 'cargada'}, se actualiza manualmente subiendo el csv enviado por BCS.
                                        </p>
                                    );
                                })()}
                            </div>
                            <div className="balance-actions-buttons">
                                <button
                                    onClick={() => {
                                        // No limpiar filas modificadas al actualizar, solo recargar balance
                                        cargarBalance();
                                    }}
                                    className="balance-icon-button refresh"
                                    disabled={loading}
                                    title="Actualizar balance"
                                >
                                    <FontAwesomeIcon icon={faSync} spin={loading} />
                                </button>
                                <button
                                    onClick={descargarExcel}
                                    className="balance-icon-button download"
                                    disabled={loading || balance.length === 0}
                                    title="Descargar Excel"
                                >
                                    <FontAwesomeIcon icon={faFileExcel} />
                                </button>
                            </div>
                        </div>
                        {nemotecnicosNeteados.length > 0 && (
                            <div className="balance-advertencia-neteo">
                                <span className="advertencia-icono">⚠️</span>
                                <span className="advertencia-texto">
                                    <strong>Advertencia:</strong> Las siguientes operaciones se netearon (existencia final = 0) y no aparecen en la tabla: <strong>{nemotecnicosNeteados.join(', ')}</strong>
                                </span>
                            </div>
                        )}
                        {filasModificadas.size > 0 && (
                            <div className="filas-modificadas-leyenda">
                                <span className="leyenda-indicador"></span>
                                <span className="leyenda-texto">
                                    {filasModificadas.size} {filasModificadas.size === 1 ? 'fila modificada' : 'filas modificadas'} en la última subida de operaciones
                                </span>
                            </div>
                        )}
                        <div className="balance-acciones-table-container">
                            <table className="balance-acciones-table">
                            <thead>
                                <tr>
                                    <th>N°</th>
                                    <th>Tipo Operación</th>
                                    <th 
                                        className="sortable" 
                                        onClick={() => handleSort('nemotecnico')}
                                        title="Ordenar por INSTRUMENTO"
                                    >
                                        INSTRUMENTO {getSortIcon('nemotecnico')}
                                    </th>
                                    <th 
                                        className="sortable" 
                                        onClick={() => handleSort('existencia')}
                                        title="Ordenar por EXISTENCIA"
                                    >
                                        EXISTENCIA {getSortIcon('existencia')}
                                    </th>
                                    <th 
                                        className="sortable" 
                                        onClick={() => handleSort('precioCompra')}
                                        title="Ordenar por PRECIO COMPRA"
                                    >
                                        PRECIO COMPRA {getSortIcon('precioCompra')}
                                    </th>
                                    <th 
                                        className="sortable" 
                                        onClick={() => handleSort('precioCierre')}
                                        title="Ordenar por PRECIO CIERRE"
                                    >
                                        PRECIO CIERRE {getSortIcon('precioCierre')}
                                    </th>
                                    <th 
                                        className="sortable" 
                                        onClick={() => handleSort('valorizacionCompra')}
                                        title="Ordenar por VALORIZACIÓN COMPRA"
                                    >
                                        VALORIZACIÓN COMPRA {getSortIcon('valorizacionCompra')}
                                    </th>
                                    <th 
                                        className="sortable" 
                                        onClick={() => handleSort('valorizacionCierre')}
                                        title="Ordenar por VALORIZACIÓN CIERRE"
                                    >
                                        VALORIZACIÓN CIERRE {getSortIcon('valorizacionCierre')}
                                    </th>
                                    <th 
                                        className="sortable" 
                                        onClick={() => handleSort('ajusteMercado')}
                                        title="Ordenar por AJUSTE A MERCADO"
                                    >
                                        AJUSTE A MERCADO {getSortIcon('ajusteMercado')}
                                    </th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {balance.length === 0 ? (
                                    <tr>
                                        <td colSpan="10" style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                                            No hay operaciones registradas. Sube un archivo Excel con el balance base para comenzar.
                                        </td>
                                    </tr>
                                ) : (
                                    getSortedBalance().map((item, index) => {
                                    const precioCierre = preciosCierre[item.nemotecnico] || 0;
                                    const valorizacionCierre = calcularValorizacionCierre(item);
                                    const ajusteMercado = calcularAjusteMercado(item);
                                    
                                    const esModificada = filasModificadas.has(item.nemotecnico);
                                    
                                    return (
                                        <tr key={item.nemotecnico} className={esModificada ? 'fila-modificada' : ''}>
                                            <td>{index + 1}</td>
                                            <td>{item.tipoOperacion || (item.existencia < 0 ? 'Corto' : 'Cartera')}</td>
                                            <td>{item.nemotecnico}</td>
                                            <td className={`number ${item.existencia < 0 ? 'negative' : ''}`}>
                                                {editingItem === item.nemotecnico ? (
                                                    <input
                                                        type="number"
                                                        step="0.001"
                                                        value={editingData.existencia || ''}
                                                        onChange={(e) => setEditingData({
                                                            ...editingData,
                                                            existencia: parseFloat(e.target.value) || 0
                                                        })}
                                                        className="edit-input-inline"
                                                    />
                                                ) : (
                                                    formatearCantidad(item.existencia)
                                                )}
                                            </td>
                                            <td className={`number ${item.precioCompraPromedio < 0 ? 'negative' : ''}`}>
                                                {editingItem === item.nemotecnico ? (
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={editingData.precioCompra || ''}
                                                        onChange={(e) => setEditingData({
                                                            ...editingData,
                                                            precioCompra: parseFloat(e.target.value) || 0
                                                        })}
                                                        className="edit-input-inline"
                                                    />
                                                ) : (
                                                    formatearNumero(item.precioCompraPromedio)
                                                )}
                                            </td>
                                            <td className="number">
                                                {editingItem === item.nemotecnico ? (
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={editingData.precioCierre || ''}
                                                        onChange={(e) => setEditingData({
                                                            ...editingData,
                                                            precioCierre: parseFloat(e.target.value) || 0
                                                        })}
                                                        className="edit-input-inline"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span className={`precio-cierre-display ${precioCierre < 0 ? 'negative' : ''}`}>
                                                        {precioCierre !== 0 ? formatearNumero(precioCierre) : '0'}
                                                    </span>
                                                )}
                                            </td>
                                            <td className={`number ${item.valorizacionCompra < 0 ? 'negative' : ''}`}>
                                                {formatearNumero(item.valorizacionCompra)}
                                            </td>
                                            <td className={`number ${valorizacionCierre < 0 ? 'negative' : ''}`}>
                                                {formatearNumero(valorizacionCierre)}
                                            </td>
                                            <td className={`number ${ajusteMercado < 0 ? 'negative' : ''}`}>
                                                {formatearNumero(ajusteMercado)}
                                            </td>
                                            <td>
                                                {editingItem === item.nemotecnico ? (
                                                    <div className="edit-actions-inline">
                                                        <button
                                                            onClick={() => guardarEdicion(item.nemotecnico)}
                                                            className="save-button-inline"
                                                            title="Guardar cambios"
                                                        >
                                                            <FontAwesomeIcon icon={faCheck} />
                                                        </button>
                                                        <button
                                                            onClick={cancelarEdicion}
                                                            className="cancel-button-inline"
                                                            title="Cancelar edición"
                                                        >
                                                            <FontAwesomeIcon icon={faTimes} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="action-buttons-group">
                                                        <button
                                                            onClick={() => iniciarEdicion(item)}
                                                            className="edit-button"
                                                            title="Modificar fila completa"
                                                        >
                                                            <FontAwesomeIcon icon={faEdit} />
                                                        </button>
                                                        <button
                                                            onClick={() => eliminarAjusteManual(item.nemotecnico)}
                                                            className="delete-adjustment-button"
                                                            title="Eliminar ajuste manual (restaurar valores calculados)"
                                                        >
                                                            <FontAwesomeIcon icon={faTrash} />
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                    })
                                )}
                            </tbody>
                            {balance.length > 0 && (
                                <tfoot>
                                    <tr className="total-row">
                                        <td colSpan="2">Valorizacion de Cartera Acciones</td>
                                        <td colSpan="4"></td>
                                        <td className={`number ${calcularTotal('valorizacionCompra') < 0 ? 'negative' : ''}`}>
                                            {formatearNumero(calcularTotal('valorizacionCompra'))}
                                        </td>
                                        <td className={`number ${calcularTotal('valorizacionCierre') < 0 ? 'negative' : ''}`}>
                                            {formatearNumero(calcularTotal('valorizacionCierre'))}
                                        </td>
                                        <td className={`number ${calcularTotal('ajusteMercado') < 0 ? 'negative' : ''}`}>
                                            {formatearNumero(calcularTotal('ajusteMercado'))}
                                        </td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                    </div>

                    {/* Columna derecha: Drag and drop arriba, Historial abajo */}
                    <div className="balance-right-section">
                        {/* Sección para subir archivos */}
                        <div className="balance-base-upload-section">
                            <h3>Subir Archivos</h3>
                            <div {...getRootProps()} className={`balance-base-dropzone ${isDragActive ? 'active' : ''}`}>
                                <input {...getInputProps()} />
                                <FontAwesomeIcon icon={faUpload} />
                                <p>
                                    {isDragActive
                                        ? 'Suelta el archivo aquí...'
                                        : 'Arrastra un archivo Excel o CSV aquí o haz clic para seleccionar'}
                                </p>
                                <small>
                                    <strong>Excel:</strong> Archivo "Control Carteras y Balances" con balance base (columnas: TIPO OPERACIÓN, INSTRUMENTO, EXISTENCIA, PRECIO COMPRA, etc.)<br />
                                    <strong>CSV:</strong> Archivos CSV generados por BCS para actualizar las operaciones diarias
                                </small>
                            </div>
                            {uploadingBalance && <p className="uploading-status">Procesando archivo...</p>}
                        </div>

                        {/* Historial de archivos */}
                        <div className="balance-historial-section">
                            <h3>Historial de Archivos</h3>
                            {confirmDialog && (
                                <div className="historial-confirm-dialog">
                                    <div className="confirm-dialog-content">
                                        <p className="confirm-dialog-message">{confirmDialog.mensaje}</p>
                                        <div className="confirm-dialog-buttons">
                                            <button 
                                                onClick={confirmDialog.onConfirm}
                                                className="confirm-button"
                                            >
                                                Sí, eliminar
                                            </button>
                                            <button 
                                                onClick={confirmDialog.onCancel}
                                                className="cancel-button"
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {notification && (
                                <div className={`historial-notification ${notification.tipo}`}>
                                    {notification.mensaje}
                                </div>
                            )}
                            <div className="historial-list">
                                {historial.length === 0 ? (
                                    <p className="historial-empty">No hay archivos procesados aún</p>
                                ) : (
                                    <table className="historial-table">
                                        <thead>
                                            <tr>
                                                <th>Archivo</th>
                                                <th>Tipo</th>
                                                <th>Fecha</th>
                                                <th>Operaciones</th>
                                                <th>Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {historial.map((item) => (
                                                <tr key={item.id}>
                                                    <td>
                                                        <button
                                                            onClick={() => descargarArchivoOriginal(item.id, item.nombreArchivo)}
                                                            className="file-icon-button"
                                                            title="Descargar archivo original"
                                                            style={{ 
                                                                background: 'none', 
                                                                border: 'none', 
                                                                cursor: 'pointer',
                                                                padding: 0,
                                                                marginRight: '0.5rem',
                                                                color: 'inherit'
                                                            }}
                                                        >
                                                            <FontAwesomeIcon icon={faFileAlt} />
                                                        </button>
                                                        {item.nombreArchivo}
                                                    </td>
                                                    <td>
                                                        <span className={`tipo-badge ${item.tipo}`}>
                                                            {item.tipo === 'csv' ? 'CSV' : 'Balance Base'}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {new Date(item.fechaProcesamiento).toLocaleDateString('es-CL')}
                                                    </td>
                                                    <td className="number">{item.cantidadOperaciones}</td>
                                                    <td>
                                                        <div className="historial-actions">
                                                            {item.tipo === 'csv' && (
                                                                <>
                                                                    <button
                                                                        onClick={() => verOperaciones(item.id)}
                                                                        className="view-operations-button"
                                                                        title="Ver y editar operaciones"
                                                                    >
                                                                        <FontAwesomeIcon icon={faEye} />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => descargarCSVTransformado(item.id, item.nombreArchivo)}
                                                                        className="download-csv-button"
                                                                        title="Descargar CSV transformado a FINIX"
                                                                    >
                                                                        <FontAwesomeIcon icon={faDownload} />
                                                                    </button>
                                                                </>
                                                            )}
                                                            <button
                                                                onClick={(e) => eliminarArchivo(item.id, item.nombreArchivo, e)}
                                                                className="delete-button"
                                                                title="Eliminar archivo y sus operaciones"
                                                            >
                                                                <FontAwesomeIcon icon={faTrash} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de visualización y edición de operaciones */}
            {showOperacionesModal && (
                <div className="operaciones-modal-overlay" onClick={() => setShowOperacionesModal(false)}>
                    <div className="operaciones-modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="operaciones-modal-header">
                            <h2>Operaciones del Historial</h2>
                            <button 
                                className="operaciones-modal-close"
                                onClick={() => setShowOperacionesModal(false)}
                            >
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        </div>
                        <div className="operaciones-modal-body">
                            <div className="operaciones-modal-actions">
                                <button
                                    onClick={() => {
                                        const nuevaFila = {
                                            id: null,
                                            Fecha: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
                                            Nemotecnico: '',
                                            Cantidad: '',
                                            Precio: '',
                                            Monto: '',
                                            Tipo: '',
                                            CorredorVende: '',
                                            CorredorCompra: '',
                                            CodigoVende: '',
                                            CodigoCompra: '',
                                            Condicion: 'CN',
                                            Compra: '',
                                            esNuevaFila: true
                                        };
                                        setOperacionesModal(prev => [nuevaFila, ...prev]);
                                        setFilasEditables(prev => new Set([0, ...Array.from(prev).map(i => i + 1)]));
                                    }}
                                    className="operaciones-modal-add-button"
                                >
                                    <FontAwesomeIcon icon={faPlus} />
                                    Agregar Fila
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            setLoading(true);
                                            // Convertir operaciones al formato esperado por el servidor
                                            const operacionesParaGuardar = operacionesModal.map(op => ({
                                                id: op.id,
                                                fecha: op.Fecha ? (op.Fecha.length === 8 ? 
                                                    `${op.Fecha.substring(0, 4)}-${op.Fecha.substring(4, 6)}-${op.Fecha.substring(6, 8)}` : 
                                                    op.Fecha) : null,
                                                nemotecnico: op.Nemotecnico || '',
                                                cantidad: parseFloat(op.Cantidad?.toString().replace(/\./g, '').replace(',', '.')) || 0,
                                                precio: parseFloat(op.Precio?.toString().replace(/\./g, '').replace(',', '.')) || 0,
                                                monto: parseFloat(op.Monto?.toString().replace(/\./g, '').replace(',', '.')) || 0,
                                                tipo_operacion: op.Tipo || '',
                                                codigo_corredor: op.Tipo === 'Compra' ? (op.CodigoCompra || 0) : (op.CodigoVende || 0),
                                                nombre_corredor: op.Tipo === 'Compra' ? (op.CorredorCompra || '') : (op.CorredorVende || '')
                                            }));

                                            const response = await fetch(`${API_URL}/historial-operaciones/${historialIdModal}`, {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                },
                                                body: JSON.stringify({ operaciones: operacionesParaGuardar }),
                                            });

                                            if (!response.ok) {
                                                const errorData = await response.json();
                                                throw new Error(errorData.error || 'Error al guardar operaciones');
                                            }

                                            // Recargar balance e historial
                                            await cargarBalance();
                                            await cargarHistorial();
                                            
                                            // Cerrar modal
                                            setShowOperacionesModal(false);
                                            alert('Operaciones guardadas correctamente');
                                        } catch (error) {
                                            console.error('Error al guardar operaciones:', error);
                                            alert(`Error al guardar operaciones: ${error.message}`);
                                        } finally {
                                            setLoading(false);
                                        }
                                    }}
                                    className="operaciones-modal-add-button"
                                    style={{ backgroundColor: '#4caf50' }}
                                >
                                    <FontAwesomeIcon icon={faCheck} />
                                    Guardar Cambios
                                </button>
                            </div>
                            <div className="operaciones-modal-table-container">
                                <table className="operaciones-modal-table">
                                    <thead>
                                        <tr>
                                            <th>Fecha</th>
                                            <th>Tipo</th>
                                            <th>Nemotecnico</th>
                                            <th>Cantidad</th>
                                            <th>Precio</th>
                                            <th>Monto</th>
                                            <th>Corredor</th>
                                            <th>Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {operacionesModal.map((fila, index) => {
                                            const fechaBase = fila.Fecha ? new Date(
                                                fila.Fecha.substring(0, 4),
                                                parseInt(fila.Fecha.substring(4, 6)) - 1,
                                                fila.Fecha.substring(6, 8)
                                            ) : new Date();
                                            
                                            const formatDate = (dateString) => {
                                                if (!dateString) return '';
                                                if (dateString.length === 8 && !dateString.includes('-')) {
                                                    const year = dateString.substring(0, 4);
                                                    const month = dateString.substring(4, 6);
                                                    const day = dateString.substring(6, 8);
                                                    return `${day}-${month}-${year}`;
                                                }
                                                if (dateString.includes('-')) {
                                                    const [year, month, day] = dateString.split('-');
                                                    return `${day}-${month}-${year}`;
                                                }
                                                return dateString;
                                            };

                                            return (
                                                <tr key={index} className={fila.esNuevaFila ? 'fila-nueva' : ''}>
                                                    <td>
                                                        {filasEditables.has(index) ? (
                                                            <DatePicker
                                                                selected={fechaBase}
                                                                onChange={(date) => {
                                                                    if (date) {
                                                                        const year = date.getFullYear();
                                                                        const month = String(date.getMonth() + 1).padStart(2, '0');
                                                                        const day = String(date.getDate()).padStart(2, '0');
                                                                        const nuevaFecha = `${year}${month}${day}`;
                                                                        const nuevasOperaciones = [...operacionesModal];
                                                                        nuevasOperaciones[index].Fecha = nuevaFecha;
                                                                        setOperacionesModal(nuevasOperaciones);
                                                                    }
                                                                }}
                                                                dateFormat="dd-MM-yyyy"
                                                                className="celda-input"
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
                                                                onChange={(e) => {
                                                                    const nuevasOperaciones = [...operacionesModal];
                                                                    nuevasOperaciones[index].Tipo = e.target.value;
                                                                    nuevasOperaciones[index].Compra = e.target.value === 'Compra' ? '832' : '';
                                                                    setOperacionesModal(nuevasOperaciones);
                                                                }}
                                                            >
                                                                <option value="">Seleccionar</option>
                                                                <option value="Compra">Compra</option>
                                                                <option value="Venta">Venta</option>
                                                            </select>
                                                        ) : (
                                                            fila.Tipo
                                                        )}
                                                    </td>
                                                    <td>
                                                        {filasEditables.has(index) ? (
                                                            <input
                                                                type="text"
                                                                className="celda-input"
                                                                value={fila.Nemotecnico || ''}
                                                                onChange={(e) => {
                                                                    const nuevasOperaciones = [...operacionesModal];
                                                                    nuevasOperaciones[index].Nemotecnico = e.target.value;
                                                                    setOperacionesModal(nuevasOperaciones);
                                                                }}
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
                                                                onChange={(e) => {
                                                                    const nuevasOperaciones = [...operacionesModal];
                                                                    nuevasOperaciones[index].Cantidad = e.target.value;
                                                                    // Recalcular Monto
                                                                    const cantidad = parseFloat(e.target.value) || 0;
                                                                    const precio = parseFloat(fila.Precio) || 0;
                                                                    nuevasOperaciones[index].Monto = (cantidad * precio).toString();
                                                                    setOperacionesModal(nuevasOperaciones);
                                                                }}
                                                            />
                                                        ) : (
                                                            parseInt(fila.Cantidad?.toString().replace(/\./g, ''))?.toLocaleString('es-CL') || '0'
                                                        )}
                                                    </td>
                                                    <td>
                                                        {filasEditables.has(index) ? (
                                                            <input
                                                                type="text"
                                                                className="celda-input"
                                                                value={fila.Precio}
                                                                onChange={(e) => {
                                                                    const nuevasOperaciones = [...operacionesModal];
                                                                    nuevasOperaciones[index].Precio = e.target.value;
                                                                    // Recalcular Monto
                                                                    const cantidad = parseFloat(fila.Cantidad) || 0;
                                                                    const precio = parseFloat(e.target.value) || 0;
                                                                    nuevasOperaciones[index].Monto = (cantidad * precio).toString();
                                                                    setOperacionesModal(nuevasOperaciones);
                                                                }}
                                                            />
                                                        ) : (
                                                            parseFloat(fila.Precio?.toString().replace(/\./g, '').replace(',', '.'))?.toLocaleString('es-CL', {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2
                                                            }) || '0,00'
                                                        )}
                                                    </td>
                                                    <td>
                                                        {Math.round(parseFloat(fila.Monto?.toString().replace(/\./g, '').replace(',', '.') || 0)).toLocaleString('es-CL')}
                                                    </td>
                                                    <td>
                                                        {filasEditables.has(index) ? (
                                                            <select
                                                                className="celda-input"
                                                                value={fila.Tipo === 'Compra' ? fila.CodigoCompra : fila.CodigoVende}
                                                                onChange={(e) => {
                                                                    const codigoCorredor = parseInt(e.target.value);
                                                                    const corredor = corredores.find(c => c.codigo === codigoCorredor);
                                                                    const nuevasOperaciones = [...operacionesModal];
                                                                    if (fila.Tipo === 'Compra') {
                                                                        nuevasOperaciones[index].CodigoCompra = codigoCorredor;
                                                                        nuevasOperaciones[index].CorredorCompra = corredor?.nombre || '';
                                                                    } else {
                                                                        nuevasOperaciones[index].CodigoVende = codigoCorredor;
                                                                        nuevasOperaciones[index].CorredorVende = corredor?.nombre || '';
                                                                    }
                                                                    setOperacionesModal(nuevasOperaciones);
                                                                }}
                                                            >
                                                                <option value="">Seleccionar</option>
                                                                {corredores.map(corredor => (
                                                                    <option key={corredor.codigo} value={corredor.codigo}>
                                                                        {corredor.nombre}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            fila.Tipo === 'Compra' ? fila.CorredorCompra : fila.CorredorVende
                                                        )}
                                                    </td>
                                                    <td>
                                                        <div className="operaciones-modal-row-actions">
                                                            {filasEditables.has(index) ? (
                                                                <button
                                                                    onClick={() => {
                                                                        setFilasEditables(prev => {
                                                                            const nuevas = new Set(prev);
                                                                            nuevas.delete(index);
                                                                            return nuevas;
                                                                        });
                                                                    }}
                                                                    className="operaciones-modal-check-button"
                                                                >
                                                                    <FontAwesomeIcon icon={faCheck} />
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => {
                                                                        setFilasEditables(prev => new Set([...prev, index]));
                                                                    }}
                                                                    className="operaciones-modal-edit-button"
                                                                >
                                                                    <FontAwesomeIcon icon={faEdit} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => {
                                                                    const nuevasOperaciones = operacionesModal.filter((_, i) => i !== index);
                                                                    setOperacionesModal(nuevasOperaciones);
                                                                }}
                                                                className="operaciones-modal-delete-button"
                                                            >
                                                                <FontAwesomeIcon icon={faTrash} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default BalanceAcciones;

