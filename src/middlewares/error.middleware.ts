// Error handling middleware
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import { envConfig } from '../config/env';

// Custom error class
export class AppError extends Error {
  public statusCode: number;
  public status: string;
  public isOperational: boolean;
  public code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Handle MongoDB Cast Errors
const handleCastErrorDB = (err: mongoose.Error.CastError): AppError => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400, 'INVALID_ID');
};

// Handle MongoDB Duplicate Field Errors
const handleDuplicateFieldsDB = (err: any): AppError => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];
  const message = `Duplicate field value: ${field} - '${value}'. Please use another value!`;
  return new AppError(message, 400, 'DUPLICATE_FIELD');
};

// Handle MongoDB Validation Errors
const handleValidationErrorDB = (err: mongoose.Error.ValidationError): AppError => {
  const errors = Object.values(err.errors).map((val: any) => val.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400, 'VALIDATION_ERROR');
};

// Handle JWT Errors
const handleJWTError = (): AppError =>
  new AppError('Invalid token. Please log in again!', 401, 'INVALID_TOKEN');

const handleJWTExpiredError = (): AppError =>
  new AppError('Your token has expired! Please log in again.', 401, 'TOKEN_EXPIRED');

// Send error in development
const sendErrorDev = (err: AppError, res: Response): void => {
  res.status(err.statusCode).json({
    success: false,
    error: err,
    message: err.message,
    stack: err.stack,
    code: err.code,
  });
};

// Send error in production
const sendErrorProd = (err: AppError, res: Response): void => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
  } else {
    // Programming or other unknown error: don't leak error details
    logger.error('ERROR 💥', err);

    res.status(500).json({
      success: false,
      message: 'Something went wrong!',
      code: 'INTERNAL_ERROR',
    });
  }
};

// Global error handler
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error('Global error handler:', err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') error = handleCastErrorDB(error as mongoose.Error.CastError);

  // Mongoose duplicate key
  if (err.code === 11000) error = handleDuplicateFieldsDB(error);

  // Mongoose validation error
  if (err.name === 'ValidationError') error = handleValidationErrorDB(error as mongoose.Error.ValidationError);

  // JWT errors
  if (err.name === 'JsonWebTokenError') error = handleJWTError();
  if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();

  // Send appropriate error response
  if (envConfig.NODE_ENV === 'development') {
    sendErrorDev(error as AppError, res);
  } else {
    sendErrorProd(error as AppError, res);
  }
};

// Catch async errors
export const catchAsync = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
};

// Handle 404 errors
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  // Silently ignore Next.js dev mode requests (HMR, error overlay, etc.)
  if (
    req.path.startsWith('/_next/') ||
    req.path.startsWith('/__nextjs_original-stack-frame') ||
    req.path.startsWith('/__webpack')
  ) {
    res.status(404).json({
      success: false,
      message: 'Not found',
      code: 'NOT_FOUND',
    });
    return;
  }
  
  const error = new AppError(`Not found - ${req.originalUrl}`, 404, 'NOT_FOUND');
  next(error);
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error | any) => {
  logger.error('UNHANDLED REJECTION! 💥 Shutting down...');
  logger.error('Error name:', err?.name || 'Unknown');
  logger.error('Error message:', err?.message || String(err) || 'Unknown error');
  logger.error('Stack:', err?.stack || 'No stack trace available');
  // In development, log but don't exit for non-critical errors
  if (envConfig.NODE_ENV === 'production') {
    process.exit(1);
  } else {
    logger.warn('Continuing in development mode despite unhandled rejection');
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err: any) => {
  logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  const errorName = err?.name || (err?.constructor?.name) || 'Unknown';
  const errorMessage = err?.message || String(err) || 'Unknown error';
  const errorStack = err?.stack || 'No stack trace available';
  
  logger.error('Error name:', errorName);
  logger.error('Error message:', errorMessage);
  logger.error('Stack:', errorStack);
  
  // In development, log but don't exit for non-critical errors
  if (envConfig.NODE_ENV === 'production') {
    process.exit(1);
  } else {
    logger.warn('Continuing in development mode despite uncaught exception');
  }
});

// Legacy errorMiddleware for backward compatibility
export const errorMiddleware = errorHandler;

// Error middleware object
export const errorMiddlewares = {
  errorHandler,
  catchAsync,
  notFoundHandler,
  AppError,
  errorMiddleware, // Legacy export
};

