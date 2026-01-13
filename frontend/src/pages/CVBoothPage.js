import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Confetti from 'react-confetti';
import { useApp } from '../contexts/AppContext';
import './CVBoothPage.css';

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL ?? '').replace(/\/$/, '');
const DEFAULT_POSE_ENDPOINT = `${API_BASE_URL || ''}/api/pose`;
const POSE_API_URL = (process.env.REACT_APP_POSE_API_URL ?? DEFAULT_POSE_ENDPOINT).replace(/\/$/, '');
const DETECTION_INTERVAL_MS = 150;
const SMOOTHING_ALPHA = 0.6;
const VISIBILITY_THRESHOLD = 0.35;
const MIN_DIMENSION = 0.12;
const SIMILARITY_SCALE = 2.1;
const SIMILARITY_SUCCESS_THRESHOLD = 0.80;
const TOTAL_ROUNDS = 5;
const MONITORED_KEYPOINTS = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee'
];

const LANDMARK_NAME_BY_INDEX = {
  11: 'left_shoulder',
  12: 'right_shoulder',
  13: 'left_elbow',
  14: 'right_elbow',
  15: 'left_wrist',
  16: 'right_wrist',
  23: 'left_hip',
  24: 'right_hip',
  25: 'left_knee',
  26: 'right_knee',
  27: 'left_ankle',
  28: 'right_ankle'
};

const DISPLAY_CONNECTIONS = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle']
];

const clamp01 = (value) => Math.min(Math.max(value, 0), 1);

const normalizeEntriesToMap = (entries) => {
  if (!entries.length) return null;

  const xs = entries.map(([, kp]) => kp.x);
  const ys = entries.map(([, kp]) => kp.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, MIN_DIMENSION);
  const height = Math.max(maxY - minY, MIN_DIMENSION);

  return entries.reduce((acc, [name, kp]) => {
    acc[name] = {
      ...kp,
      x: clamp01((kp.x - minX) / width),
      y: clamp01((kp.y - minY) / height)
    };
    return acc;
  }, {});
};

const normalizePoseBlueprint = (pose) => {
  if (!pose || !Array.isArray(pose.keypoints)) return null;
  const entries = pose.keypoints.map(kp => [kp.name, { x: kp.x, y: kp.y, visibility: 1 }]);
  return normalizeEntriesToMap(entries);
};

const normalizeDetectionMap = (keypointMap) => {
  if (!keypointMap) return null;
  const entries = Object.entries(keypointMap)
    .filter(([, kp]) => kp && typeof kp.x === 'number' && typeof kp.y === 'number' && (kp.visibility ?? 0) > VISIBILITY_THRESHOLD)
    .map(([name, kp]) => [name, { ...kp }]);
  return normalizeEntriesToMap(entries);
};

const mirrorNormalizedMap = (normalizedMap) => {
  if (!normalizedMap) return null;
  return Object.entries(normalizedMap).reduce((acc, [name, kp]) => {
    acc[name] = { ...kp, x: clamp01(1 - kp.x) };
    return acc;
  }, {});
};

const computeSimilarityScore = (targetMap, detectedMap) => {
  if (!targetMap || !detectedMap) return 0;

  let totalDiff = 0;
  let validPoints = 0;

  Object.entries(targetMap).forEach(([name, target]) => {
    const detected = detectedMap[name];
    if (detected && (detected.visibility ?? 1) > VISIBILITY_THRESHOLD) {
      const dx = detected.x - target.x;
      const dy = detected.y - target.y;
      totalDiff += Math.hypot(dx, dy);
      validPoints += 1;
    }
  });

  if (!validPoints) {
    return 0;
  }

  const avgDiff = totalDiff / validPoints;
  return Math.max(0, 1 - avgDiff * SIMILARITY_SCALE);
};

const CVBoothPage = () => {
  const navigate = useNavigate();
  const { navigateTo, userId, resetIdleTimer } = useApp();
  const [poses, setPoses] = useState([]);
  const [posesLoading, setPosesLoading] = useState(true);
  const [posesError, setPosesError] = useState(null);
  const [currentPose, setCurrentPose] = useState(null);
  const [countdown, setCountdown] = useState(3);
  const [gameState, setGameState] = useState('waiting');
  const [timer, setTimer] = useState(60);
  const [score, setScore] = useState(0);
  const [similarity, setSimilarity] = useState(0);
  const [roundIndex, setRoundIndex] = useState(1);
  const [sessionResults, setSessionResults] = useState([]);
  const sessionResultsRef = useRef([]);
  const [roundHistory, setRoundHistory] = useState([]);
  const [roundSummary, setRoundSummary] = useState(null);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [showMoveBackPrompt, setShowMoveBackPrompt] = useState(false);
  const [detectionConfidence, setDetectionConfidence] = useState(0);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const detectionLoopRef = useRef(null);
  const cameraStartedRef = useRef(false);
  const gameStateRef = useRef(gameState);
  const smoothedKeypointsRef = useRef(null);
  const normalizedPoseRef = useRef(null);
  const recentPoseIdsRef = useRef([]);
  const hasSessionStartedRef = useRef(false);

  const stopLoops = useCallback(() => {
    if (detectionLoopRef.current) {
      clearTimeout(detectionLoopRef.current);
      detectionLoopRef.current = null;
    }
    smoothedKeypointsRef.current = null;
  }, []);

  const fetchPoses = useCallback(async () => {
    setPosesLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/cv-poses`);
      if (!response.ok) {
        throw new Error(`Failed to load poses: ${response.status}`);
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        setPoses(data);
      } else {
        console.warn('Pose payload was not an array');
        setPoses([]);
      }
      setPosesError(null);
    } catch (err) {
      console.error('Failed to fetch poses', err);
      setPoses([]);
      setPosesError('Unable to load poses from server.');
    } finally {
      setPosesLoading(false);
    }
  }, []);

  const selectRandomPose = useCallback(() => {
    if (!poses.length) {
      return null;
    }

    const recent = recentPoseIdsRef.current;
    const candidates = poses.filter(pose => {
      const identifier = pose?.id ?? pose?.name;
      return identifier && !recent.includes(identifier);
    });

    const pool = candidates.length ? candidates : poses;
    const selection = pool[Math.floor(Math.random() * pool.length)] ?? null;
    const selectedId = selection?.id ?? selection?.name;

    if (selectedId) {
      recentPoseIdsRef.current = [selectedId, ...recent.filter(id => id !== selectedId)].slice(0, 5);
    }

    return selection;
  }, [poses]);

  const setPoseForRound = useCallback((poseDefinition) => {
    if (poseDefinition) {
      setCurrentPose(poseDefinition);
      normalizedPoseRef.current = normalizePoseBlueprint(poseDefinition);
    }
  }, []);

  const completeRound = useCallback((didWin, { finalSimilarity = 0, timedOut = false } = {}) => {
    const roundNumber = sessionResultsRef.current.length + 1;
    stopLoops();
    setDetectionConfidence(0);
    setShowMoveBackPrompt(false);
    setSimilarity(finalSimilarity);

    const summary = {
      round: roundNumber,
      didWin,
      similarity: finalSimilarity,
      timedOut,
      poseName: currentPose?.name ?? 'Pose'
    };

    setRoundSummary(summary);
    setRoundHistory(prev => [...prev, summary]);
    setSessionResults(prev => {
      const updated = [...prev, didWin];
      sessionResultsRef.current = updated;
      return updated;
    });

    if (didWin) {
      setScore(prev => prev + Math.floor(finalSimilarity * 100));
    }

    setGameState('roundResult');
    resetIdleTimer();
  }, [currentPose, resetIdleTimer, stopLoops]);

  const openSessionSummary = useCallback(() => {
    stopLoops();
    setRoundSummary(null);
    setSessionComplete(true);
    setGameState('summary');
    resetIdleTimer();
  }, [resetIdleTimer, stopLoops]);

  const prepareForNextRound = useCallback((poseDefinition, nextRoundIndex) => {
    if (!poseDefinition) {
      setGameState('waiting');
      return;
    }

    setRoundIndex(nextRoundIndex);
    setRoundSummary(null);
    setSimilarity(0);
    setDetectionConfidence(0);
    setShowMoveBackPrompt(false);
    setCountdown(3);
    setTimer(60);
    setPoseForRound(poseDefinition);
    setGameState('countdown');
  }, [setPoseForRound]);

  const nextRound = useCallback(() => {
    resetIdleTimer();
    const completed = sessionResultsRef.current.length;
    if (completed >= TOTAL_ROUNDS) {
      openSessionSummary();
      return;
    }

    const poseDefinition = selectRandomPose();
    prepareForNextRound(poseDefinition, Math.min(completed + 1, TOTAL_ROUNDS));
  }, [openSessionSummary, prepareForNextRound, resetIdleTimer, selectRandomPose]);

  const startCamera = useCallback(async () => {
    if (cameraStartedRef.current) {
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera access is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
        cameraStartedRef.current = true;
        setCameraError(null);
      } else {
        stream.getTracks().forEach(track => track.stop());
      }
    } catch (err) {
      console.log('Camera error:', err);
      setCameraError('Unable to access the camera. Please check permissions and try again.');
      cameraStartedRef.current = false;
    }
  }, []);

  const startNewSession = useCallback(() => {
    stopLoops();
    resetIdleTimer();
    sessionResultsRef.current = [];
    setSessionResults([]);
    setRoundHistory([]);
    setRoundSummary(null);
    setScore(0);
    setRoundIndex(1);
    setSessionComplete(false);
    setPlayerName('');
    setSubmissionError(null);
    setIsSubmitting(false);
    setSimilarity(0);
    setDetectionConfidence(0);
    setShowMoveBackPrompt(false);
    setCameraError(null);
    setCountdown(3);
    setTimer(60);

    const poseDefinition = selectRandomPose();
    if (poseDefinition) {
      setPoseForRound(poseDefinition);
      setGameState('countdown');
    } else {
      setGameState('waiting');
    }
  }, [resetIdleTimer, selectRandomPose, setPoseForRound, stopLoops]);

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
          booth: 'cv',
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
      console.error('Failed to submit CV booth score', err);
      setSubmissionError('Unable to submit score right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [playerName, resetIdleTimer, roundHistory, score, startNewSession, userId]);

  useEffect(() => {
    fetchPoses();
  }, [fetchPoses]);

  useEffect(() => {
    captureCanvasRef.current = document.createElement('canvas');
    return () => {
      captureCanvasRef.current = null;
    };
  }, []);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const handleSuccess = useCallback((matchScore) => {
    completeRound(true, { finalSimilarity: matchScore });
  }, [completeRound]);

  const endGame = useCallback(() => {
    completeRound(false, { timedOut: true, finalSimilarity: similarity });
  }, [completeRound, similarity]);

  const drawSkeleton = useCallback((keypointMap) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;

    Object.values(keypointMap).forEach(kp => {
      if (kp && kp.visibility > 0.45) {
        ctx.beginPath();
        ctx.arc(kp.x * canvas.width, kp.y * canvas.height, 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#ff00ff';
        ctx.fill();
      }
    });

    DISPLAY_CONNECTIONS.forEach(([startName, endName]) => {
      const start = keypointMap[startName];
      const end = keypointMap[endName];
      if (start && end && start.visibility > 0.45 && end.visibility > 0.45) {
        ctx.beginPath();
        ctx.moveTo(start.x * canvas.width, start.y * canvas.height);
        ctx.lineTo(end.x * canvas.width, end.y * canvas.height);
        ctx.stroke();
      }
    });
  }, []);

  const calculateSimilarity = useCallback((keypointMap) => {
    if (!currentPose || !normalizedPoseRef.current || gameStateRef.current !== 'active') {
      return;
    }

    const normalizedDetected = normalizeDetectionMap(keypointMap);
    if (!normalizedDetected) {
      setSimilarity(prev => Math.max(0, prev - 0.08));
      return;
    }

    const mirroredDetected = mirrorNormalizedMap(normalizedDetected);
    const targetMap = normalizedPoseRef.current;
    const score = computeSimilarityScore(targetMap, normalizedDetected);
    const mirroredScore = computeSimilarityScore(targetMap, mirroredDetected);
    const bestScore = Math.max(score, mirroredScore);

    setSimilarity(prev => prev * 0.4 + bestScore * 0.6);

    if (bestScore >= SIMILARITY_SUCCESS_THRESHOLD) {
      handleSuccess(bestScore);
    }
  }, [currentPose, handleSuccess]);

  const requestPoseEstimation = useCallback(async () => {
    if (!videoRef.current || !captureCanvasRef.current) {
      return null;
    }

    const video = videoRef.current;
    const captureCanvas = captureCanvasRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      return null;
    }
    const ctx = captureCanvas.getContext('2d');
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.5);

    const response = await fetch(POSE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl })
    });

    if (!response.ok) {
      throw new Error('Pose server error');
    }

    return response.json();
  }, []);

  const smoothKeypoints = useCallback((latest) => {
    if (!latest) {
      smoothedKeypointsRef.current = null;
      return null;
    }

    const previous = smoothedKeypointsRef.current;
    if (!previous) {
      smoothedKeypointsRef.current = latest;
      return latest;
    }

    const smoothed = MONITORED_KEYPOINTS.reduce((acc, name) => {
      const current = latest[name];
      const prev = previous[name];

      if (!current && !prev) {
        return acc;
      }

      if (!prev) {
        acc[name] = current;
        return acc;
      }

      if (!current) {
        acc[name] = { ...prev, visibility: prev.visibility * SMOOTHING_ALPHA };
        return acc;
      }

      const blended = {
        x: prev.x * SMOOTHING_ALPHA + current.x * (1 - SMOOTHING_ALPHA),
        y: prev.y * SMOOTHING_ALPHA + current.y * (1 - SMOOTHING_ALPHA),
        visibility: prev.visibility * SMOOTHING_ALPHA + current.visibility * (1 - SMOOTHING_ALPHA)
      };

      acc[name] = blended.visibility > VISIBILITY_THRESHOLD ? blended : { ...blended, visibility: blended.visibility * 0.5 };

      return acc;
    }, {});

    smoothedKeypointsRef.current = smoothed;
    return smoothed;
  }, []);

  const processDetection = useCallback((payload) => {
    if (!payload || !Array.isArray(payload.landmarks)) {
      setDetectionConfidence(0);
      return null;
    }

    const coverage = payload.coverage || {};
    const keypointMap = payload.landmarks.reduce((acc, landmark) => {
      const name = LANDMARK_NAME_BY_INDEX[landmark.index];
      if (name) {
        acc[name] = landmark;
      }
      return acc;
    }, {});

    setDetectionConfidence(payload.confidence ?? 0);
    setShowMoveBackPrompt(!payload.fullBodyVisible && payload.upperBodyVisible);

    if (coverage.crowded) {
      setSimilarity(prev => Math.max(0, prev - 0.1));
    }

    return keypointMap;
  }, []);

  const runDetectionLoop = useCallback(async () => {
    if (gameStateRef.current !== 'active') {
      return;
    }

    try {
      const result = await requestPoseEstimation();
      const keypointMap = processDetection(result);
      const smoothed = smoothKeypoints(keypointMap);
      if (smoothed) {
        drawSkeleton(smoothed);
        calculateSimilarity(smoothed);
      } else {
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
      resetIdleTimer();
    } catch (err) {
      console.error('Pose detection failed:', err);
      setDetectionConfidence(0);
      setShowMoveBackPrompt(false);
    } finally {
      if (gameStateRef.current === 'active') {
        detectionLoopRef.current = setTimeout(runDetectionLoop, DETECTION_INTERVAL_MS);
      }
    }
  }, [calculateSimilarity, drawSkeleton, processDetection, requestPoseEstimation, resetIdleTimer, smoothKeypoints]);

  const startPoseEvaluation = useCallback(() => {
    stopLoops();
    detectionLoopRef.current = setTimeout(runDetectionLoop, DETECTION_INTERVAL_MS);
  }, [runDetectionLoop, stopLoops]);

  useEffect(() => {
    if (posesLoading || posesError || !poses.length) {
      return undefined;
    }

    if (!hasSessionStartedRef.current) {
      hasSessionStartedRef.current = true;
      startNewSession();
    }

    return undefined;
  }, [poses.length, posesLoading, posesError, startNewSession]);

  useEffect(() => {
    if (posesLoading || posesError) {
      return;
    }

    if (currentPose && videoRef.current && !cameraStartedRef.current) {
      startCamera();
    }
  }, [currentPose, posesError, posesLoading, startCamera]);

  useEffect(() => {
    if (gameState === 'countdown') {
      if (countdown > 0) {
        const timerId = setTimeout(() => setCountdown(c => c - 1), 1000);
        return () => clearTimeout(timerId);
      }
      setGameState('active');
    }
  }, [countdown, gameState]);

  useEffect(() => {
    if (gameState !== 'active') {
      return;
    }

    if (timer <= 0) {
      endGame();
      return;
    }

    const timerId = setTimeout(() => setTimer(t => t - 1), 1000);
    return () => clearTimeout(timerId);
  }, [gameState, timer, endGame]);

  useEffect(() => {
    if (gameState === 'active') {
      resetIdleTimer();
      startPoseEvaluation();
      return;
    }
    stopLoops();
  }, [gameState, resetIdleTimer, startPoseEvaluation, stopLoops]);

  useEffect(() => {
    return () => {
      stopLoops();
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
      cameraStartedRef.current = false;
    };
  }, [stopLoops]);

  const returnHome = () => {
    stopLoops();
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      cameraStartedRef.current = false;
    }
    setSessionComplete(false);
    setGameState('waiting');
    setRoundSummary(null);
    setCameraError(null);
    navigateTo('landing');
    navigate('/');
    resetIdleTimer();
  };

  if (posesLoading) {
    return (
      <div className="cv-booth">
        <div className="cv-container">
          <div className="target-section">
            <h3>Loading poses...</h3>
          </div>
        </div>
      </div>
    );
  }

  if (posesError) {
    return (
      <div className="cv-booth">
        <div className="cv-container">
          <div className="target-section">
            <h3>Pose data unavailable</h3>
            <p>{posesError}</p>
            <button className="btn-try-again" onClick={fetchPoses} type="button">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!poses.length || !currentPose) {
    return (
      <div className="cv-booth">
        <div className="cv-container">
          <div className="target-section">
            <h3>Preparing pose challenge...</h3>
          </div>
        </div>
      </div>
    );
  }

  const roundsCompleted = sessionResults.length;
  const wins = sessionResults.filter(Boolean).length;
  const perfectSession = roundsCompleted === TOTAL_ROUNDS && sessionResults.every(Boolean);
  const trimmedPlayerName = playerName.trim();
  const canSubmitScore = trimmedPlayerName.length >= 2;
  const averageSimilarity = roundHistory.length
    ? Math.round((roundHistory.reduce((total, round) => total + (round.similarity ?? 0), 0) / roundHistory.length) * 100)
    : 0;
  const nextActionIsSummary = roundsCompleted >= TOTAL_ROUNDS;
  const nextActionLabel = nextActionIsSummary ? 'View Summary' : 'Next Round';

  return (
    <div className="cv-booth">
      {sessionComplete && perfectSession && <Confetti />}

      <div className="cv-header">
        <div className="cv-header-left">
          <h1>Pose Challenge</h1>
          <span className="round-chip">Round {Math.min(roundIndex, TOTAL_ROUNDS)} / {TOTAL_ROUNDS}</span>
        </div>
        <div className="cv-header-right">
          <div className="stat-chip">
            <span>Completed</span>
            <strong>{roundsCompleted}/{TOTAL_ROUNDS}</strong>
          </div>
          <div className="stat-chip">
            <span>Score</span>
            <strong>{score}</strong>
          </div>
        </div>
      </div>

      <div className="cv-container">
        <div className="webcam-section">
          <div className="video-container">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="webcam-feed"
            />
            <canvas
              ref={canvasRef}
              className="skeleton-canvas"
              width={640}
              height={480}
            />
            {showMoveBackPrompt && (
              <motion.div
                className="move-back-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                Move back so we can see your full pose
              </motion.div>
            )}

            <AnimatePresence>
              {gameState === 'counting' && (
                <motion.div
                  className="countdown-overlay"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 2, opacity: 0 }}
                >
                  <span className="countdown-number">{countdown}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="timer-bar">
            <div
              className="timer-progress"
              style={{ width: `${(timer / 60) * 100}%` }}
            />
            <span className="timer-text">{timer}s</span>
            <span className="confidence-text">{Math.round(detectionConfidence * 100)}% lock</span>
          </div>

          {cameraError && (
            <div className="camera-error">
              {cameraError}
            </div>
          )}
        </div>

        <div className="target-section">
          <div className="target-pose">
            <h3>Target Pose</h3>
            {currentPose && (
              <>
                <h4 className="pose-name">{currentPose.name}</h4>
                <p className="pose-description">{currentPose.description}</p>

                <div className="pose-visualization">
                  <svg width="300" height="400" viewBox="0 0 300 400">
                    {currentPose.keypoints.map((kp, i) => (
                      <circle
                        key={i}
                        cx={kp.x * 300}
                        cy={kp.y * 400}
                        r="6"
                        fill="#ff00ff"
                        filter="url(#glow)"
                      />
                    ))}

                    {currentPose.connections && currentPose.connections.map((conn, i) => {
                      const start = currentPose.keypoints.find(k => k.name === conn[0]);
                      const end = currentPose.keypoints.find(k => k.name === conn[1]);
                      if (start && end) {
                        return (
                          <line
                            key={i}
                            x1={start.x * 300}
                            y1={start.y * 400}
                            x2={end.x * 300}
                            y2={end.y * 400}
                            stroke="#ff00ff"
                            strokeWidth="3"
                            filter="url(#glow)"
                          />
                        );
                      }
                      return null;
                    })}

                    <defs>
                      <filter id="glow">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                  </svg>
                </div>
              </>
            )}
          </div>

          <div className="similarity-meter">
            <h4>Similarity: {Math.round(similarity * 100)}%</h4>
            <div className="meter-bar">
              <div
                className="meter-fill"
                style={{ width: `${similarity * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {gameState === 'roundResult' && roundSummary && (
          <motion.div
            className="results-panel"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
          >
            <div className="results-content">
              {roundSummary.didWin ? (
                <>
                  <h2 className="success-title">Great Pose! 🙌</h2>
                  <p>You matched {roundSummary.poseName} with {Math.round((roundSummary.similarity ?? 0) * 100)}% accuracy.</p>
                  <p className="score">Score: +{Math.floor((roundSummary.similarity ?? 0) * 100)}</p>
                </>
              ) : (
                <>
                  <h2 className="failure-title">{roundSummary.timedOut ? "Time's Up! ⏰" : "Keep Practicing!"}</h2>
                  <p>{roundSummary.timedOut ? 'The timer expired before a match.' : 'The similarity threshold was not reached this round.'}</p>
                </>
              )}

              <div className="results-actions">
                <motion.button
                  className="btn-try-again"
                  onClick={nextActionIsSummary ? openSessionSummary : nextRound}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {nextActionLabel}
                </motion.button>
                <motion.button
                  className="btn-home"
                  onClick={returnHome}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Return to Home
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {sessionComplete && gameState === 'summary' && (
        <motion.div
          className="gameover-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="gameover-content">
            <h2>{perfectSession ? 'Perfect Poses! 🎉' : 'Session Complete'}</h2>
            <p className="final-score">Score: {score}</p>
            <p className="accuracy">Successful Rounds: {wins} / {TOTAL_ROUNDS}</p>
            <p className="accuracy">Average Similarity: {averageSimilarity}%</p>

            <div className="name-form">
              <label htmlFor="cv-player-name">Enter your name to record this score:</label>
              <input
                id="cv-player-name"
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

export default CVBoothPage;
