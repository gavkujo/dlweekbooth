import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '../contexts/AppContext';
import './LeaderboardPage.css';

const BOOTHS = [
  { id: 'cv', label: 'CV Booth' },
  { id: 'nlp', label: 'NLP Booth' },
  { id: 'ml', label: 'ML Booth' }
];

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL ?? '').replace(/\/$/, '');

const MAX_ROWS = 20;

const LeaderboardPage = () => {
  const { resetIdleTimer } = useApp();
  const [activeBooth, setActiveBooth] = useState('cv');
  const [entriesByBooth, setEntriesByBooth] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchLeaderboard = async (boothId) => {
    resetIdleTimer();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/leaderboard/${boothId}?limit=${MAX_ROWS}`);
      if (!response.ok) {
        throw new Error(`Failed to load leaderboard: ${response.status}`);
      }
      const payload = await response.json();
      setEntriesByBooth(prev => ({ ...prev, [boothId]: payload }));
    } catch (err) {
      console.error('Failed to fetch leaderboard', err);
      setError('Unable to load leaderboard right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!entriesByBooth[activeBooth]) {
      fetchLeaderboard(activeBooth);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBooth]);

  const entries = useMemo(() => entriesByBooth[activeBooth] ?? [], [entriesByBooth, activeBooth]);

  return (
    <div className="leaderboard-page">
      <motion.header
        className="leaderboard-header"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1>Leaderboard</h1>
        <p>Track the top scores for each booth. Only the best {MAX_ROWS} entries per booth are shown.</p>
      </motion.header>

      <div className="leaderboard-nav">
        {BOOTHS.map(booth => (
          <button
            key={booth.id}
            type="button"
            className={booth.id === activeBooth ? 'active' : ''}
            onClick={() => setActiveBooth(booth.id)}
          >
            {booth.label}
          </button>
        ))}
      </div>

      <div className="leaderboard-content">
        {loading && <div className="leaderboard-status">Loading...</div>}
        {!loading && error && (
          <div className="leaderboard-status error">
            {error}
            <button type="button" onClick={() => fetchLeaderboard(activeBooth)}>Retry</button>
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="leaderboard-status">No scores recorded for this booth yet.</div>
        )}
        {!loading && !error && entries.length > 0 && (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Score</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.id ?? `${entry.userId}-${entry.timestamp ?? index}`}>
                  <td>{index + 1}</td>
                  <td>{entry.playerName || entry.meta?.playerName || 'Anonymous'}</td>
                  <td>{entry.score}</td>
                  <td>{new Date(entry.timestamp || Date.now()).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default LeaderboardPage;
