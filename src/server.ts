// Server entry point
import app from './app';
import { logger } from './utils/logger';

const PORT = process.env.PORT || 3000;

// Start server with error handling
try {
  const server = app.listen(PORT, () => {
    logger.info(`🚀 Server is running on port ${PORT}`);
    console.log(`✅ Server is running on port ${PORT}`);
  });
  
  server.on('error', (error: any) => {
    logger.error('Server startup error:', error);
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} is already in use. Please use a different port.`);
    }
    process.exit(1);
  });
} catch (error: any) {
  logger.error('Failed to start server:', error);
  process.exit(1);
}

