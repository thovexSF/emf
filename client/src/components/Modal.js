import React from 'react';
import '../styles/Modal.css';

const Modal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Información sobre los datos</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
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
        </div>
      </div>
    </div>
  );
};

export default Modal; 