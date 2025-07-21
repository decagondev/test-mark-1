import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { healthRouter } from './routes/healthRoutes';
import { submissionRouter } from './routes/submissionRoutes';
import { userRouter } from './routes/userRoutes';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { SubmissionProgressEvent, SubmissionCompleteEvent, SubmissionErrorEvent } from './types';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);

// Socket.io setup with CORS
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const PORT = process.env.PORT || 3001;
const startTime = Date.now();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  }
});

app.use(limiter);

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});

// MongoDB Connection
const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      throw new Error('MONGODB_URI environment variable is not defined');
    }

    await mongoose.connect(mongoURI, {
      retryWrites: true,
      w: 'majority'
    });

    logger.info('MongoDB connected successfully', {
      database: mongoose.connection.name,
      host: mongoose.connection.host
    });
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// MongoDB connection events
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  // Handle submission start event
  socket.on('submission:start', (data: { submissionId: string }) => {
    logger.info('Submission started', { submissionId: data.submissionId, socketId: socket.id });
    socket.join(`submission:${data.submissionId}`);
  });

  // Handle client disconnection
  socket.on('disconnect', (reason) => {
    logger.info('Client disconnected', { socketId: socket.id, reason });
  });

  // Handle connection errors
  socket.on('error', (error) => {
    logger.error('Socket error', { socketId: socket.id, error: error.message });
  });
});

// Export io for use in other modules
export { io };

// Emit submission progress events
export const emitSubmissionProgress = (event: SubmissionProgressEvent): void => {
  io.to(`submission:${event.id}`).emit('submission:progress', event);
  logger.info('Submission progress emitted', { submissionId: event.id, status: event.status });
};

export const emitSubmissionComplete = (event: SubmissionCompleteEvent): void => {
  io.to(`submission:${event.submission._id}`).emit('submission:complete', event);
  logger.info('Submission complete emitted', { submissionId: event.submission._id });
};

export const emitSubmissionError = (event: SubmissionErrorEvent): void => {
  io.to(`submission:${event.id}`).emit('submission:error', event);
  logger.error('Submission error emitted', { submissionId: event.id, error: event.error });
};

// API Routes
app.use('/health', healthRouter);
app.use('/api/submissions', submissionRouter);
app.use('/api/users', userRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Deca Test Mark API',
    version: '1.0.0',
    status: 'running',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handler (must be last)
app.use(errorHandler);

// Graceful shutdown handling
const gracefulShutdown = async (): Promise<void> => {
  logger.info('Starting graceful shutdown...');
  
  server.close(() => {
    logger.info('HTTP server closed.');
  });

  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed.');
  } catch (error) {
    logger.error('Error closing MongoDB connection:', error);
  }

  process.exit(0);
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

// Start server
const startServer = async (): Promise<void> => {
  try {
    // Connect to database
    await connectDB();

    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        port: PORT,
        timestamp: new Date().toISOString()
      });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Initialize server
startServer(); 