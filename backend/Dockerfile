# syntax=docker/dockerfile:1

# Build stage: compile TypeScript
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install dependencies with cache-friendly layering
COPY backend/package*.json ./
RUN npm ci

# Copy source and build
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/data ./data
COPY backend/pose_server.py ./pose_server.py
RUN npm run build

# Runtime stage: node + python + opencv/mediapipe
FROM node:20-bookworm-slim
WORKDIR /app

# System deps for python + opencv
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment for Python packages
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Upgrade pip inside venv
RUN pip install --upgrade pip

# Install Python dependencies into the venv
RUN pip install --no-cache-dir \
    mediapipe==0.10.8 \
    opencv-python-headless==4.8.0.76 \
    flask==3.1.2 \
    flask-cors==6.0.2 \
    numpy==1.26.4


# Node runtime deps (prod only)
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Bring built artifacts and assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data ./data
COPY --from=builder /app/pose_server.py ./pose_server.py

ENV NODE_ENV=production \
    PORT=5001 \
    AUTO_START_POSE=true \
    POSE_SERVICE_PORT=5002 \
    POSE_PYTHON=python3

EXPOSE 5001
CMD ["node", "dist/server.js"]
