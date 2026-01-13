import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Confetti from 'react-confetti';
import { useApp } from '../contexts/AppContext';
import './NLPBoothPage.css';

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL ?? '').replace(/\/$/, '');
const TOTAL_ROUNDS = 5;
const ROUND_TIME_SECONDS = 60;
const BASE_SCORE = 100;

const platformThemes = {
  imessage: {
    name: 'iMessage',
    bg: '#dfdfdfff',
    bubbleUser: '#34B7F1',
    bubbleOther: '#bebebeff',
    textColor: '#000000',
    headerBg: '#4baaf3ff'
  },
  whatsapp: {
    name: 'WhatsApp',
    bg: '#ECE5DD',
    bubbleUser: '#DCF8C6',
    bubbleOther: '#FFFFFF',
    textColor: '#000000',
    headerBg: '#128C7E'
  },
  instagram: {
    name: 'Instagram',
    bg: 'linear-gradient(45deg, #833AB4, #FD1D1D, #FCAF45)',
    bubbleUser: '#ff7ebaff',
    bubbleOther: '#9e9e9eff',
    textColor: '#000000ff',
    headerBg: '#000000'
  },
  discord: {
    name: 'Discord',
    bg: '#36393F',
    bubbleUser: '#5865F2',
    bubbleOther: '#2F3136',
    textColor: '#FFFFFF',
    headerBg: '#202225'
  }
};

const NLPBoothPage = () => {
  const navigate = useNavigate();
  const { navigateTo, userId, resetIdleTimer } = useApp();
  const [prompts, setPrompts] = useState([]);
  const [promptsLoading, setPromptsLoading] = useState(true);
  const [promptsError, setPromptsError] = useState(null);
  const [currentPrompt, setCurrentPrompt] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [gameState, setGameState] = useState('loading');
  const [score, setScore] = useState(0);
  const [currentTheme, setCurrentTheme] = useState('imessage');
  const [timer, setTimer] = useState(ROUND_TIME_SECONDS);
  const [roundIndex, setRoundIndex] = useState(1);
  const [sessionResults, setSessionResults] = useState([]);
  const sessionResultsRef = useRef([]);
  const [roundHistory, setRoundHistory] = useState([]);
  const [roundSummary, setRoundSummary] = useState(null);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState(null);
  const messageRefs = useRef([]);
  const recentPromptIdsRef = useRef([]);
  const hasSessionStartedRef = useRef(false);
  const answeredRef = useRef(false);
  const fetchPrompts = useCallback(async () => {
    setPromptsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/nlp-prompts`);
      if (!response.ok) {
        throw new Error(`Failed to load prompts: ${response.status}`);
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        setPrompts(data);
        setPromptsError(null);
      } else {
        console.warn('Prompt payload was not an array');
        setPrompts([]);
        setPromptsError('Received invalid prompt data.');
        setCurrentPrompt(null);
      }
    } catch (err) {
      console.error('Failed to fetch NLP prompts', err);
      setPrompts([]);
      setPromptsError('Unable to load prompts from server.');
      setCurrentPrompt(null);
    } finally {
      setPromptsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const loadRandomPrompt = useCallback((nextRoundIndex = 1) => {
    if (!prompts.length) {
      setCurrentPrompt(null);
      return;
    }

    const recent = recentPromptIdsRef.current;
    const available = prompts.filter(prompt => {
      const identifier = prompt?.id ?? prompt?.topic;
      return identifier && !recent.includes(identifier);
    });

    const pool = available.length ? available : prompts;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    if (!picked) {
      setCurrentPrompt(null);
      return;
    }

    const prompt = JSON.parse(JSON.stringify(picked));
    const identifier = prompt?.id ?? prompt?.topic;
    if (identifier) {
      recentPromptIdsRef.current = [identifier, ...recent.filter(id => id !== identifier)].slice(0, 5);
    }

    const replies = [...prompt.replies];
    if (Math.random() > 0.5) {
      replies.reverse();
    }
    prompt.replies = replies;

    messageRefs.current = [];
    setCurrentPrompt(prompt);
    setSelectedCard(null);
    setRoundSummary(null);
    setRoundIndex(nextRoundIndex);
    setGameState('playing');
    setTimer(ROUND_TIME_SECONDS);
    answeredRef.current = false;
    setSessionComplete(false);

    const themeKeys = Object.keys(platformThemes);
    setCurrentTheme(themeKeys[Math.floor(Math.random() * themeKeys.length)]);
  }, [prompts]);

  const completeRound = useCallback((didWin, { timedOut = false, selectedId = null, timeTaken = ROUND_TIME_SECONDS } = {}) => {
    if (answeredRef.current) {
      return;
    }

    answeredRef.current = true;
    if (timedOut) {
      setTimer(0);
    }
    if (selectedId !== null) {
      setSelectedCard(selectedId);
    }

    const roundNumber = sessionResultsRef.current.length + 1;
    const aiReply = currentPrompt?.replies?.find(reply => reply.isAI);
    const secondsSpent = Math.max(1, timeTaken);
    const scoreAwarded = didWin ? Math.max(1, Math.round(BASE_SCORE / secondsSpent)) : 0;
    const summary = {
      round: roundNumber,
      didWin,
      timedOut,
      selectedId,
      correctId: aiReply?.id ?? null,
      topic: currentPrompt?.topic ?? '',
      promptId: currentPrompt?.id ?? null,
      timeTaken: secondsSpent,
      scoreAwarded
    };

    setRoundSummary(summary);
    setRoundHistory(prev => [...prev, summary]);
    setSessionResults(prev => {
      const updated = [...prev, didWin];
      sessionResultsRef.current = updated;
      return updated;
    });

    if (didWin) {
      setScore(prev => prev + scoreAwarded);
    }

    setGameState('revealed');
    resetIdleTimer();
  }, [currentPrompt, resetIdleTimer]);

  const openSessionSummary = useCallback(() => {
    setRoundSummary(null);
    setSessionComplete(true);
    setGameState('summary');
    resetIdleTimer();
  }, [resetIdleTimer]);

  const nextRound = useCallback(() => {
    resetIdleTimer();
    const completed = sessionResultsRef.current.length;
    if (completed >= TOTAL_ROUNDS) {
      openSessionSummary();
      return;
    }

    loadRandomPrompt(Math.min(completed + 1, TOTAL_ROUNDS));
  }, [loadRandomPrompt, openSessionSummary, resetIdleTimer]);

  const startNewSession = useCallback(() => {
    resetIdleTimer();
    sessionResultsRef.current = [];
    answeredRef.current = false;
    setSessionResults([]);
    setRoundHistory([]);
    setRoundSummary(null);
    setScore(0);
    setRoundIndex(1);
    setSessionComplete(false);
    setPlayerName('');
    setSubmissionError(null);
    setIsSubmitting(false);
    setSelectedCard(null);
    setTimer(ROUND_TIME_SECONDS);
    loadRandomPrompt(1);
  }, [loadRandomPrompt, resetIdleTimer]);

  const submitScore = useCallback(async () => {
    const trimmedName = playerName.trim();
    if (trimmedName.length < 2) {
      setSubmissionError('Please enter at least 2 characters to record your score.');
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);
    resetIdleTimer();

    try {
      const response = await fetch(`${API_BASE_URL}/api/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booth: 'nlp',
          score,
          userId,
          playerName: trimmedName,
          meta: {
            rounds: TOTAL_ROUNDS,
            results: sessionResultsRef.current,
            history: roundHistory
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to submit score: ${response.status}`);
      }

      await response.json();
      startNewSession();
    } catch (err) {
      console.error('Failed to submit NLP booth score', err);
      setSubmissionError('Unable to submit score right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [playerName, resetIdleTimer, roundHistory, score, startNewSession, userId]);

  useEffect(() => {
    if (promptsLoading || promptsError || !prompts.length) {
      return undefined;
    }

    if (!hasSessionStartedRef.current) {
      hasSessionStartedRef.current = true;
      startNewSession();
    }

    return undefined;
  }, [prompts.length, promptsLoading, promptsError, startNewSession]);

  const setMessageRef = useCallback((el, index) => {
    messageRefs.current[index] = el;
  }, []);

  const scrollMessages = useCallback(() => {
    requestAnimationFrame(() => {
      messageRefs.current.forEach(ref => {
        if (ref) {
          const maxScroll = ref.scrollHeight - ref.clientHeight;
          if (maxScroll > 0) {
            ref.scrollTop = Math.random() * maxScroll;
          }
        }
      });
    });
  }, []);

  useEffect(() => {
    if (currentPrompt) {
      scrollMessages();
    }
  }, [currentPrompt, currentTheme, scrollMessages]);

  useEffect(() => {
    if (gameState !== 'playing') {
      return undefined;
    }

    const timerInterval = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          completeRound(false, { timedOut: true, timeTaken: ROUND_TIME_SECONDS });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerInterval);
  }, [completeRound, gameState]);

  const handleCardSelect = (cardId) => {
    if (gameState !== 'playing' || answeredRef.current) return;

    const selectedReply = currentPrompt?.replies?.find(r => r.id === cardId);
    const isCorrect = !!(selectedReply && selectedReply.isAI === true);
    const timeTaken = Math.max(1, ROUND_TIME_SECONDS - timer);
    completeRound(isCorrect, { selectedId: cardId, timeTaken });
  };

  const returnHome = useCallback(() => {
    resetIdleTimer();
    setSessionComplete(false);
    setRoundSummary(null);
    setGameState('loading');
    navigateTo('landing');
    navigate('/');
  }, [navigate, navigateTo, resetIdleTimer]);

  const theme = platformThemes[currentTheme];

  if (promptsLoading) {
    return (
      <div className="nlp-booth">
        <div className="cards-container">Loading conversations...</div>
      </div>
    );
  }

  if (promptsError) {
    return (
      <div className="nlp-booth">
        <div className="cards-container">
          <div>
            <p>{promptsError}</p>
            <button className="btn-next" onClick={fetchPrompts} type="button">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!prompts.length) {
    return (
      <div className="nlp-booth">
        <div className="cards-container">No prompts available.</div>
      </div>
    );
  }

  if (!currentPrompt) return <div>Loading...</div>;

  const roundsCompleted = sessionResults.length;
  const wins = sessionResults.filter(Boolean).length;
  const perfectSession = roundsCompleted === TOTAL_ROUNDS && sessionResults.every(Boolean);
  const trimmedPlayerName = playerName.trim();
  const canSubmitScore = trimmedPlayerName.length >= 2;
  const nextActionIsSummary = roundsCompleted >= TOTAL_ROUNDS;
  const nextActionLabel = nextActionIsSummary ? 'View Summary' : 'Next Challenge';
  const aiExplanation = currentPrompt.replies.find(r => r.isAI)?.explanation;

  return (
    <div className="nlp-booth">
      {sessionComplete && perfectSession && <Confetti />}

      <div className="nlp-header">
        <div className="nlp-header-left">
          <h1>Human or AI? 🧠</h1>
          <span className="round-chip">Round {Math.min(roundIndex, TOTAL_ROUNDS)} / {TOTAL_ROUNDS}</span>
        </div>
        <div className="game-stats">
          <div className="stat">
            <span className="stat-label">Correct</span>
            <span className="stat-value">{wins}/{TOTAL_ROUNDS}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Score</span>
            <span className="stat-value">{score}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Time</span>
            <span className="stat-value">{timer}s</span>
          </div>
        </div>
      </div>

      <div className="platform-indicator" style={{ background: theme.headerBg }}>
        <span>{theme.name}</span>
      </div>

      <div className="cards-container">
        {currentPrompt.replies.map((reply, index) => (
          <motion.div
            key={reply.id}
            className={`reply-card ${selectedCard === reply.id ? 'selected' : ''} ${
              gameState === 'revealed' && reply.isAI ? 'ai-reveal' : ''
            }`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            whileHover={gameState === 'playing' ? { scale: 1.02 } : {}}
            onClick={() => handleCardSelect(reply.id)}
          >
            <div className="card-header">
              <span className="card-label">{index === 0 ? 'Reply A' : 'Reply B'}</span>
            </div>

            <div
              className="message-container"
              style={{ background: theme.bg }}
              ref={el => setMessageRef(el, index)}
            >
              <div
                className="message-bubble other"
                style={{
                  background: theme.bubbleOther,
                  color: theme.textColor,
                  alignSelf: 'flex-start'
                }}
              >
                {currentPrompt.originalMessage}
              </div>
              {reply.text.map((msg, msgIndex) => (
                <div
                  key={msgIndex}
                  className="message-bubble user"
                  style={{
                    background: theme.bubbleUser,
                    color: theme.textColor
                  }}
                >
                  {msg}
                </div>
              ))}
            </div>

            <button
              className="btn-select"
              disabled={gameState !== 'playing'}
            >
              This is AI
            </button>
          </motion.div>
        ))}
      </div>

      {gameState === 'revealed' && roundSummary && (
        <motion.div
          className="reveal-panel"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h3>
            {roundSummary.didWin ? 'Correct! 🎯' : roundSummary.timedOut ? "Time's Up! ⏰" : 'Not Quite! ❌'}
          </h3>
          <p className="explanation">
            {roundSummary.timedOut
              ? 'Time ran out before you selected a reply. Here is what gave the AI away:'
              : roundSummary.didWin
                ? 'Great read! Here is why that reply was AI-generated:'
                : 'Here is why the other reply was the AI response:'}
          </p>
          {aiExplanation && <p className="explanation detail">{aiExplanation}</p>}
          <p className="topic">Topic: {currentPrompt.topic}</p>

          <div className="reveal-actions">
            <button className="btn-next" onClick={nextRound}>
              {nextActionLabel}
            </button>
            <button className="btn-home-secondary" onClick={returnHome}>
              Return Home
            </button>
          </div>
        </motion.div>
      )}

      {sessionComplete && gameState === 'summary' && (
        <motion.div
          className="gameover-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="gameover-content">
            <h2>{perfectSession ? 'Mindreader Status Achieved! 🎉' : 'Session Complete'}</h2>
            <p className="final-score">Score: {score}</p>
            <p className="accuracy">Correct Replies: {wins} / {TOTAL_ROUNDS}</p>

            <div className="name-form">
              <label htmlFor="nlp-player-name">Enter your name to record this score:</label>
              <input
                id="nlp-player-name"
                type="text"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Your name"
                disabled={isSubmitting}
              />
              {submissionError && <span className="form-error">{submissionError}</span>}
            </div>

            <div className="gameover-actions">
              <button
                className="btn-play-again"
                onClick={submitScore}
                disabled={isSubmitting || !canSubmitScore}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Score'}
              </button>
              <button
                className="btn-home"
                onClick={startNewSession}
                disabled={isSubmitting}
              >
                Play Again
              </button>
              <button
                className="btn-home"
                onClick={returnHome}
                disabled={isSubmitting}
              >
                Return Home
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default NLPBoothPage;
