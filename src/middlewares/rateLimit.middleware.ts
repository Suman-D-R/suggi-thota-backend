// Rate limiting middleware
import rateLimit from 'express-rate-limit';
import { envConfig } from '../config/env';

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: envConfig.RATE_LIMIT_WINDOW_MS, // 15 minutes
  max: envConfig.RATE_LIMIT_MAX_REQUESTS, // Limit each IP to 1000 requests per windowMs (increased for e-commerce)
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    error: 'RATE_LIMIT_EXCEEDED',
    retryAfter: Math.ceil(envConfig.RATE_LIMIT_WINDOW_MS / 1000), // seconds
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests from this IP, please try again later.',
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(envConfig.RATE_LIMIT_WINDOW_MS / 1000),
    });
  },
});

// Strict rate limiter for authentication endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 15 requests per windowMs for auth endpoints (increased for e-commerce, still secure)
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
    error: 'AUTH_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts, please try again later.',
      error: 'AUTH_RATE_LIMIT_EXCEEDED',
      retryAfter: 15 * 60, // 15 minutes in seconds
    });
  },
});

// OTP request rate limiter
export const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // Limit each IP to 10 OTP requests per windowMs (increased for e-commerce)
  message: {
    success: false,
    message: 'Too many OTP requests, please try again later.',
    error: 'OTP_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many OTP requests, please try again later.',
      error: 'OTP_RATE_LIMIT_EXCEEDED',
      retryAfter: 10 * 60, // 10 minutes in seconds
    });
  },
});

// Order creation rate limiter
export const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // Limit each IP to 100 orders per hour (increased for e-commerce - allows bulk purchases)
  message: {
    success: false,
    message: 'Too many orders from this IP, please try again later.',
    error: 'ORDER_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many orders from this IP, please try again later.',
      error: 'ORDER_RATE_LIMIT_EXCEEDED',
      retryAfter: 60 * 60, // 1 hour in seconds
    });
  },
});

// File upload rate limiter
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // Limit each IP to 100 uploads per hour (increased for e-commerce - product images, admin uploads)
  message: {
    success: false,
    message: 'Too many file uploads, please try again later.',
    error: 'UPLOAD_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many file uploads, please try again later.',
      error: 'UPLOAD_RATE_LIMIT_EXCEEDED',
      retryAfter: 60 * 60, // 1 hour in seconds
    });
  },
});

// Search rate limiter
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // Limit each IP to 200 searches per minute (increased for e-commerce - users search frequently)
  message: {
    success: false,
    message: 'Too many search requests, please try again later.',
    error: 'SEARCH_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many search requests, please try again later.',
      error: 'SEARCH_RATE_LIMIT_EXCEEDED',
      retryAfter: 60, // 1 minute in seconds
    });
  },
});

// Create custom rate limiter
export const createRateLimiter = (
  windowMs: number,
  max: number,
  message: string = 'Too many requests, please try again later.',
  errorCode: string = 'RATE_LIMIT_EXCEEDED'
) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message,
      error: errorCode,
      retryAfter: Math.ceil(windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message,
        error: errorCode,
        retryAfter: Math.ceil(windowMs / 1000),
      });
    },
  });
};

// Legacy rateLimitMiddleware for backward compatibility
export const rateLimitMiddleware = apiLimiter;

// Rate limiting middleware object
export const rateLimitMiddlewares = {
  apiLimiter,
  authLimiter,
  otpLimiter,
  orderLimiter,
  uploadLimiter,
  searchLimiter,
  createRateLimiter,
  rateLimitMiddleware, // Legacy export
};

