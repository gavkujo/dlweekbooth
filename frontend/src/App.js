import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AppProvider } from './contexts/AppContext';
import LandingPage from './pages/LandingPage';
import CVBoothPage from './pages/CVBoothPage';
import NLPBoothPage from './pages/NLPBoothPage';
import MLBoothPage from './pages/MLBoothPage';
import LeaderboardPage from './pages/LeaderboardPage';
import Sidebar from './components/Sidebar';

function AppContent() {
  const location = useLocation();
  const showSidebar = location.pathname !== '/';

  return (
    <div className="app-container">
      {showSidebar && <Sidebar />}
      <div className={`main-content ${showSidebar ? 'with-sidebar' : ''}`}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/cv-booth" element={<CVBoothPage />} />
            <Route path="/nlp-booth" element={<NLPBoothPage />} />
            <Route path="/ml-booth" element={<MLBoothPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
          </Routes>
        </AnimatePresence>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </Router>
  );
}

export default App;
