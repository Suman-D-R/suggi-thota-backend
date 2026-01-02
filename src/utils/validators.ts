// Validation utility functions
import { body, param, query, ValidationChain } from 'express-validator';

// Common validation rules
export const validators = {
  // User validation
  phoneValidation: (field: string = 'phone'): ValidationChain =>
    body(field)
      .trim()
      .isMobilePhone('any', { strictMode: false })
      .withMessage('Please provide a valid phone number'),

  emailValidation: (field: string = 'email'): ValidationChain =>
    body(field)
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),

  passwordValidation: (field: string = 'password'): ValidationChain =>
    body(field)
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long'),

  otpValidation: (field: string = 'otp'): ValidationChain =>
    body(field)
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage('OTP must be 6 digits'),

  // Product validation
  productNameValidation: (field: string = 'name'): ValidationChain =>
    body(field)
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Product name must be between 2 and 100 characters'),

  priceValidation: (field: string = 'price'): ValidationChain =>
    body(field)
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Price must be a positive number'),

  descriptionValidation: (field: string = 'description'): ValidationChain =>
    body(field)
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Description must not exceed 1000 characters'),

  // Category validation
  categoryNameValidation: (field: string = 'name'): ValidationChain =>
    body(field)
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Category name must be between 2 and 50 characters'),

  // Address validation
  addressValidation: {
    street: (field: string = 'street'): ValidationChain =>
      body(field)
        .trim()
        .isLength({ min: 5, max: 200 })
        .withMessage('Street address must be between 5 and 200 characters'),

    city: (field: string = 'city'): ValidationChain =>
      body(field)
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('City must be between 2 and 50 characters'),

    state: (field: string = 'state'): ValidationChain =>
      body(field)
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('State must be between 2 and 50 characters'),

    pincode: (field: string = 'pincode'): ValidationChain =>
      body(field)
        .isPostalCode('IN')
        .withMessage('Please provide a valid Indian pincode'),

    country: (field: string = 'country'): ValidationChain =>
      body(field)
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Country must be between 2 and 50 characters'),
  },

  // Order validation
  quantityValidation: (field: string = 'quantity'): ValidationChain =>
    body(field)
      .isInt({ min: 1, max: 100 })
      .withMessage('Quantity must be between 1 and 100'),

  // ID validation
  objectIdValidation: (field: string): ValidationChain =>
    param(field)
      .isMongoId()
      .withMessage(`Invalid ${field} ID format`),

  // Pagination validation
  paginationValidation: {
    page: (field: string = 'page'): ValidationChain =>
      query(field)
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),

    limit: (field: string = 'limit'): ValidationChain =>
      query(field)
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
  },

  // Search validation
  searchValidation: (field: string = 'search'): ValidationChain =>
    query(field)
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Search query must be between 1 and 100 characters'),

  // Generic string validation
  stringValidation: (field: string, options?: { required?: boolean; minLength?: number; maxLength?: number }): ValidationChain => {
    const chain = body(field).trim();
    if (options?.required) {
      chain.notEmpty().withMessage(`${field} is required`);
    } else {
      chain.optional();
    }
    if (options?.minLength) {
      chain.isLength({ min: options.minLength }).withMessage(`${field} must be at least ${options.minLength} characters`);
    }
    if (options?.maxLength) {
      chain.isLength({ max: options.maxLength }).withMessage(`${field} must not exceed ${options.maxLength} characters`);
    }
    return chain;
  },
};

// Custom validation functions
export const customValidators = {
  isValidPhone: (phone: string): boolean => {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
  },

  isValidPincode: (pincode: string): boolean => {
    const pincodeRegex = /^[1-9][0-9]{5}$/;
    return pincodeRegex.test(pincode);
  },

  isValidPrice: (price: number): boolean => {
    return typeof price === 'number' && price >= 0 && price <= 100000;
  },

  isValidRating: (rating: number): boolean => {
    return typeof rating === 'number' && rating >= 1 && rating <= 5;
  },
};

