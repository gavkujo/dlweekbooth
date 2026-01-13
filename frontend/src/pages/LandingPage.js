import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import './LandingPage.css';

const LandingPage = () => {
  const navigate = useNavigate();

  const booths = [
    {
      id: 'cv',
      title: 'CV Game 🎥',
      subtitle: 'Pose Challenge',
      description: 'Match the target pose using your webcam',
      gradient: 'linear-gradient(135deg, #ff4e50 0%, #f9d423 100%)',
      path: '/cv-booth'
    },
    {
      id: 'nlp',
      title: 'NLP Game 🧠',
      subtitle: 'Human or AI?',
      description: 'Identify which message was written by AI',
      gradient: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)',
      path: '/nlp-booth'
    },
    {
      id: 'ml',
      title: 'ML Game 🤖',
      subtitle: 'Guess the Model',
      description: 'Identify the machine learning model from visualization',
      gradient: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)',
      path: '/ml-booth'
    }
  ];

  return (
    <div className="landing-page">
      <motion.div
        className="landing-content"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className="landing-title">Deep Learning Week</h1>
        <p className="landing-subtitle">3 challenges</p>

        <div className="booth-grid">
          {booths.map((booth, index) => (
            <motion.div
              key={booth.id}
              className="booth-card"
              style={{ background: booth.gradient }}
              whileHover={{ scale: 1.05, rotateY: 10 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate(booth.path)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <div className="booth-card-content">
                <h2>{booth.title}</h2>
                <h3>{booth.subtitle}</h3>
                <p>{booth.description}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          className="instructions"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <p>1. Each round has a 60-second timer</p>
          <p>2. Each Game has 5 rounds</p>
          <p>3. Top 20 scores are displayed on the leaderboard</p>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default LandingPage;
