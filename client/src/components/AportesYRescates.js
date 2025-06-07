import React, { useEffect, useState } from 'react';
import { format, parseISO, getDay, subDays, isWeekend, addHours } from 'date-fns';
import { es } from 'date-fns/locale';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExcel, faClock } from '@fortawesome/free-solid-svg-icons';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import useFeriadosChile from '../hooks/useFeriadosChile';
import '../styles/AYR.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const apiUrl = process.env.NODE_ENV === 'production' 
    ? process.env.REACT_APP_API_URL || window.location.origin + '/api'
    : process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

// Añadimos un console.log para debug en desarrollo
if (process.env.NODE_ENV !== 'production') {
    console.log('API URL:', apiUrl);
}

export const AYRModalContent = {
    title: 'Aportes y Rescates FFMM',
    content: (
        <>
            <p>
                Esta app muestra los datos de Aportes y Rescates de los Fondos mutuos nacionales y el acumulado de Aportes-Rescates dia a dia.
            </p>
            <h3>Fuente de datos:</h3>
            <p>
                <a href="https://estadisticas2.aafm.cl/DailyStadistics" target="_blank" rel="noopener noreferrer">
                    AAFM.cl - Asociación de Administradoras de Fondos de Pensiones
                </a>
            </p>
            <h3>Los filtros ocupados para obtener esta tabla son:</h3>
            <p><strong>Categorias AFM:</strong>
            <ul>
                <li>Accionario Nacional</li>
                <li>Accionario Nacional Large Cap</li>
                <li>Accionario Nacional Otros</li>
                <li>Accionario Nacional Small & Mid Cap</li>
                <li>Inversionistas Calificados Accionario Nacional</li>
            </ul>
            </p>
            <p><strong>Administradora:</strong> Todos</p>
            <p><strong>APV:</strong> Todos</p>
            <p><strong>Tipo de Inversión:</strong> Nacional</p>
            <p><strong>Checkboxes marcados:</strong> Flujo Aporte y Flujo Rescate.</p>
            <p>
                Los datos se actualizan diariamente según la información publicada por la AAFM.
            </p>
        </>
    )
};

const AportesRescatesNetoChart = ({ data, darkMode }) => {
    const color = darkMode ? '#333' : '#f26439';
    const gridColor = darkMode ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.3)';
    
    // Función para formatear números grandes en el eje Y (formato chileno MM)
    const formatYAxisNumber = (value) => {
        return (value / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' MM';
    };
    
    const labels = data.map(d => format(parseISO(d.fecha), 'dd/MM/yyyy'));
    const aportes = data.map(d => d.flujo_aportes);
    const rescates = data.map(d => d.flujo_rescates);
    const neto = data.map(d => d.neto_aportes_rescates);

    const chartData = {
        labels,
        datasets: [
            {
                label: 'Aportes',
                data: aportes,
                borderColor: 'rgba(75, 192, 192, 1)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                fill: false,
            },
            {
                label: 'Rescates',
                data: rescates,
                borderColor: 'rgba(255, 99, 132, 1)',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                fill: false,
            },
            {
                label: 'Neto',
                data: neto,
                borderColor: 'rgba(153, 102, 255, 1)',
                backgroundColor: 'rgba(153, 102, 255, 0.2)',
                fill: false,
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            title: {
                display: true,
                text: 'Aportes y Rescates',
                color: color,
                font: {
                    size: 24,
                },
                padding: 20
            },
            legend: {
                position: 'top',
                labels: {
                    color: color,
                    padding: 20
                },
            },
        },
        scales: {
            y: {
                grid: {
                    color: gridColor,
                },
                ticks: {
                    color: color,
                    font: {
                        size: 14,
                    },
                    padding: 10,
                    callback: function(value) {
                        return formatYAxisNumber(value);
                    }
                },
            },
            x: {
                grid: {
                    color: gridColor,
                },
                ticks: {
                    color: color,
                    font: {
                        size: 14,
                    },
                    padding: 10,
                },
            },
        },
    };

    return <Line data={chartData} options={options} />;
};

const AcumuladosChart = ({ data, darkMode }) => {
    const color = darkMode ? '#333' : '#f26439';
    const gridColor = darkMode ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.3)';
    
    // Función para formatear números grandes en el eje Y (formato chileno MM)
    const formatYAxisNumber = (value) => {
        return (value / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' MM';
    };
    
    const labels = data.map(d => format(parseISO(d.fecha), 'dd/MM/yyyy'));
    const acumuladoAportes = data.map(d => d.acumulado_aportes);
    const acumuladoRescates = data.map(d => d.acumulado_rescates);
    const netoAcumulado = data.map(d => d.neto_acumulado);

    const chartData = {
        labels,
        datasets: [
            {
                label: 'Acumulado Aportes',
                data: acumuladoAportes,
                borderColor: 'rgba(54, 162, 235, 1)',
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                fill: false,
            },
            {
                label: 'Acumulado Rescates',
                data: acumuladoRescates,
                borderColor: 'rgba(255, 206, 86, 1)',
                backgroundColor: 'rgba(255, 206, 86, 0.2)',
                fill: false,
            },
            {
                label: 'Neto Acumulado',
                data: netoAcumulado,
                borderColor: 'rgba(75, 192, 192, 1)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                fill: false,
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            title: {
                display: true,
                text: 'Acumulado Aportes y Rescates',
                color: color,
                font: {
                    size: 24,
                },
                padding: 20
            },
            legend: {
                position: 'top',
                labels: {
                    color: color,
                    padding: 20
                },
            },
        },
        scales: {
            y: {
                grid: {
                    color: gridColor,
                },
                ticks: {
                    color: color,
                    font: {
                        size: 14,
                    },
                    padding: 10,
                    callback: function(value) {
                        return formatYAxisNumber(value);
                    }
                },
            },
            x: {
                grid: {
                    color: gridColor,
                },
                ticks: {
                    color: color,
                    font: {
                        size: 14,
                    },
                    padding: 10,
                },
            },
        },
    };

    return <Line data={chartData} options={options} />;
};

const AYR = ({ darkMode }) => {
    const [data, setData] = useState([]);
    const [loadingFrom, setLoadingFrom] = useState(false);
    const [loadingSpecific, setLoadingSpecific] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'fecha', direction: 'desc' });
    const [dateToUpdate, setDateToUpdate] = useState(subDays(new Date(), 1));
    const [dateToUpdateFrom, setDateToUpdateFrom] = useState(subDays(new Date(), 30)); // 30 días atrás
    const [currentPage, setCurrentPage] = useState(0);
    const [showAll, setShowAll] = useState(false);
    const [lastUpdate, setLastUpdate] = useState(null);

    // Hook para manejar feriados chilenos (preparado para uso futuro)
    useFeriadosChile();

    // Verificar si hay algún proceso en curso
    const isAnyLoading = loadingFrom || loadingSpecific;

    const fetchData = async () => {
        try {
            const response = await fetch(`${apiUrl}/fetch-data`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.json();
            if (Array.isArray(result)) {
                setData(result);
                if (result.length > 0) {
                    const lastDate = result[result.length - 1].fecha;
                    setLastUpdate(lastDate);
                }
            } else {
                console.error('Fetched data is not an array:', result);
                throw new Error('Invalid data format received from server');
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            alert('Error al cargar los datos. Por favor, intente nuevamente.');
        }
    };

    const updateDataFromDate = async (fromDate) => {
        if (loadingSpecific) {
            alert('Hay una actualización específica en proceso. Por favor espera a que termine antes de iniciar otra actualización.');
            return;
        }
        
        // Calcular número aproximado de días hábiles a procesar
        const today = subDays(new Date(), 1);
        const diffTime = Math.abs(today - fromDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const approxBusinessDays = Math.floor(diffDays * 0.7); // Aproximadamente 70% son días hábiles
        
        const confirmMessage = `⚠️ PROCESO INTENSIVO DE ACTUALIZACIÓN ⚠️

📅 Desde: ${format(fromDate, 'dd/MM/yyyy')}
📅 Hasta: ${format(today, 'dd/MM/yyyy')}
📊 Días aproximados a procesar: ${approxBusinessDays} días hábiles

🔄 Este proceso:
• Descarga datos desde AAFM.cl para cada día
• Procesa 15 fechas simultáneamente (paralelo)
• Puede tomar varios minutos dependiendo de las fechas
• Salta automáticamente feriados y fines de semana
• No se puede cancelar una vez iniciado

⏱️ Tiempo estimado: ${Math.ceil(approxBusinessDays / 15)} minutos aproximadamente

¿Estás seguro de que quieres continuar?`;
        
        if (!window.confirm(confirmMessage)) {
            return;
        }
        
        setLoadingFrom(true);
        try {
            const formattedDate = format(fromDate, 'yyyy-MM-dd');
            const response = await fetch(`${apiUrl}/updatefrom/${formattedDate}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.json();
            await fetchData();
            setLastUpdate(new Date().toISOString());
            alert(`✅ Actualización desde ${format(fromDate, 'dd/MM/yyyy')} completada: ${result.message || 'Datos actualizados exitosamente'}`);
        } catch (error) {
            console.error(`Error updating data from ${fromDate}:`, error);
            alert(`❌ Error al actualizar los datos desde ${format(fromDate, 'dd/MM/yyyy')}. Por favor, intente nuevamente.`);
        } finally {
            setLoadingFrom(false);
        }
    };

    const downloadExcel = async () => {
        try {
            const response = await fetch(`${apiUrl}/download-excel`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Aportes_y_Rescates.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (error) {
            console.error('Error downloading Excel:', error);
            alert('Error al descargar el archivo Excel. Por favor, intente nuevamente.');
        }
    };

    const sortedData = React.useMemo(() => {
        let sortableItems = [...data];
        sortableItems.sort((a, b) => {
            if (!a[sortConfig.key] || !b[sortConfig.key]) return 0;
            if (a[sortConfig.key] < b[sortConfig.key]) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (a[sortConfig.key] > b[sortConfig.key]) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
        return sortableItems;
    }, [data, sortConfig]);

    const groupedData = React.useMemo(() => {
        const groups = {};
        const yearGroups = {};
        
        // Primero agrupamos por mes
        sortedData.forEach(item => {
            if (item && item.fecha) {
                const date = addHours(parseISO(item.fecha), 12);
                const year = format(date, 'yyyy');
                const monthYear = format(date, 'yyyy-MM');
                
                if (!groups[monthYear]) {
                    groups[monthYear] = [];
                }
                groups[monthYear].push(item);

                // También agrupamos por año para verificar si está completo
                if (!yearGroups[year]) {
                    yearGroups[year] = [];
                }
                yearGroups[year].push(item);
            }
        });

        // Verificamos qué años están completos (tienen todos los meses)
        const completeYears = {};
        Object.keys(yearGroups).forEach(year => {
            const months = new Set(yearGroups[year].map(item => 
                format(addHours(parseISO(item.fecha), 12), 'MM')
            ));
            if (months.size === 12) {
                completeYears[year] = yearGroups[year];
            }
        });

        // Combinamos los grupos mensuales y anuales
        const finalGroups = {};
        
        // Agregamos los años completos
        Object.keys(completeYears).forEach(year => {
            finalGroups[year] = completeYears[year];
        });

        // Agregamos los meses de años incompletos
        Object.keys(groups).forEach(monthYear => {
            const year = monthYear.split('-')[0];
            if (!completeYears[year]) {
                finalGroups[monthYear] = groups[monthYear];
            }
        });

        // Ordenamos los grupos
        const sortedGroups = {};
        Object.keys(finalGroups)
            .sort()
            .forEach(key => {
                sortedGroups[key] = finalGroups[key];
            });

        return Object.keys(sortedGroups).map(key => ({
            key,
            data: sortedGroups[key]
        }));
    }, [sortedData]);

    const currentRows = showAll ? sortedData : (groupedData[currentPage]?.data || []);

    // Encontrar la fecha más reciente en todo el dataset
    const latestDate = React.useMemo(() => {
        if (data.length === 0) return null;
        const dates = data.map(row => new Date(row.fecha));
        return new Date(Math.max(...dates)).toISOString().split('T')[0];
    }, [data]);

    useEffect(() => {
        fetchData();
        const intervalId = setInterval(fetchData, 24 * 60 * 60 * 1000); // 24 horas
        return () => clearInterval(intervalId);
    }, []);

    // Efecto para establecer la última pestaña cuando se cargan los datos
    useEffect(() => {
        if (groupedData.length > 0) {
            setCurrentPage(groupedData.length - 1);
            setShowAll(false);
        }
    }, [groupedData]);

    const formatNumber = (value) => {
        const numberValue = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : value;
        if (!isNaN(numberValue)) {
            return numberValue.toLocaleString('de-DE', {});
        }
        return value;
    };

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const handlePageChange = (pageNumber) => {
        setCurrentPage(pageNumber);
        setShowAll(false);
    };

    const handleShowAll = () => {
        setShowAll(true);
    };

    const getButtonLabel = (group) => {
        const date = addHours(parseISO(group.data[0].fecha), 12);
        // Si la key es solo un año (ej: "2024"), mostramos solo el año
        if (/^\d{4}$/.test(group.key)) {
            return group.key;
        }
        // Si no, mostramos el mes
        return format(date, 'MMM', { locale: es }).toUpperCase();
    };

    const getDayInitial = (date) => {
        const days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
        return days[getDay(date)];
    };

    const updateSpecificDate = async (date) => {
        if (loadingFrom) {
            alert('Hay una actualización masiva en proceso. Por favor espera a que termine antes de actualizar una fecha específica.');
            return;
        }
        
        const today = new Date();
        if (date >= today) {
            alert('La fecha seleccionada debe ser anterior a hoy.');
            return;
        }
        setLoadingSpecific(true);
        try {
            const formattedDate = format(date, 'yyyy-MM-dd');
            const response = await fetch(`${apiUrl}/update/${formattedDate}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            await fetchData();
            setLastUpdate(new Date().toISOString());
            alert(`Datos para ${formattedDate} actualizados exitosamente.`);
        } catch (error) {
            console.error(`Error updating data for ${date}:`, error);
            alert(`Error al actualizar los datos para ${date}. Por favor, intente nuevamente.`);
        } finally {
            setLoadingSpecific(false);
        }
    };

    return (
        <div className="ayr-content">
            <div className="update-buttons">
                <div className="update-from-section">
                    <div className="datepicker-with-button">
                        <button
                          onClick={() => updateDataFromDate(dateToUpdateFrom)}
                          disabled={isAnyLoading || !dateToUpdateFrom}
                          className={`update-button-compact ${loadingFrom ? 'processing' : ''}`}
                          title="Actualizar desde esta fecha">
                          {loadingFrom ? "..." : "Actualizar desde"}
                        </button>
                        <DatePicker
                          id="datepicker-from"
                          selected={dateToUpdateFrom}
                          onChange={(date) => {
                            if (date < subDays(new Date(), 1)) {
                              setDateToUpdateFrom(date);
                            } else {
                              alert("Por favor elegir fecha anterior a hoy.");
                            }
                          }}
                          dateFormat="dd-MM-yyyy"
                          className="datepicker compact"
                          placeholderText="Desde fecha"
                          showMonthDropdown
                          showYearDropdown
                          dropdownMode="select"
                        />
                    </div>
                </div>
                
                <div className="update-single-section">
                    <div className="datepicker-with-button">
                        <button
                          onClick={() => updateSpecificDate(dateToUpdate)}
                          disabled={isAnyLoading || !dateToUpdate}
                          className={`update-button-compact ${loadingSpecific ? 'processing' : ''}`}
                          title="Actualizar esta fecha específica">
                          {loadingSpecific ? "..." : "Actualizar día"}
                        </button>
                        <DatePicker
                          id="datepicker-single"
                          selected={dateToUpdate}
                          onChange={(date) => {
                            if (date < subDays(new Date(), 1) && !isWeekend(date)) {
                              setDateToUpdate(date);
                            } else {
                              alert("Por favor elegir fecha anterior a hoy y que no sea fin de semana.");
                            }
                          }}
                          dateFormat="dd-MM-yyyy"
                          className="datepicker compact"
                          placeholderText="Fecha específica"
                          showMonthDropdown
                          showYearDropdown
                          dropdownMode="select"
                        />
                    </div>
                </div>
                
                <div className="last-update">
                    <FontAwesomeIcon icon={faClock} />
                    <span>Última actualización: {lastUpdate ? format(parseISO(lastUpdate), 'dd/MM/yyyy HH:mm') : 'Cargando...'}</span>
                </div>
            </div>

            <div className="table-charts-wrapper">
                <div className="pagination-container">
                    <div className="pagination">
                        <button onClick={handleShowAll} className={showAll ? "active" : ""}>
                            ALL
                        </button>
                        {groupedData.map((group, index) => (
                            <button
                                key={group.key}
                                onClick={() => handlePageChange(index)}
                                className={currentPage === index && !showAll ? "active" : ""}>
                                {getButtonLabel(group)}
                            </button>
                        ))}
                    </div>
                    <div className="action-buttons">
                        <button onClick={downloadExcel} className="download-button">
                            <FontAwesomeIcon icon={faFileExcel} size="2x" />
                        </button>
                    </div>
                </div>
                <div className="table-scroll-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Dia</th>
                                <th onClick={() => requestSort("fecha")}>Fecha</th>
                                <th onClick={() => requestSort("flujo_aportes")} className="col-monto">
                                    Flujo Aportes
                                </th>
                                <th onClick={() => requestSort("flujo_rescates")} className="col-monto">
                                    Flujo Rescates
                                </th>
                                <th onClick={() => requestSort("neto_aportes_rescates")} className="col-monto">
                                    Neto Aportes-Rescates
                                </th>
                                <th onClick={() => requestSort("acumulado_aportes")} className="col-monto">
                                    Acumulado Aportes
                                </th>
                                <th onClick={() => requestSort("acumulado_rescates")} className="col-monto">
                                    Acumulado Rescates
                                </th>
                                <th onClick={() => requestSort("neto_acumulado")} className="col-monto">
                                    Neto Acumulado
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentRows.length > 0 ? (
                                currentRows.map((row) => {
                                    const rowDate = format(addHours(parseISO(row.fecha), 12), 'yyyy-MM-dd');
                                    const isLatestDate = rowDate === latestDate;
                                    return (
                                        <tr key={row.id} className={isLatestDate ? 'last-registered' : ''}>
                                            <td>{getDayInitial(addHours(parseISO(row.fecha), 12))}</td>
                                            <td>{format(addHours(parseISO(row.fecha), 12), "dd-MM-yyyy")}</td>
                                            <td className="col-monto">{formatNumber(row.flujo_aportes)}</td>
                                            <td className="col-monto">{formatNumber(row.flujo_rescates)}</td>
                                            <td className="col-monto">{formatNumber(row.neto_aportes_rescates)}</td>
                                            <td className="col-monto">{formatNumber(row.acumulado_aportes)}</td>
                                            <td className="col-monto">{formatNumber(row.acumulado_rescates)}</td>
                                            <td className="col-monto">{formatNumber(row.neto_acumulado)}</td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan="8">No hay data disponible</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="charts-container">
                    <div><AportesRescatesNetoChart data={currentRows} darkMode={darkMode} /></div>
                    <div><AcumuladosChart data={currentRows} darkMode={darkMode} /></div>
                </div>
            </div>
        </div>
    );
};

export default AYR;