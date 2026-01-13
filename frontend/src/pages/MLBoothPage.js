import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Confetti from 'react-confetti';
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { Scatter } from 'react-chartjs-2';
import mermaid from 'mermaid';
import { useApp } from '../contexts/AppContext';
import './MLBoothPage.css';

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL ?? '').replace(/\/$/, '');
const TOTAL_ROUNDS = 5;
const ROUND_TIME_SECONDS = 60;
const BASE_SCORE = 100;
ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);

const createSeededRng = (seedText) => {
  let seed = 1779033703;
  for (let i = 0; i < seedText.length; i += 1) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 3432918353);
    seed = (seed << 13) | (seed >>> 19);
  }
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const sampleNormal = (rng, mean = 0, std = 1) => {
  let u1 = rng();
  let u2 = rng();
  if (u1 <= Number.EPSILON) {
    u1 = Number.EPSILON;
  }
  const magnitude = Math.sqrt(-2 * Math.log(u1));
  const angle = 2 * Math.PI * u2;
  const z0 = magnitude * Math.cos(angle);
  return mean + z0 * std;
};

const MLBoothPage = () => {
  const navigate = useNavigate();
  const { navigateTo, userId, resetIdleTimer } = useApp();
  const [scenarios, setScenarios] = useState([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [scenariosError, setScenariosError] = useState(null);
  const [currentScenario, setCurrentScenario] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [gameState, setGameState] = useState('loading');
  const [score, setScore] = useState(0);
  const [timer, setTimer] = useState(ROUND_TIME_SECONDS);
  const [chartData, setChartData] = useState(null);
  const [animationStep, setAnimationStep] = useState(0);
  const [roundIndex, setRoundIndex] = useState(1);
  const [sessionResults, setSessionResults] = useState([]);
  const sessionResultsRef = useRef([]);
  const [playerName, setPlayerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState(null);
  const animationRef = useRef(null);
  const answeredRef = useRef(false);
  const [timedOutRound, setTimedOutRound] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const recentScenarioIdsRef = useRef([]);
  const mermaidContainerRef = useRef(null);
  const mermaidRenderIndexRef = useRef(0);
  const fetchScenarios = useCallback(async () => {
    resetIdleTimer();
    setScenariosLoading(true);
    setGameState('loading');
    try {
      const response = await fetch(`${API_BASE_URL}/api/ml-scenarios`);
      if (!response.ok) {
        throw new Error(`Failed to load scenarios: ${response.status}`);
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        setScenarios(data);
        setScenariosError(null);
      } else {
        console.warn('Scenario payload was not an array');
        setScenarios([]);
        setScenariosError('Received invalid scenario data.');
        setCurrentScenario(null);
      }
    } catch (err) {
      console.error('Failed to fetch ML scenarios', err);
      setScenarios([]);
      setScenariosError('Unable to load ML scenarios from server.');
      setCurrentScenario(null);
    } finally {
      setScenariosLoading(false);
    }
  }, [resetIdleTimer]);
  const openSessionSummary = useCallback(() => {
    setSessionComplete(true);
    setGameState('summary');
  }, []);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'dark',
      flowchart: { useMaxWidth: true, htmlLabels: true }
    });
  }, []);

  const completeRound = useCallback((didWin, { selectedOption = null, timedOut = false, timeTaken = ROUND_TIME_SECONDS } = {}) => {
    if (answeredRef.current) {
      return;
    }

    answeredRef.current = true;
    setSelectedAnswer(selectedOption);
    setTimedOutRound(timedOut);
    setSessionResults(prev => {
      const updated = [...prev, didWin];
      sessionResultsRef.current = updated;
      return updated;
    });

    if (didWin) {
      const secondsSpent = Math.max(1, timeTaken);
      const awarded = Math.max(1, Math.round(BASE_SCORE / secondsSpent));
      setScore(prev => prev + awarded);
    }

    setGameState('revealed');
  }, []);

  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  useEffect(() => {
    if (!currentScenario || currentScenario.visualType !== 'mermaid') {
      if (mermaidContainerRef.current) {
        mermaidContainerRef.current.innerHTML = '';
      }
      return;
    }

    const diagramSource = typeof currentScenario.visualContent === 'string'
      ? currentScenario.visualContent.trim()
      : '';

    if (!diagramSource) {
      if (mermaidContainerRef.current) {
        mermaidContainerRef.current.innerHTML = '<pre>No diagram provided.</pre>';
      }
      return undefined;
    }

    let cancelled = false;

    const normaliseDiagram = (raw) => raw
      .replace(/\r\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\t/g, '    ')
      .replace(/\\t/g, '    ');

    const escapeHtml = (raw) => raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const resolvedDiagram = normaliseDiagram(diagramSource);

    const renderDiagram = async () => {
      try {
        mermaidRenderIndexRef.current += 1;
        const renderId = `mermaid-${mermaidRenderIndexRef.current}-${Date.now()}`;
        await mermaid.parse(resolvedDiagram);
        const { svg } = await mermaid.render(renderId, resolvedDiagram);
        if (!cancelled && mermaidContainerRef.current) {
          mermaidContainerRef.current.innerHTML = svg;
          const svgElement = mermaidContainerRef.current.querySelector('svg');
          if (svgElement) {
            svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            svgElement.style.width = '100%';
            svgElement.style.height = 'auto';
            svgElement.style.maxHeight = '100%';
            svgElement.style.transform = 'scale(0.85)';
            svgElement.style.transformOrigin = 'top center';
          }
        }
      } catch (error) {
        console.error('Failed to render mermaid diagram', error);
        if (!cancelled && mermaidContainerRef.current) {
          mermaidContainerRef.current.innerHTML = `<pre>Mermaid diagram failed to render.\n\n${escapeHtml(resolvedDiagram)}</pre>`;
        }
      }
    };

    if (mermaidContainerRef.current) {
      mermaidContainerRef.current.innerHTML = '<span class="mermaid-loading">Rendering diagram...</span>';
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [currentScenario, roundIndex]);

  const generateChartData = useCallback((scenario) => {
    if (!scenario) return null;

    const params = scenario.dataParams;
    const datasets = [];
    const palette = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#ffd166', '#9b5de5'];
    const seedLabel = scenario.id || scenario.model || 'ml-scenario';
    const rng = createSeededRng(seedLabel);

    const nextAngle = (index, total, offset = 0) => (2 * Math.PI * index) / total + offset;
    const makeVerticalLine = (xPosition, minY = -5, maxY = 5) => ([
      { x: xPosition, y: minY },
      { x: xPosition, y: maxY }
    ]);
    const makeLinearLine = (slope = 0, intercept = 0, startX = -5, endX = 5) => ([
      { x: startX, y: slope * startX + intercept },
      { x: endX, y: slope * endX + intercept }
    ]);

    switch (params.type) {
      case 'gaussian_blobs': {
        const gaussianCenters = params.centers ?? (params.means?.length ?? 2);
        const totalGaussianPoints = params.n ?? 200;
        const baseStd = params.std ?? 0.6;
        const countPerCluster = Math.max(10, Math.floor(totalGaussianPoints / Math.max(1, gaussianCenters)));

        for (let i = 0; i < gaussianCenters; i += 1) {
          const defaultMean = [
            Math.cos(nextAngle(i, gaussianCenters)) * 2.2,
            Math.sin(nextAngle(i, gaussianCenters)) * 1.6
          ];
          const mean = params.means?.[i] ?? defaultMean;
          const rotation = params.rotations?.[i] ?? nextAngle(i, gaussianCenters, Math.PI / 8);
          const cosA = Math.cos(rotation);
          const sinA = Math.sin(rotation);
          const major = baseStd * 1.1;
          const minor = baseStd * 0.7;

          const points = Array.from({ length: countPerCluster }, () => {
            const gx = sampleNormal(rng, 0, major);
            const gy = sampleNormal(rng, 0, minor);

            return {
              x: mean[0] + gx * cosA - gy * sinA,
              y: mean[1] + gx * sinA + gy * cosA
            };
          });

          datasets.push({
            label: `Class ${i + 1}`,
            data: points,
            backgroundColor: palette[i % palette.length],
            borderColor: 'rgba(15,23,42,0.35)',
            pointRadius: 5
          });
        }

        if (gaussianCenters >= 2) {
          const firstMean = params.means?.[0] ?? [-1.5, 0];
          const secondMean = params.means?.[1] ?? [1.5, 0];
          const boundaryX = params.boundaryX ?? (firstMean[0] + secondMean[0]) / 2;

          datasets.push({
            label: 'Decision Boundary',
            data: makeVerticalLine(boundaryX),
            backgroundColor: '#000000',
            pointRadius: 0,
            showLine: true,
            borderColor: '#ffffff',
            borderWidth: 2
          });
        }

        break;
      }

      case 'clusters': {
        const k = params.centers ?? 3;
        const totalPoints = params.n ?? 210;
        const baseStd = params.std ?? 0.6;
        const perCluster = Math.floor(totalPoints / k);

        for (let i = 0; i < k; i++) {
          const center = params.fixedCenters?.[i] ?? [
            Math.cos(nextAngle(i, k)) * 2.5,
            Math.sin(nextAngle(i, k)) * 1.8
          ];

          const stdX = baseStd * (0.7 + rng() * 0.6);
          const stdY = baseStd * (0.7 + rng() * 0.6);

          const points = Array.from({ length: perCluster }, () => ({
            x: center[0] + sampleNormal(rng, 0, stdX),
            y: center[1] + sampleNormal(rng, 0, stdY)
          }));

          datasets.push({
            label: `Cluster ${i + 1}`,
            data: points,
            backgroundColor: palette[i % palette.length],
            borderColor: 'rgba(15,23,42,0.35)',
            pointRadius: 5
          });
        }

        // small background noise (real data always has this)
        const noiseCount = Math.floor(totalPoints * 0.05);
        const noise = Array.from({ length: noiseCount }, () => ({
          x: -4 + rng() * 8,
          y: -4 + rng() * 8
        }));

        datasets.push({
          label: 'Noise',
          data: noise,
          backgroundColor: 'rgba(148,163,184,0.35)',
          pointRadius: 4
        });

        break;
      }


      case 'rectangle_regions': {
        const { thresholds = [0, 0], n = 240 } = params;
        const [xSplit, ySplit] = thresholds;

        const regionA = [];
        const regionB = [];

        for (let i = 0; i < n; i++) {
          const x = -4 + rng() * 8;
          const y = -4 + rng() * 8;

          let isA = x < xSplit && y > ySplit;

          // label noise near split lines
          if (Math.abs(x - xSplit) < 0.4 || Math.abs(y - ySplit) < 0.4) {
            if (rng() < 0.15) isA = !isA;
          }

          (isA ? regionA : regionB).push({ x, y });
        }

        datasets.push({
          label: 'Region A',
          data: regionA,
          backgroundColor: '#ff6b6b',
          pointRadius: 6
        });

        datasets.push({
          label: 'Region B',
          data: regionB,
          backgroundColor: '#4ecdc4',
          pointRadius: 6
        });

        datasets.push({
          label: 'Vertical Split',
          data: makeVerticalLine(xSplit),
          borderColor: '#ffffff',
          borderWidth: 2,
          showLine: true,
          pointRadius: 0,
          borderDash: [6, 6]
        });

        datasets.push({
          label: 'Horizontal Split',
          data: makeLinearLine(0, ySplit),
          borderColor: '#ffffff',
          borderWidth: 2,
          showLine: true,
          pointRadius: 0,
          borderDash: [6, 6]
        });

        break;
      }
      case 'svm_margin': {
        const { n = 180, margin = 0.25, slope = 0.6 } = params;
        const perClass = Math.floor(n / 2);

        const sampleClass = (side) =>
          Array.from({ length: perClass }, () => {
            const x = -3 + rng() * 6;
            const noise = sampleNormal(rng, 0, 0.35);
            return {
              x,
              y: slope * x + side * margin + noise
            };
          });

        const positive = sampleClass(+1);
        const negative = sampleClass(-1);

        // derive support vectors instead of fabricating them
        const supportVectors = [...positive, ...negative].filter(
          p => Math.abs(p.y - slope * p.x) < margin * 0.6
        );

        const makeLine = (offset) =>
          Array.from({ length: 140 }, (_, i) => {
            const x = -3.2 + (6.4 * i) / 139;
            return { x, y: slope * x + offset };
          });

        datasets.push({
          label: 'Class +1',
          data: positive,
          backgroundColor: '#ff6b6b',
          pointRadius: 6
        });

        datasets.push({
          label: 'Class -1',
          data: negative,
          backgroundColor: '#4ecdc4',
          pointRadius: 6
        });

        datasets.push({
          label: 'Support Vectors',
          data: supportVectors,
          backgroundColor: '#ffd200',
          pointRadius: 7,
          borderColor: '#ffffff',
          borderWidth: 2
        });

        datasets.push({
          label: 'Decision Boundary',
          data: makeLine((rng() - 0.5) * 0.1),
          borderColor: '#ffffff',
          borderWidth: 2,
          showLine: true,
          pointRadius: 0
        });

        datasets.push({
          label: 'Margin +',
          data: makeLine(margin),
          borderColor: '#ffd200',
          borderWidth: 1,
          showLine: true,
          pointRadius: 0,
          borderDash: [8, 6]
        });

        datasets.push({
          label: 'Margin -',
          data: makeLine(-margin),
          borderColor: '#ffd200',
          borderWidth: 1,
          showLine: true,
          pointRadius: 0,
          borderDash: [8, 6]
        });

        break;
      }

      default:
        break;
    }


    return { datasets };
  }, []);

  const loadRandomScenario = useCallback(() => {
    if (!scenarios.length) {
      setCurrentScenario(null);
      return;
    }

    const recent = recentScenarioIdsRef.current;
    const available = scenarios.filter(scenario => {
      const identifier = scenario?.id ?? scenario?.model;
      return identifier && !recent.includes(identifier);
    });

    const pool = available.length ? available : scenarios;
    const scenario = pool[Math.floor(Math.random() * pool.length)] ?? null;
    if (!scenario) {
      setCurrentScenario(null);
      return;
    }

    const identifier = scenario.id ?? scenario.model;
    if (identifier) {
      recentScenarioIdsRef.current = [identifier, ...recent.filter(id => id !== identifier)].slice(0, 5);
    }
    setCurrentScenario(scenario);
    setSelectedAnswer(null);
    setGameState('playing');
    setTimer(ROUND_TIME_SECONDS);
    setAnimationStep(0);
    setTimedOutRound(false);
    answeredRef.current = false;
    if (scenario.visualType === 'chart' && scenario.dataParams) {
      setChartData(generateChartData(scenario));
    } else {
      setChartData(null);
    }
  }, [generateChartData, scenarios]);

  const startNewSession = useCallback(() => {
    resetIdleTimer();
    sessionResultsRef.current = [];
    setSessionResults([]);
    setScore(0);
    setRoundIndex(1);
    setPlayerName('');
    setSubmissionError(null);
    setSessionComplete(false);
    setTimedOutRound(false);
    setSelectedAnswer(null);
    loadRandomScenario();
  }, [loadRandomScenario, resetIdleTimer]);

  useEffect(() => {
    if (!scenarios.length || scenariosLoading || scenariosError) {
      return undefined;
    }

    startNewSession();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [scenarios.length, scenariosLoading, scenariosError, startNewSession]);

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
  }, [gameState, completeRound]);

  useEffect(() => {
    if (!currentScenario || gameState !== 'playing') {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    let lastTick = performance.now();

    const animate = (now) => {
      const elapsed = now - lastTick;
      if (elapsed >= 100) {
        setAnimationStep(prev => (prev + 5) % 100);
        lastTick = now;
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [currentScenario, gameState]);

  const handleAnswerSelect = (answer) => {
    if (gameState !== 'playing' || answeredRef.current) return;
    resetIdleTimer();
    const isCorrect = answer === currentScenario.model;
    const timeTaken = Math.max(1, ROUND_TIME_SECONDS - timer);
    completeRound(isCorrect, { selectedOption: answer, timeTaken });
  };

  const nextQuestion = () => {
    const roundsCompleted = sessionResultsRef.current.length;
    resetIdleTimer();

    if (roundsCompleted >= TOTAL_ROUNDS) {
      openSessionSummary();
      return;
    }

    setRoundIndex(prev => Math.min(prev + 1, TOTAL_ROUNDS));
    loadRandomScenario();
  };

  const submitScore = async () => {
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
          booth: 'ml',
          score,
          userId,
          playerName: trimmedName,
          meta: {
            rounds: TOTAL_ROUNDS,
            results: sessionResults,
            perfect: sessionResults.length === TOTAL_ROUNDS && sessionResults.every(Boolean)
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to submit score: ${response.status}`);
      }

      await response.json();
      startNewSession();
    } catch (err) {
      console.error('Failed to submit ML booth score', err);
      setSubmissionError('Unable to submit score right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const returnHome = () => {
    resetIdleTimer();
    navigateTo('landing');
    navigate('/');
  };

  const renderVisual = () => {
    if (!currentScenario) return null;

    const type = currentScenario.visualType || (currentScenario.dataParams ? 'chart' : 'code');

    switch (type) {
      case 'chart':
        return chartData ? (
          <Scatter
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { type: 'linear', position: 'bottom', min: -5, max: 5 },
                y: { min: -5, max: 5 }
              },
              plugins: {
                legend: { display: true, position: 'top' }
              }
            }}
          />
        ) : (
          <div className="visual-placeholder">Preparing chart...</div>
        );

      case 'code': {
        const codeContent = typeof currentScenario.visualContent === 'string'
          ? currentScenario.visualContent
            .replace(/\r\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\t/g, '    ')
            .replace(/\\t/g, '    ')
          : '';
        return (
          <pre className="code-visual">
            <code>{codeContent}</code>
          </pre>
        );
      }

      case 'mermaid':
        return (
          <div
            className="mermaid-visual"
            ref={mermaidContainerRef}
            aria-label={`${currentScenario.model} flow diagram`}
          />
        );

      default:
        return <div className="visual-placeholder">Visualization coming soon</div>;
    }
  };

  if (scenariosLoading) {
    return (
      <div className="ml-booth">
        <div className="visual-placeholder">Loading scenarios...</div>
      </div>
    );
  }

  if (scenariosError) {
    return (
      <div className="ml-booth">
        <div className="visual-placeholder">
          <p>{scenariosError}</p>
          <button className="btn-next" onClick={fetchScenarios} type="button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!scenarios.length) {
    return (
      <div className="ml-booth">
        <div className="visual-placeholder">No scenarios available.</div>
      </div>
    );
  }

  if (!currentScenario) {
    return (
      <div className="ml-booth">
        <div className="visual-placeholder">Preparing next scenario...</div>
      </div>
    );
  }

  const roundsCompleted = sessionResults.length;
  const wins = sessionResults.filter(Boolean).length;
  const trimmedPlayerName = playerName.trim();
  const perfectSession = roundsCompleted === TOTAL_ROUNDS && sessionResults.every(Boolean);
  const canSubmitScore = trimmedPlayerName.length >= 2;
  const nextButtonLabel = roundsCompleted >= TOTAL_ROUNDS ? 'Finish Session' : 'Next Round';
  const isCorrectSelection = selectedAnswer === currentScenario.model;
  const revealTitle = timedOutRound ? "Time's Up! ⏰" : isCorrectSelection ? 'Correct! 🎉' : 'Incorrect ❌';

  return (
    <div className="ml-booth">
      {sessionComplete && perfectSession && <Confetti />}
      <div className="ml-header">
        <div className="header-left">
          <h1>Guess the Model 🤖</h1>
          <div className="scenario-info">
            <span className={`difficulty-pill ${currentScenario.difficulty.toLowerCase()}`}>
              {currentScenario.difficulty}
            </span>
            <span className="question-counter">Round {roundIndex} / {TOTAL_ROUNDS}</span>
            <span className="timer-chip">Time Left: {timer}s</span>
          </div>
        </div>
        <div className="header-right">
          <div className="stats">
            <div className="stat">
              <span>Rounds Completed</span>
              <strong>{Math.min(roundsCompleted, TOTAL_ROUNDS)}/{TOTAL_ROUNDS}</strong>
            </div>
            <div className="stat">
              <span>Score</span>
              <strong>{score}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="visualization-section">
        <div className="chart-container">
          {renderVisual()}
        </div>

        <div className="animation-controls">
          <div className="animation-progress">
            <div
              className="progress-bar"
              style={{ width: `${animationStep}%` }}
            />
          </div>
          <span className="animation-label">Model Training Simulation</span>
        </div>
      </div>

      <div className="question-section">
        <h3>{currentScenario.question}</h3>
        <p className="hint">Hint: {currentScenario.hint || 'Study the visualization carefully.'}</p>
      </div>

      <div className="options-section">
        {currentScenario.options.map((option, index) => (
          <motion.button
            key={option}
            className={`option-button ${
              selectedAnswer === option ? 'selected' : ''
            } ${
              gameState === 'revealed' && option === currentScenario.model ? 'correct' : ''
            } ${
              gameState === 'revealed' && selectedAnswer === option && option !== currentScenario.model ? 'incorrect' : ''
            }`}
            onClick={() => handleAnswerSelect(option)}
            disabled={gameState !== 'playing'}
            whileHover={gameState === 'playing' ? { scale: 1.05 } : {}}
            whileTap={gameState === 'playing' ? { scale: 0.95 } : {}}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            {option}
          </motion.button>
        ))}
      </div>

      {gameState === 'revealed' && (
        <motion.div
          className="explanation-section"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
        >
          <div className="explanation-content">
            <h4>{revealTitle}</h4>
            <p className="correct-answer">Correct Model: {currentScenario.model}</p>
            {timedOutRound && (
              <p className="explanation-text">
                The timer ran out before you answered. Review the explanation and get ready for the next round.
              </p>
            )}
            <p className="explanation-text">{currentScenario.explanation}</p>

            <div className="use-case-card">
              <h5>Real-World Use Case</h5>
              <p>{currentScenario.useCase}</p>
            </div>

            <div className="explanation-actions">
              <button className="btn-next" onClick={nextQuestion}>
                {nextButtonLabel}
              </button>
              <button className="btn-home" onClick={returnHome}>
                Return Home
              </button>
            </div>
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
            <h2>{perfectSession ? 'Flawless Run! 🎉' : 'Session Complete'}</h2>
            <p className="final-score">Score: {score}</p>
            <p className="accuracy">Correct Answers: {wins} / {TOTAL_ROUNDS}</p>

            <div className="name-form">
              <label htmlFor="ml-player-name">Enter your name to record this score:</label>
              <input
                id="ml-player-name"
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

export default MLBoothPage;
