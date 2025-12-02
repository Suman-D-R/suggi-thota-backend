// Express app configuration
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import 'express-async-errors'; // Handle async errors

import { envConfig } from './config/env';
import { connectDB } from './config/db';
import { logger } from './utils/logger';

// Import middleware
import { apiLimiter } from './middlewares/rateLimit.middleware';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { handleUploadError } from './middlewares/upload.middleware';

// Import routes
import { registerRoutes } from './routes';

const app = express();

// Trust proxy for rate limiting and logging
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false, // Disable CSP for API
}));

// CORS configuration
const corsOptions = {
  origin: function (origin: any, callback: any) {
    // In development, allow all origins (including mobile apps)
    if (envConfig.NODE_ENV === 'development') {
      return callback(null, true);
    }

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    // Allow specific origins in production
    const allowedOrigins = [
      envConfig.FRONTEND_URL,
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      // Add your production domains here
    ];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));

// Rate limiting
app.use('/api/', apiLimiter);

// Compression
app.use(compression());

// Logging
if (envConfig.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: {
      write: (message: string) => {
        logger.info(message.trim());
      },
    },
  }));
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    environment: envConfig.NODE_ENV,
  });
});

// Register all API routes
registerRoutes(app);

// Handle file upload errors
app.use(handleUploadError);

// Handle 404 errors
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Database connection
connectDB().catch((error) => {
  logger.error('Database connection failed:', error);
  process.exit(1);
});

export default app;

