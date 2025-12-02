// Validation middleware - Express validator error handling
import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

// Handle validation errors
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    console.log('handleValidationErrors', req.body);
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map(error => error.msg);
      const errorDetails = errors.array().map(error => ({
        field: 'param' in error ? error.param : '',
        message: error.msg,
        value: 'value' in error ? error.value : undefined,
      }));

      getLogger().warn('Validation errors:', {
        url: req.url,
        method: req.method,
        errors: errorDetails,
      });

      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errorMessages,
        details: errorDetails,
      });
      return;
    }

    next();
  } catch (error) {
    getLogger().error('Validation middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Validation processing failed',
      error: 'VALIDATION_PROCESSING_ERROR'
    });
  }
};

// Custom validation result handler with custom response
export const validationResponse = (
  customMessage?: string,
  includeDetails: boolean = true
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(error => error.msg);
        const errorDetails = includeDetails
          ? errors.array().map(error => ({
              field: 'param' in error ? error.param : '',
              message: error.msg,
              value: 'value' in error ? error.value : undefined,
            }))
          : undefined;

        getLogger().warn('Validation errors:', {
          url: req.url,
          method: req.method,
          errors: errorDetails || errorMessages,
        });

        res.status(400).json({
          success: false,
          message: customMessage || 'Validation failed',
          errors: errorMessages,
          ...(errorDetails && { details: errorDetails }),
        });
        return;
      }

      next();
    } catch (error) {
      getLogger().error('Validation response middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Validation processing failed',
        error: 'VALIDATION_PROCESSING_ERROR'
      });
    }
  };
};

// Validate specific fields only
export const validateFields = (fields: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const errors = validationResult(req);
      const fieldErrors = errors.array().filter(error => 'param' in error && fields.includes(error.param as string));

      if (fieldErrors.length > 0) {
        const errorMessages = fieldErrors.map(error => error.msg);
        const errorDetails = fieldErrors.map(error => ({
          field: 'param' in error ? error.param : '',
          message: error.msg,
          value: 'value' in error ? error.value : undefined,
        }));

        getLogger().warn('Field validation errors:', {
          url: req.url,
          method: req.method,
          fields,
          errors: errorDetails,
        });

        res.status(400).json({
          success: false,
          message: 'Field validation failed',
          errors: errorMessages,
          details: errorDetails,
        });
        return;
      }

      next();
    } catch (error) {
      getLogger().error('Field validation middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Field validation processing failed',
        error: 'FIELD_VALIDATION_PROCESSING_ERROR'
      });
    }
  };
};

// Skip validation if condition is met
export const conditionalValidation = (condition: (req: Request) => boolean) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (condition(req)) {
      // Skip validation and continue
      return next();
    }

    // Continue with validation
    handleValidationErrors(req, res, next);
  };
};

// Validate request body exists
export const requireBody = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.body || Object.keys(req.body).length === 0) {
    res.status(400).json({
      success: false,
      message: 'Request body is required',
      error: 'MISSING_REQUEST_BODY'
    });
    return;
  }

  next();
};

// Validate content type
export const requireJsonContentType = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const contentType = req.headers['content-type'];

  if (!contentType || !contentType.includes('application/json')) {
    res.status(400).json({
      success: false,
      message: 'Content-Type must be application/json',
      error: 'INVALID_CONTENT_TYPE'
    });
    return;
  }

  next();
};

// Validation middleware for express-validator chains
export const validateWithRules = (...validations: ValidationChain[]) => {
  return [
    ...validations,
    handleValidationErrors,
  ];
};

// Legacy validateMiddleware for backward compatibility
export const validateMiddleware = (...validations: ValidationChain[]) => {
  return validateWithRules(...validations);
};

// Validation middleware object
export const validationMiddlewares = {
  handleValidationErrors,
  validationResponse,
  validateFields,
  conditionalValidation,
  requireBody,
  requireJsonContentType,
  validateWithRules,
  validateMiddleware, // Legacy export
};

