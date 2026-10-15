import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: process.env.MM_SERVICE ?? 'app' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: ['password', '*.password', 'token', '*.token', 'authorization', 'cookie'],
});

export type Logger = typeof logger;
