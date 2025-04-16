import React, { useState } from 'react';
import '../styles/Navbar.css';
import Modal from './Modal';

const Navbar = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <nav className="navbar">
        <div className="navbar-container">
          <div className="navbar-logo">
            <img src="/logo.png" alt="EMF Logo" className="logo-img" />
          </div>
          <div className="navbar-title" onClick={() => setIsModalOpen(true)} style={{ cursor: 'pointer' }}>
            <h1>
              APPS  | FFMM Aportes y Rescates</h1>
          </div>
        </div>
      </nav>
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
};

export default Navbar; 