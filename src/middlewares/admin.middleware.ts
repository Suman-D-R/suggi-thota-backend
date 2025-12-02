// Admin middleware - Check admin role
import { Request, Response, NextFunction } from 'express';
import { USER_ROLES } from '../constants/roles';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email?: string;
    phone?: string;
    role: string;
  };
}

// Admin-only access middleware
export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'NOT_AUTHENTICATED'
      });
      return;
    }

    if (req.user.role !== USER_ROLES.ADMIN) {
      res.status(403).json({
        success: false,
        message: 'Admin access required',
        error: 'ADMIN_ACCESS_REQUIRED'
      });
      return;
    }

    next();
  } catch (error) {
    getLogger().error('Admin middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Admin verification failed',
      error: 'ADMIN_CHECK_ERROR'
    });
  }
};

// Super admin check (can be extended for different admin levels)
export const requireSuperAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'NOT_AUTHENTICATED'
      });
      return;
    }

    if (req.user.role !== USER_ROLES.ADMIN) {
      res.status(403).json({
        success: false,
        message: 'Super admin access required',
        error: 'SUPER_ADMIN_ACCESS_REQUIRED'
      });
      return;
    }

    // Additional super admin checks can be added here
    // For example, checking a superAdmin flag in the user model

    next();
  } catch (error) {
    getLogger().error('Super admin middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Super admin verification failed',
      error: 'SUPER_ADMIN_CHECK_ERROR'
    });
  }
};

// Admin or specific permission check
export const requireAdminOrPermission = (permission: string) => {
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

      // Admin has all permissions
      if (req.user.role === USER_ROLES.ADMIN) {
        return next();
      }

      // Check for specific permission (this would require a permissions system)
      // For now, just deny access
      res.status(403).json({
        success: false,
        message: `Permission '${permission}' or admin access required`,
        error: 'PERMISSION_DENIED'
      });
    } catch (error) {
      getLogger().error('Permission middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Permission verification failed',
        error: 'PERMISSION_CHECK_ERROR'
      });
    }
  };
};

// Legacy adminMiddleware for backward compatibility
export const adminMiddleware = requireAdmin;

// Admin middleware object
export const adminMiddlewares = {
  requireAdmin,
  requireSuperAdmin,
  requireAdminOrPermission,
  adminMiddleware, // Legacy export
};

