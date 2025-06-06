import { useState, useCallback, useEffect } from 'react';

const useFeriadosChile = () => {
    const [feriados, setFeriados] = useState([]);
    const [loading, setLoading] = useState(false);

    // Función para cargar los feriados desde boostr.cl
    const cargarFeriados = useCallback(async () => {
        // Si ya tenemos feriados cargados, no hacemos nada
        if (feriados.length > 0) return;

        try {
            setLoading(true);
            console.log('Cargando feriados chilenos desde API boostr.cl...');
            const response = await fetch('https://api.boostr.cl/holidays.json');
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.status === 'success' && Array.isArray(data.data)) {
                    // Convertir las fechas al formato MM-DD
                    const feriadosFormateados = data.data.map(feriado => {
                        const fecha = new Date(feriado.date);
                        const mesDia = `${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
                        return mesDia;
                    });
                    
                    console.log(`Cargados ${feriadosFormateados.length} feriados chilenos`);
                    setFeriados(feriadosFormateados);
                } else {
                    console.error('Formato de datos inválido de la API de feriados');
                }
            } else {
                console.error('Error en la respuesta de la API de feriados:', response.status);
            }
        } catch (error) {
            console.error('Error al cargar feriados chilenos:', error);
        } finally {
            setLoading(false);
        }
    }, [feriados]);

    // Cargar feriados al montar el hook
    useEffect(() => {
        cargarFeriados();
    }, [cargarFeriados]);

    // Función para verificar si una fecha es feriado
    const esFeriado = useCallback((fecha) => {
        const dateObj = fecha instanceof Date ? fecha : new Date(fecha);
        const mesDia = `${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        return feriados.includes(mesDia);
    }, [feriados]);

    // Función para verificar si una fecha es día hábil (no fin de semana ni feriado)
    const esDiaHabil = useCallback((fecha) => {
        const dateObj = fecha instanceof Date ? fecha : new Date(fecha);
        const dayOfWeek = dateObj.getDay();
        
        // Si es fin de semana (sábado = 6, domingo = 0) o feriado, no es día hábil
        return dayOfWeek !== 0 && dayOfWeek !== 6 && !esFeriado(dateObj);
    }, [esFeriado]);

    // Función para obtener información sobre por qué una fecha no es hábil
    const getReasonNotWorkday = useCallback((fecha) => {
        const dateObj = fecha instanceof Date ? fecha : new Date(fecha);
        const dayOfWeek = dateObj.getDay();
        
        if (dayOfWeek === 0) return 'domingo';
        if (dayOfWeek === 6) return 'sábado';
        if (esFeriado(dateObj)) return 'feriado';
        
        return null; // Es día hábil
    }, [esFeriado]);

    return {
        feriados,
        loading,
        esFeriado,
        esDiaHabil,
        getReasonNotWorkday,
        cargarFeriados
    };
};

export default useFeriadosChile; 