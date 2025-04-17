import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';

const NavTabs = ({ activeTab, onTabChange, onInfoClick }) => {
    const tabs = [
        { id: 'ayr', name: 'Aportes y Rescates' },
        { id: 'other', name: 'Otra App' }
    ];

    return (
        <div className="nav-tabs">
            {tabs.map(tab => (
                <div 
                    key={tab.id}
                    className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => onTabChange(tab.id)}
                >
                    <span>{tab.name}</span>
                    <button 
                        className="info-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onInfoClick(tab.id);
                        }}
                    >
                        <FontAwesomeIcon icon={faInfoCircle} />
                    </button>
                </div>
            ))}
        </div>
    );
};

export default NavTabs; 