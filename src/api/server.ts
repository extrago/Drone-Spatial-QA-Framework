import 'express-async-errors';
import * as dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { closePool } from './db/postgresClient';
import telemetryRouter from './routes/telemetry';
import dronesRouter from './routes/drones';
import { logger } from './logger';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.API_PORT ?? '3001', 10);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware — logs method, path, status, and response time
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      event:   'http_request',
      method:  req.method,
      path:    req.path,
      status:  res.statusCode,
      duration_ms: Date.now() - start,
    });
  });
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'drone-telemetry-api', timestamp: new Date().toISOString() });
});

app.use('/telemetry', telemetryRouter);
app.use('/drones',    dronesRouter);

// ─── Global Error Handler ─────────────────────────────────────────────────────
// express-async-errors automatically catches async route errors and sends them here
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ event: 'unhandled_error', message: err.message, stack: err.stack });
  res.status(500).json({
    status:  'error',
    message: 'Internal server error',
    detail:  process.env.NODE_ENV !== 'production' ? err.message : undefined,
  });
});

// ─── Server Lifecycle ─────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info({ event: 'server_started', port: PORT, env: process.env.NODE_ENV ?? 'development' });
});

// Graceful shutdown — ensures DB pool is properly released
const gracefulShutdown = async (signal: string) => {
  logger.info({ event: 'shutdown_initiated', signal });
  server.close(async () => {
    await closePool();
    logger.info({ event: 'shutdown_complete' });
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

export default app;
