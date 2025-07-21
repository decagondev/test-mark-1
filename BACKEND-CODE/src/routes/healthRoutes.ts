import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { HealthCheckResponse } from '../types';
import { logger } from '../utils/logger';

const router = Router();

// Basic health check endpoint
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const startTime = Date.now();
    
    // Check database connection
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    // Check basic service availability
    const healthResponse: HealthCheckResponse = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        groq: 'available', // TODO: Add actual Groq API check
      },
      version: '1.0.0',
      uptime: process.uptime(),
    };

    // If any service is down, set status to ERROR
    const allServicesUp = Object.values(healthResponse.services).every(
      status => status === 'connected' || status === 'available'
    );

    if (!allServicesUp) {
      healthResponse.status = 'ERROR';
    }

    const responseTime = Date.now() - startTime;
    
    logger.info('Health check completed', {
      status: healthResponse.status,
      responseTime: `${responseTime}ms`,
      services: healthResponse.services,
    });

    // Return appropriate status code
    const statusCode = healthResponse.status === 'OK' ? 200 : 503;
    res.status(statusCode).json(healthResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Health check failed', { error: errorMessage });
    
    const errorResponse: HealthCheckResponse = {
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      services: {
        database: 'disconnected',
        groq: 'unavailable',
      },
      version: '1.0.0',
      uptime: process.uptime(),
    };

    res.status(503).json(errorResponse);
  }
});

// Detailed health check endpoint
router.get('/detailed', async (req: Request, res: Response): Promise<void> => {
  try {
    const startTime = Date.now();

    // Check MongoDB connection with detailed info
    const dbConnectionState = mongoose.connection.readyState;
    const dbStates = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };

    const dbStatus = dbStates[dbConnectionState] || 'unknown';
    const dbDetails = {
      state: dbStatus,
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      port: mongoose.connection.port,
    };

    // Redis not used in simplified setup

    // TODO: Add Groq API check
    const groqDetails = {
      status: 'available', // Placeholder
      apiKey: process.env.GROQ_API_KEY ? 'configured' : 'not_configured',
    };

    // System information
    const systemInfo = {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024),
      },
      cpu: process.cpuUsage(),
    };

    const responseTime = Date.now() - startTime;

    const detailedResponse = {
      status: dbStatus === 'connected' ? 'OK' : 'ERROR',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      version: '1.0.0',
      uptime: `${Math.floor(process.uptime())}s`,
      services: {
        database: dbDetails,
        groq: groqDetails,
      },
      system: systemInfo,
    };

    logger.info('Detailed health check completed', {
      responseTime: `${responseTime}ms`,
      dbStatus,
    });

    const statusCode = detailedResponse.status === 'OK' ? 200 : 503;
    res.status(statusCode).json(detailedResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Detailed health check failed', { error: errorMessage });
    
    res.status(503).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      version: '1.0.0',
    });
  }
});

// Database-specific health check
router.get('/database', async (req: Request, res: Response): Promise<void> => {
  try {
    const startTime = Date.now();

    // Test database operation
    const isConnected = mongoose.connection.readyState === 1;
    
    if (!isConnected) {
      throw new Error('Database not connected');
    }

    // Try a simple database operation
    const collections = await mongoose.connection.db.listCollections().toArray();
    const responseTime = Date.now() - startTime;

    const dbResponse = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      database: {
        connected: true,
        host: mongoose.connection.host,
        name: mongoose.connection.name,
        collections: collections.length,
      },
    };

    logger.info('Database health check completed', {
      responseTime: `${responseTime}ms`,
      collections: collections.length,
    });

    res.status(200).json(dbResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Database health check failed', { error: errorMessage });
    
    res.status(503).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: errorMessage,
      },
    });
  }
});

// Ready check endpoint (for Kubernetes readiness probe)
router.get('/ready', async (req: Request, res: Response): Promise<void> => {
  try {
    // Check if all critical services are ready
    const dbReady = mongoose.connection.readyState === 1;
    
    if (!dbReady) {
      throw new Error('Database not ready');
    }

    res.status(200).json({
      status: 'READY',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(503).json({
      status: 'NOT_READY',
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });
  }
});

// Live check endpoint (for Kubernetes liveness probe)
router.get('/live', (req: Request, res: Response): void => {
  res.status(200).json({
    status: 'ALIVE',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export { router as healthRouter }; 