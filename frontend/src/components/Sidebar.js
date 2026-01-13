import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApp } from '../contexts/AppContext';
import './Sidebar.css';

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { navigateTo } = useApp();

  const menuItems = [
    { id: 'cv', label: 'CV Game', path: '/cv-booth' },
    { id: 'nlp', label: 'NLP Game', path: '/nlp-booth' },
    { id: 'ml', label: 'ML Game', path: '/ml-booth' },
    { id: 'leaderboard', label: 'Leaderboard 🏆', path: '/leaderboard' },
    { id: 'home', label: 'Return to Home', path: '/' }
  ];

  const handleNavigation = (path) => {
    navigateTo(path === '/' ? 'landing' : path.split('/')[1].replace('-', ''));
    navigate(path);
  };

  return (
    <motion.div
      className="sidebar"
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div className="sidebar-header">
        <h2>=DLW=</h2>
      </div>

      <nav className="sidebar-nav">
        {menuItems.map((item) => (
          <motion.button
            key={item.id}
            className={`nav-button ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => handleNavigation(item.path)}
            whileHover={{ scale: 1.05, x: 5 }}
            whileTap={{ scale: 0.95 }}
          >
            {item.label}
          </motion.button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <p>Session Active</p>
        <div className="status-indicator"></div>
      </div>
    </motion.div>
  );
};

export default Sidebar;
