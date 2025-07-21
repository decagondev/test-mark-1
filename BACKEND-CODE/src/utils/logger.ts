import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(logColors);

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Define console format
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define transports
const transports = [
  // Console transport
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || 'info',
    format: consoleFormat,
  }),
  
  // Error log file
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
  
  // Combined log file
  new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
];

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels: logLevels,
  format: logFormat,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Add production-specific configuration
if (process.env.NODE_ENV === 'production') {
  // Remove console logging in production
  logger.remove(logger.transports[0]);
  
  // Add more restrictive file logging
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'app.log'),
    level: 'info',
    format: logFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 10,
  }));
}

// Stream for Morgan HTTP logging
export const logStream = {
  write: (message: string): void => {
    logger.http(message.trim());
  },
};

// Helper methods for structured logging
export const loggerHelpers = {
  logRequest: (method: string, url: string, statusCode: number, responseTime: number, ip?: string): void => {
    logger.http('HTTP Request', {
      method,
      url,
      statusCode,
      responseTime: `${responseTime}ms`,
      ip,
      timestamp: new Date().toISOString(),
    });
  },

  logError: (error: Error, context?: Record<string, any>): void => {
    logger.error('Application Error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      context,
      timestamp: new Date().toISOString(),
    });
  },

  logDatabaseOperation: (operation: string, collection: string, duration?: number, details?: Record<string, any>): void => {
    logger.info('Database Operation', {
      operation,
      collection,
      duration: duration ? `${duration}ms` : undefined,
      details,
      timestamp: new Date().toISOString(),
    });
  },

  logSubmissionEvent: (submissionId: string, event: string, phase?: string, details?: Record<string, any>): void => {
    logger.info('Submission Event', {
      submissionId,
      event,
      phase,
      details,
      timestamp: new Date().toISOString(),
    });
  },

  logAPICall: (service: string, endpoint: string, statusCode?: number, duration?: number, error?: string): void => {
    const level = error ? 'error' : 'info';
    logger.log(level, 'External API Call', {
      service,
      endpoint,
      statusCode,
      duration: duration ? `${duration}ms` : undefined,
      error,
      timestamp: new Date().toISOString(),
    });
  },

  logSecurityEvent: (event: string, ip?: string, userAgent?: string, details?: Record<string, any>): void => {
    logger.warn('Security Event', {
      event,
      ip,
      userAgent,
      details,
      timestamp: new Date().toISOString(),
    });
  },
};

export { logger }; 