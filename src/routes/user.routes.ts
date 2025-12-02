// User routes
import express from 'express';
import { userController } from '../controllers/user.controller';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware';
import { validationMiddlewares } from '../middlewares/validate.middleware';
import { validators } from '../utils/validators';

const router = express.Router();

// All user routes require authentication
router.use(authenticate);

// Get user profile
router.get('/profile', userController.getProfile as any);

// Update user profile
router.put(
  '/profile',
  validationMiddlewares.handleValidationErrors,
  userController.updateProfile as any
);

// Change password
router.put(
  '/change-password',
  validators.passwordValidation,
  validationMiddlewares.handleValidationErrors,
  userController.changePassword as any
);

// Get user addresses
router.get('/addresses', userController.getAddresses as any);

// Get user orders
router.get(
  '/orders',
  validators.paginationValidation.page,
  validators.paginationValidation.limit,
  validationMiddlewares.handleValidationErrors,
  userController.getOrders as any
);

// Get user statistics
router.get('/stats', userController.getUserStats as any);

// Delete user account
router.delete('/account', userController.deleteAccount as any);

// Admin routes
router.get(
  '/admin/users',
  requireAdmin as any,
  validators.paginationValidation.page,
  validators.paginationValidation.limit,
  validators.searchValidation,
  validationMiddlewares.handleValidationErrors,
  userController.getAllUsers as any
);

router.put(
  '/admin/users/:userId/role',
  requireAdmin as any,
  validators.objectIdValidation('userId'),
  validationMiddlewares.handleValidationErrors,
  userController.updateUserRole as any
);

export default router;

