// Category routes
import { Router } from 'express';
import { categoryController } from '../controllers/category.controller';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware';
import { validationMiddlewares } from '../middlewares/validate.middleware';
import { validators } from '../utils/validators';
import { uploadCategoryImage } from '../middlewares/upload.middleware';

const router = Router();

// Note: GET routes are public for browsing, POST/PUT/DELETE require authentication

// Get all categories
router.get('/', categoryController.getAllCategories as any);

// Get main categories
router.get('/main', categoryController.getMainCategories as any);

// Get categories with products for a store
router.get('/with-products', categoryController.getCategoriesWithProducts as any);

// Get subcategories by parent
router.get(
  '/:parentId/subcategories',
  validators.objectIdValidation('parentId'),
  validationMiddlewares.handleValidationErrors,
  categoryController.getSubcategories as any
);

// Get single category
router.get(
  '/:id',
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  categoryController.getCategoryById as any
);

// Admin only routes for CRUD operations

// Create new category
router.post(
  '/',
  authenticate as any,
  requireAdmin as any,
  uploadCategoryImage as any,
  validators.categoryNameValidation('name'),
  validationMiddlewares.handleValidationErrors,
  categoryController.createCategory as any
);

// Update category
router.put(
  '/:id',
  authenticate as any,
  requireAdmin as any,
  uploadCategoryImage as any,
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  categoryController.updateCategory as any
);

// Delete category (soft delete)
router.delete(
  '/:id',
  authenticate as any,
  requireAdmin as any,
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  categoryController.deleteCategory as any
);

// Hard delete category (permanent)
router.delete(
  '/:id/hard',
  authenticate as any,
  requireAdmin as any,
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  categoryController.hardDeleteCategory as any
);

export default router;
