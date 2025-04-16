import React, { useEffect, useState } from 'react';
import '../styles/AYR.css';
import { format, parseISO, getDay, subDays, isWeekend, addHours } from 'date-fns';
import { es } from 'date-fns/locale';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExcel, faInfoCircle, faClock } from '@fortawesome/free-solid-svg-icons';
import { AportesRescatesNetoChart, AcumuladosChart } from './Charts';
import Navbar from './Navbar';
import Modal from './Modal';

const apiUrl = process.env.NODE_ENV === 'production' 
    ? '/api' 
    : process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

const AYR= () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'fecha', direction: 'desc' });
    const [dateToUpdate, setDateToUpdate] = useState(subDays(new Date(), 2));
    const [currentPage, setCurrentPage] = useState(0);
    const [showAll, setShowAll] = useState(false);
    const [darkMode, setdarkMode] = useState(true);
    const [lastUpdate, setLastUpdate] = useState(null);
    const [showModal, setShowModal] = useState(false);
    
    const fetchData = async () => {
        try {
            setLoading(true);
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
                    
                    const groupedData = groupData(result);
                    const currentYear = new Date().getFullYear();
                    const currentMonth = new Date().getMonth() + 1;
                    const currentMonthYear = `${currentYear}-${currentMonth.toString().padStart(2, '0')}`;
                    
                    const latestTabIndex = groupedData.findIndex(group => 
                        group.key === currentMonthYear || 
                        (currentYear === 2024 && group.key === '2024')
                    );
                    
                    if (latestTabIndex !== -1) {
                        setCurrentPage(latestTabIndex);
                    }
                }
            } else {
                console.error('Fetched data is not an array:', result);
                throw new Error('Invalid data format received from server');
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            alert('Error al cargar los datos. Por favor, intente nuevamente.');
        } finally {
            setLoading(false);
        }
    };

    const updateData = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${apiUrl}/updateall`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            await fetchData();
            alert('Datos actualizados exitosamente.');
        } catch (error) {
            console.error('Error updating data:', error);
            alert('Error al actualizar los datos. Por favor, intente nuevamente.');
        } finally {
            setLoading(false);
        }
    };

    const updateSpecificDate = async (date) => {
        const today = new Date();
        if (date >= today) {
            alert('La fecha seleccionada debe ser anterior a hoy.');
            return;
        }
        setLoading(true);
        try {
            const formattedDate = format(date, 'yyyy-MM-dd');
            const response = await fetch(`${apiUrl}/update/${formattedDate}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            await fetchData();
            alert(`Datos para ${formattedDate} actualizados exitosamente.`);
        } catch (error) {
            console.error(`Error updating data for ${date}:`, error);
            alert(`Error al actualizar los datos para ${date}. Por favor, intente nuevamente.`);
        } finally {
            setLoading(false);
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

    useEffect(() => {
        fetchData();
        const intervalId = setInterval(fetchData, 24 * 60 * 60 * 1000); // 24 horas
        return () => clearInterval(intervalId);
    }, []);

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
        sortedData.forEach(item => {
            if (item && item.fecha) {
                const date = addHours(parseISO(item.fecha), 12);
                const year = format(date, 'yyyy');
                const monthYear = format(date, 'yyyy-MM');
                
                // Para 2024, agrupar todo el año
                if (year === '2024') {
                    if (!groups['2024']) {
                        groups['2024'] = [];
                    }
                    groups['2024'].push(item);
                } 
                // Para 2025, agrupar por meses
                else if (year === '2025') {
                    if (!groups[monthYear]) {
                        groups[monthYear] = [];
                    }
                    groups[monthYear].push(item);
                }
            }
        });

        // Ordenar los grupos: 2024 primero, luego los meses de 2025 en orden
        const sortedGroups = {};
        if (groups['2024']) {
            sortedGroups['2024'] = groups['2024'];
        }
        
        Object.keys(groups)
            .filter(key => key !== '2024')
            .sort()
            .forEach(key => {
                sortedGroups[key] = groups[key];
            });

        return Object.keys(sortedGroups).map(key => ({
            key,
            data: sortedGroups[key]
        }));
    }, [sortedData]);

    const currentRows = showAll ? sortedData : (groupedData[currentPage]?.data || []);

    const handlePageChange = (pageNumber) => {
        setCurrentPage(pageNumber);
        setShowAll(false);
    };

    const handleShowAll = () => {
        setShowAll(true);
    };

    const getButtonLabel = (group) => {
        if (group.key === '2024') {
            return '2024';
        }
        const date = addHours(parseISO(group.data[0].fecha), 12);
        return format(date, 'MMM', { locale: es }).toUpperCase();
    };

    const getDayInitial = (date) => {
        const days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
        return days[getDay(date)];
    };
    
    const toggledarkMode = () => {
      setdarkMode(!darkMode);
      document.body.classList.toggle('dark-mode', darkMode);
  };

    return (
      <div className={`app-container ${darkMode ? '' : 'dark-mode'}`}>
        <Navbar />
        <div className="update-buttons">
            <button
              onClick={updateData}
              disabled={loading}
              className="update-button">
              {loading ? "Actualizando..." : "Actualizar todo"}
            </button>
            <button
              onClick={() => updateSpecificDate(dateToUpdate)}
              disabled={loading || !dateToUpdate}
              className="update-button">
              {loading ? "Actualizando..." : `Actualizar un dia`}
            </button>
            <DatePicker
              selected={dateToUpdate}
              onChange={(date) => {
                if (date < subDays(new Date(), 1) && !isWeekend(date)) {
                  setDateToUpdate(date);
                } else {
                  alert("Por favor elegir fecha anterior a hoy y que no sea fin de semana.");
                }
              }}
              dateFormat="dd-MM-YYYY"
              className="datepicker"
            />
            <div className="last-update">
                <FontAwesomeIcon icon={faClock} />
                <span>Última actualización: {lastUpdate ? format(parseISO(lastUpdate), 'dd/MM/yyyy') : 'Cargando...'}</span>
            </div>
            <button 
                onClick={() => setShowModal(true)}
                className="info-button"
            >
                <FontAwesomeIcon icon={faInfoCircle} size="2x" />
            </button>
            <div className="switch-container">
            <label className="switch">
                <input type="checkbox" checked={!darkMode} onChange={toggledarkMode} />
                <span className="slider"></span>
            </label>
            <span className="mode-label">Modo Oscuro</span>
          </div>
        </div>
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
          <button onClick={downloadExcel} className="download-button">
              <FontAwesomeIcon icon={faFileExcel} size="2x" />
          </button>
        </div>
        <div className="main-content">
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dia</th>
                  <th onClick={() => requestSort("fecha")}>Fecha</th>
                  <th onClick={() => requestSort("flujo_aportes")}>
                    Flujo Aportes
                  </th>
                  <th onClick={() => requestSort("flujo_rescates")}>
                    Flujo Rescates
                  </th>
                  <th onClick={() => requestSort("neto_aportes_rescates")}>
                    Neto Aportes-Rescates
                  </th>
                  <th onClick={() => requestSort("acumulado_aportes")}>
                    Acumulado Aportes
                  </th>
                  <th onClick={() => requestSort("acumulado_rescates")}>
                    Acumulado Rescates
                  </th>
                  <th onClick={() => requestSort("neto_acumulado")}>
                    Neto Acumulado
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentRows.length > 0 ? (
                  currentRows.map((row) => (
                    <tr key={row.id}>
                      <td>{getDayInitial(addHours(parseISO(row.fecha), 12))}</td>
                      <td>{format(addHours(parseISO(row.fecha), 12), "dd-MM-yyyy")}</td>
                      <td>{formatNumber(row.flujo_aportes)}</td>
                      <td>{formatNumber(row.flujo_rescates)}</td>
                      <td>{formatNumber(row.neto_aportes_rescates)}</td>
                      <td>{formatNumber(row.acumulado_aportes)}</td>
                      <td>{formatNumber(row.acumulado_rescates)}</td>
                      <td>{formatNumber(row.neto_acumulado)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8">No hay data disponible</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="charts-container">
          <AportesRescatesNetoChart data={currentRows} darkMode={darkMode}  />
          <div style={{ height: '50px' }}></div>
          <AcumuladosChart data={currentRows} darkMode={darkMode}  />
        </div>
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} />
      </div>
    );       
};

export default AYR;