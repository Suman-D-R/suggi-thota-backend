// Validation middleware - Express validator error handling
import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain, body } from 'express-validator';
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

// Cart validation functions
// Custom middleware to validate variant fields
const validateVariantFields = (req: Request, res: Response, next: NextFunction): void => {
  const errors: Array<{ field: string; message: string }> = [];
  console.log('validateVariantFields', req.body);
  
  // Validate size
  const size = req.body.size;
  if (size === undefined || size === null || size === '') {
    errors.push({ field: 'size', message: 'Size is required' });
  } else {
    const numValue = typeof size === 'string' ? parseFloat(size) : size;
    if (isNaN(numValue) || numValue <= 0) {
      errors.push({ field: 'size', message: 'Size must be a positive number' });
    } else {
      req.body.size = numValue;
    }
  }
  
  // Validate unit
  const unit = req.body.unit;
  if (!unit || unit === '') {
    errors.push({ field: 'unit', message: 'Unit is required' });
  } else {
    const validUnits = ['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'];
    if (!validUnits.includes(unit)) {
      errors.push({ field: 'unit', message: 'Invalid unit' });
    } else {
      req.body.unit = unit;
    }
  }
  
  if (errors.length > 0) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.map(e => e.message),
      details: errors,
    });
    return;
  }
  
  next();
};

// Validation for adding item to cart
export const validateAddCartItem = () => {
  return [
    body('productId')
      .notEmpty()
      .withMessage('Product ID is required')
      .isMongoId()
      .withMessage('Invalid product ID format'),
    validateVariantFields,
    body('quantity')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Quantity must be between 1 and 100'),
    body('price')
      .notEmpty()
      .withMessage('Price is required')
      .isFloat({ min: 0 })
      .withMessage('Price must be a positive number'),
    handleValidationErrors,
  ];
};

// Validation for updating item in cart
export const validateUpdateCartItem = () => {
  return [
    body('productId')
      .notEmpty()
      .withMessage('Product ID is required')
      .isMongoId()
      .withMessage('Invalid product ID format'),
    validateVariantFields,
    body('quantity')
      .notEmpty()
      .withMessage('Quantity is required')
      .isInt({ min: 0, max: 100 })
      .withMessage('Quantity must be between 0 and 100'),
    handleValidationErrors,
  ];
};

// Custom middleware to validate optional variant fields (for remove operations)
const validateOptionalVariantFields = (req: Request, res: Response, next: NextFunction): void => {
  // Validate size if provided
  const size = req.body.size;
  if (size !== undefined && size !== null && size !== '') {
    const numValue = typeof size === 'string' ? parseFloat(size) : size;
    if (isNaN(numValue) || numValue <= 0) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: ['Size must be a positive number'],
        details: [{ field: 'size', message: 'Size must be a positive number' }],
      });
      return;
    }
    req.body.size = numValue;
  }
  
  // Validate unit if provided
  const unit = req.body.unit;
  if (unit && unit !== '') {
    const validUnits = ['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'];
    if (!validUnits.includes(unit)) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: ['Invalid unit'],
        details: [{ field: 'unit', message: 'Invalid unit' }],
      });
      return;
    }
    req.body.unit = unit;
  }
  
  next();
};

// Validation for removing item from cart
export const validateRemoveCartItem = () => {
  return [
    body('productId')
      .notEmpty()
      .withMessage('Product ID is required')
      .isMongoId()
      .withMessage('Invalid product ID format'),
    validateOptionalVariantFields,
    handleValidationErrors,
  ];
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
  validateAddCartItem,
  validateUpdateCartItem,
  validateRemoveCartItem,
};

