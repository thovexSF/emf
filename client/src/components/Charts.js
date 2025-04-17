import React from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { format, parseISO } from 'date-fns';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const AportesRescatesNetoChart = ({ data, darkMode }) => {
    const color = darkMode ?  '#333':'#f26439';
    const gridColor = darkMode ? 'rgba(0, 0, 0, 0.1)':'rgba(255, 255, 255, 0.3)';
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
        plugins: {
            title: {
                display: true,
                text: 'Aportes y Rescates',
                color: color,
                font: {
                    size: 20,
                },
            },
            legend: {
                labels: {
                    color: color,
                    font: {
                        size: 14,
                    },
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
                },
            },
        },
    };

    return <Line data={chartData} options={options} />;
};

const AcumuladosChart = ({ data, darkMode }) => {
    const color = darkMode ?  '#333':'#f26439';
    const gridColor = darkMode ? 'rgba(0, 0, 0, 0.1)':'rgba(255, 255, 255, 0.3)';
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
        plugins: {
            title: {
                display: true,
                text: 'Acumulado Aportes y Rescates',
                color: color,
                font: {
                    size: 20,
                },
            },
            legend: {
                labels: {
                    color: color,
                    font: {
                        size: 14,
                    },
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
                },
            },
        },
    };

    return <Line data={chartData} options={options} />;
};

export { AportesRescatesNetoChart, AcumuladosChart };