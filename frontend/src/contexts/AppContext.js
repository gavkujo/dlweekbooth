import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const AppContext = createContext();

export const useApp = () => useContext(AppContext);

export const AppProvider = ({ children }) => {
  const [currentPage, setCurrentPage] = useState('landing');
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const [userId] = useState(() => `user_${Math.random().toString(36).substr(2, 9)}`);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const idleTimerRef = useRef(null);
  const navigate = useNavigate();

  const IDLE_TIMEOUT = 60000;

  const resetIdleTimer = useCallback(() => {
    setLastActivity(Date.now());
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    const timer = setTimeout(() => {
      setCurrentPage('landing');
      navigate('/');
      alert('Session expired due to inactivity');
    }, IDLE_TIMEOUT);
    idleTimerRef.current = timer;
  }, [navigate]);

  useEffect(() => {
    const activities = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    const handleActivity = () => resetIdleTimer();

    activities.forEach(event => {
      window.addEventListener(event, handleActivity);
    });

    resetIdleTimer();

    return () => {
      activities.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [resetIdleTimer]);

  const navigateTo = (page) => {
    setCurrentPage(page);
    resetIdleTimer();
  };

  const value = {
    currentPage,
    sessionId,
    userId,
    navigateTo,
    resetIdleTimer
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
