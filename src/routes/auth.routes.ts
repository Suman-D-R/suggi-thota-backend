// Authentication routes
import express from 'express';
import { body } from 'express-validator';
import { authController } from '../controllers/auth.controller';
import { validationMiddlewares } from '../middlewares/validate.middleware';
import { rateLimitMiddlewares } from '../middlewares/rateLimit.middleware';
import { validators } from '../utils/validators';
import { authenticate } from '../middlewares/auth.middleware';

const router = express.Router();

// Verify Firebase ID token and login/register (for Google login)
router.post(
  '/verify-firebase-token',
  body('idToken')
    .trim()
    .notEmpty()
    .withMessage('Firebase ID token is required'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  validationMiddlewares.handleValidationErrors,
  authController.verifyFirebaseToken
);

// Send OTP for login/registration
router.post(
  '/send-otp',
  rateLimitMiddlewares.otpLimiter,
  body('phoneNumber')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required')
    .matches(/^\+[1-9]\d{1,14}$/)
    .withMessage('Invalid phone number format. Please use international format (e.g., +919876543210)'),
  validationMiddlewares.handleValidationErrors,
  authController.sendOTP
);

// Verify OTP and login/register
router.post(
  '/verify-otp',
  body('phoneNumber')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required')
    .matches(/^\+[1-9]\d{1,14}$/)
    .withMessage('Invalid phone number format. Please use international format (e.g., +919876543210)'),
  validators.otpValidation('otp'),
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  validationMiddlewares.handleValidationErrors,
  authController.verifyOTP
);

// Register with password
router.post(
  '/register',
  validators.emailValidation('email').optional(),
  validators.phoneValidation('phone').optional(),
  validators.passwordValidation,
  validationMiddlewares.handleValidationErrors,
  authController.register
);

// Login with password
router.post(
  '/login',
  rateLimitMiddlewares.authLimiter,
  validationMiddlewares.handleValidationErrors,
  // Email or phone validation (optional)
  validators.passwordValidation,
  authController.login
);

// Admin login
router.post(
  '/admin/login',
  rateLimitMiddlewares.authLimiter,
  body('loginId')
    .trim()
    .notEmpty()
    .withMessage('Login ID is required'),
  validationMiddlewares.handleValidationErrors,
  authController.adminLogin
);

// Refresh access token
router.post('/refresh-token', authController.refreshToken);

// Logout
router.post('/logout', authController.logout);

// Update user name (authenticated route)
router.put(
  '/update-name',
  authenticate as any,
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  validationMiddlewares.handleValidationErrors,
  authController.updateUserName
);

export default router;

