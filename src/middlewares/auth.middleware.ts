// Authentication middleware - JWT token verification
import { Request, Response, NextFunction } from 'express';
import { jwtUtils } from '../utils/jwt';
import { User } from '../models/user.model';
import { USER_ROLES } from '../constants/roles';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    email?: string;
    phone?: string;
    role: string;
  };
}

// Type guard to check if request is authenticated
export function isAuthenticatedRequest(req: Request): req is AuthenticatedRequest {
  return req.user !== undefined;
}

// Authentication middleware
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        success: false,
        message: 'Access token is required',
        error: 'MISSING_TOKEN'
      });
      return;
    }

    const token = jwtUtils.extractTokenFromHeader(authHeader);

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Invalid token format',
        error: 'INVALID_TOKEN_FORMAT'
      });
      return;
    }

    // Verify access token
    const decoded = jwtUtils.verifyAccessToken(token);

    if (!decoded) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
        error: 'INVALID_TOKEN'
      });
      return;
    }

    // Check if user exists and is active
    const user = await User.findById(decoded.userId);

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'User not found',
        error: 'USER_NOT_FOUND'
      });
      return;
    }

    if (!user.isActive) {
      res.status(401).json({
        success: false,
        message: 'Account is deactivated',
        error: 'ACCOUNT_DEACTIVATED'
      });
      return;
    }

    // Attach user to request object
    req.user = {
      userId: user._id.toString(),
      email: user.email,
      phone: user.phone,
      role: user.role,
    };

    // Update last login
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    next();
  } catch (error) {
    getLogger().error('Authentication middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed',
      error: 'AUTHENTICATION_ERROR'
    });
  }
};

// Role-based authorization middleware
export const authorize = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'NOT_AUTHENTICATED'
        });
        return;
      }

      if (!allowedRoles.includes(req.user.role)) {
        res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
          error: 'INSUFFICIENT_PERMISSIONS'
        });
        return;
      }

      next();
    } catch (error) {
      getLogger().error('Authorization middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Authorization failed',
        error: 'AUTHORIZATION_ERROR'
      });
    }
  };
};

// Admin only middleware
export const requireAdmin = authorize(USER_ROLES.ADMIN);

// Delivery partner only middleware
export const requireDeliveryPartner = authorize(USER_ROLES.DELIVERY_PARTNER);

// Admin or delivery partner middleware
export const requireAdminOrDeliveryPartner = authorize(
  USER_ROLES.ADMIN,
  USER_ROLES.DELIVERY_PARTNER
);

// Optional authentication (doesn't fail if no token)
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      // No token provided, continue without authentication
      return next();
    }

    const token = jwtUtils.extractTokenFromHeader(authHeader);

    if (!token) {
      // Invalid token format, continue without authentication
      return next();
    }

    const decoded = jwtUtils.verifyAccessToken(token);

    if (decoded) {
      const user = await User.findById(decoded.userId);

      if (user && user.isActive) {
        req.user = {
          userId: user._id.toString(),
          email: user.email,
          phone: user.phone,
          role: user.role,
        };
      }
    }

    next();
  } catch (error) {
    // Silently fail and continue without authentication
    getLogger().debug('Optional authentication failed:', error);
    next();
  }
};

// Middleware to check if user owns the resource
export const requireOwnership = (userIdField: string = 'userId') => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      const resourceUserId = req.params[userIdField] || req.body[userIdField];

      if (!resourceUserId) {
        res.status(400).json({
          success: false,
          message: 'Resource user ID not found',
          error: 'MISSING_RESOURCE_USER_ID'
        });
        return;
      }

      if (req.user.userId !== resourceUserId && req.user.role !== USER_ROLES.ADMIN) {
        res.status(403).json({
          success: false,
          message: 'Access denied: resource ownership required',
          error: 'OWNERSHIP_REQUIRED'
        });
        return;
      }

      next();
    } catch (error) {
      getLogger().error('Ownership check middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Ownership verification failed',
        error: 'OWNERSHIP_CHECK_ERROR'
      });
    }
  };
};

// Legacy authMiddleware for backward compatibility
export const authMiddleware = authenticate;

// Export middleware object
export const authMiddlewares = {
  authenticate,
  authorize,
  requireAdmin,
  requireDeliveryPartner,
  requireAdminOrDeliveryPartner,
  optionalAuth,
  requireOwnership,
  authMiddleware, // Legacy export
};

