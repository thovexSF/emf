import React, { useState } from 'react';
import './styles/App.css';
import AYR, { AYRModalContent } from './components/AportesYRescates';
import DragDropCSV, { DragDropCSVModalContent } from './components/OperacionesAFinix';
import Modal from './components/Modal';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";

const App = () => {
    const [activeTab, setActiveTab] = useState('ayr');
    const [darkMode, setDarkMode] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [modalContent, setModalContent] = useState({ title: '', content: null });

    const handleTabChange = (tabId) => {
        setActiveTab(tabId);
    };

    const toggleDarkMode = () => {
        setDarkMode(!darkMode);
        document.body.classList.toggle('dark-mode', darkMode);
    };

    const handleInfoClick = (tabId) => {
        if (tabId === 'ayr') {
            setModalContent(AYRModalContent);
        } else if (tabId === 'transformar') {
            setModalContent(DragDropCSVModalContent);
        }
        setShowModal(true);
    };

    return (
        <div className={`app-container ${darkMode ? '' : 'dark-mode'}`}>
            <div className="header">
                <div className="logo-container">
                    <img src="./logo.png" alt="EMF Logo" className="logo-img" />
                </div>
                <div className="navbar">
                    <button 
                        className={`nav-tab ${activeTab === 'ayr' ? 'active' : ''}`}
                        onClick={() => handleTabChange('ayr')}
                    >
                        Aportes y Rescates
                        <button 
                            className="info-button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleInfoClick('ayr');
                            }}
                            title="Información"
                        >
                            <FontAwesomeIcon icon={faInfoCircle} />
                        </button>
                    </button>
                    <button 
                        className={`nav-tab ${activeTab === 'transformar' ? 'active' : ''}`}
                        onClick={() => handleTabChange('transformar')}
                    >
                        Transformar CSV
                        <button 
                            className="info-button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleInfoClick('transformar');
                            }}
                            title="Información"
                        >
                            <FontAwesomeIcon icon={faInfoCircle} />
                        </button>
                    </button>
                    <div className="dark-mode-switch">
                        <span className="mode-label">Modo Oscuro</span>
                        <label>
                            <input
                                type="checkbox"
                                checked={darkMode}
                                onChange={toggleDarkMode}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>
            </div>
            
            <div className="content-container">
                {activeTab === 'ayr' && <AYR darkMode={darkMode} />}
                {activeTab === 'transformar' && <DragDropCSV darkMode={darkMode} />}
            </div>

            <Modal 
                isOpen={showModal} 
                onClose={() => setShowModal(false)}
                title={modalContent.title}
                content={modalContent.content}
            />
        </div>
    );
};

export default App; 