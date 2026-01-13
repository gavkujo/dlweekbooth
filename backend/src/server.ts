import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}


type LeaderboardMeta = Record<string, unknown>;

type LeaderboardEntry = {
  id: string;
  userId: string | null;
  booth: string;
  score: number;
  playerName: string | null;
  timestamp: string;
  meta?: LeaderboardMeta;
};

const ensureFetch = async (): Promise<typeof fetch> => {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch;
  }

  const { default: nodeFetch } = await import('node-fetch');
  return nodeFetch as unknown as typeof fetch;
};

const requestPoseService = async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => {
  const fetchImpl = await ensureFetch();
  return fetchImpl(input, init);
};

const app = express();
const PORT = Number(process.env.PORT) || 5001;
const AUTO_START_POSE = process.env.AUTO_START_POSE !== 'false';
const POSE_SERVICE_HOST = process.env.POSE_SERVICE_HOST || 'http://localhost';
const POSE_SERVICE_PORT = Number(process.env.POSE_SERVICE_PORT) || 5002;
const POSE_SERVICE_BASE_URL = process.env.POSE_SERVICE_URL || `${POSE_SERVICE_HOST}:${POSE_SERVICE_PORT}`;
const POSE_ENDPOINT = `${POSE_SERVICE_BASE_URL.replace(/\/$/, '')}/detect-pose`;
const POSE_PYTHON = process.env.POSE_PYTHON || 'python3';

app.use(cors());
app.use(express.json({ limit: '20mb' }));

const DATA_PATH = path.join(__dirname, '..', 'data');

let leaderboardCache: LeaderboardEntry[] = [];

const loadJsonArray = async <T>(filename: string): Promise<T[]> => {
  if (filename === 'leaderboard.json') {
    return leaderboardCache as unknown as T[];
  }

  try {
    const raw = await fs.readFile(path.join(DATA_PATH, filename), 'utf-8');
    return JSON.parse(raw) as T[];
  } catch (error) {
    console.error(`Error loading ${filename}:`, error);
    return [];
  }
};

const saveJsonArray = async <T>(filename: string, data: T[]): Promise<void> => {
  if (filename === 'leaderboard.json') {
    leaderboardCache = data as unknown as LeaderboardEntry[];
    return;
  }

  try {
    await fs.writeFile(path.join(DATA_PATH, filename), JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error saving ${filename}:`, error);
  }
};

let poseProcess: ChildProcess | null = null;
let shuttingDown = false;
let restartAttempts = 0;

const ensurePoseService = () => {
  if (!AUTO_START_POSE || poseProcess || restartAttempts > 5) {
    return;
  }

  restartAttempts += 1;
  const scriptPath = path.join(__dirname, '..', 'pose_server.py');
  console.log(`Launching pose service via ${POSE_PYTHON} on port ${POSE_SERVICE_PORT}...`);
  poseProcess = spawn(POSE_PYTHON, [scriptPath], {
    env: { ...process.env, POSE_SERVER_PORT: String(POSE_SERVICE_PORT) },
    stdio: 'inherit'
  });

  poseProcess.on('spawn', () => {
    restartAttempts = 0;
  });

  poseProcess.on('error', (error) => {
    console.error('Failed to launch pose service', error);
    poseProcess = null;
    if (!shuttingDown) {
      setTimeout(ensurePoseService, 1000);
    }
  });

  poseProcess.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    console.warn(`Pose service exited unexpectedly (code: ${code}, signal: ${signal}).`);
    poseProcess = null;
    setTimeout(ensurePoseService, 1000);
  });
};

if (AUTO_START_POSE) {
  ensurePoseService();

  const shutdown = () => {
    shuttingDown = true;
    if (poseProcess) {
      poseProcess.kill();
    }
  };

  process.on('exit', shutdown);
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });
}

app.get('/api/nlp-prompts', async (_req: Request, res: Response) => {
  const prompts = await loadJsonArray<Record<string, unknown>>('nlp_prompts.json');
  res.json(prompts);
});

app.get('/api/ml-scenarios', async (_req: Request, res: Response) => {
  const scenarios = await loadJsonArray<Record<string, unknown>>('ml_scenarios.json');
  res.json(scenarios);
});

app.get('/api/cv-poses', async (_req: Request, res: Response) => {
  const poses = await loadJsonArray<Record<string, unknown>>('poses.json');
  res.json(poses);
});

app.post('/api/pose', async (req: Request, res: Response) => {
  try {
    const response = await requestPoseService(POSE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {})
    });

    const raw = await response.text();
    let payload: unknown;

    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch (parseError) {
      payload = { message: raw || 'Pose service responded with non-JSON payload.' };
    }

    res.status(response.status).json(payload);
  } catch (error) {
    console.error('Pose service request failed', error);
    res.status(502).json({ error: 'Pose service unavailable' });
  }
});

app.post('/api/score', async (req: Request, res: Response) => {
  const { booth, score, userId, meta, playerName } = req.body as {
    booth?: string;
    score?: number;
    userId?: string;
    meta?: LeaderboardMeta;
    playerName?: string;
  };

  if (!booth || typeof score !== 'number') {
    res.status(400).json({ error: 'Invalid score payload' });
    return;
  }

  try {
    const leaderboard = await loadJsonArray<LeaderboardEntry>('leaderboard.json');

    const newEntry: LeaderboardEntry = {
      id: Date.now().toString(),
      userId: userId ?? null,
      booth,
      score,
      playerName: playerName?.trim() || null,
      timestamp: new Date().toISOString(),
      meta
    };

    leaderboard.push(newEntry);
    await saveJsonArray('leaderboard.json', leaderboard);

    res.json({ success: true, id: newEntry.id });
  } catch (error) {
    console.error('Failed to save score', error);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

app.get('/api/leaderboard/:booth', async (req: Request, res: Response) => {
  const { booth } = req.params;
  const limit = Number.parseInt(req.query.limit as string, 10) || 10;

  try {
    const leaderboard = await loadJsonArray<LeaderboardEntry>('leaderboard.json');

    const filtered = leaderboard
      .filter((entry) => entry.booth === booth)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    res.json(filtered);
  } catch (error) {
    console.error('Failed to load leaderboard', error);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});
