// Product routes
import { Router } from 'express';
import { productController } from '../controllers/product.controller';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware';
import { validationMiddlewares } from '../middlewares/validate.middleware';
import { validators } from '../utils/validators';
import { uploadProductImages } from '../middlewares/upload.middleware';

const router = Router();

// Public routes (no auth required for browsing)
router.get(
  '/',
  validators.paginationValidation.page(),
  validators.paginationValidation.limit(),
  validationMiddlewares.handleValidationErrors,
  productController.getAllProducts as any
);

// Get products stats (total and active counts) - admin only - must come before :id route
router.get(
  '/stats',
  authenticate as any,
  requireAdmin as any,
  productController.getProductsStats as any
);

router.get(
  '/:id',
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  productController.getProductById as any
);

// Admin only routes
router.post(
  '/',
  authenticate as any,
  requireAdmin as any,
  uploadProductImages,
  validators.productNameValidation('name'),
  validationMiddlewares.handleValidationErrors,
  productController.createProduct as any
);

router.put(
  '/:id',
  authenticate as any,
  requireAdmin as any,
  uploadProductImages,
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  productController.updateProduct as any
);

router.delete(
  '/:id',
  authenticate as any,
  requireAdmin as any,
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  productController.deleteProduct as any
);

// Hard delete (permanent)
router.delete(
  '/:id/hard',
  authenticate as any,
  requireAdmin as any,
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  productController.hardDeleteProduct as any
);

export default router;
