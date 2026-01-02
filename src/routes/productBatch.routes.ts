// ProductBatch routes
import { Router } from 'express';
import { productBatchController } from '../controllers/productBatch.controller';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware';
import { validationMiddlewares } from '../middlewares/validate.middleware';
import { validators } from '../utils/validators';

const router = Router();

// All routes require admin authentication
router.use(authenticate as any);
router.use(requireAdmin as any);

// Get all batches (with pagination and filters)
router.get(
  '/',
  validators.paginationValidation.page(),
  validators.paginationValidation.limit(),
  validationMiddlewares.handleValidationErrors,
  productBatchController.getAllBatches as any
);

// Get batches by product
router.get(
  '/product/:productId',
  validators.objectIdValidation('productId'),
  validationMiddlewares.handleValidationErrors,
  productBatchController.getBatchesByProduct as any
);

// Get single batch by ID
router.get(
  '/:id',
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  productBatchController.getBatchById as any
);

// Create new batch
router.post(
  '/',
  productBatchController.createBatch as any
);

// Update batch
router.put(
  '/:id',
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  productBatchController.updateBatch as any
);

// Delete batch
router.delete(
  '/:id',
  validators.objectIdValidation('id'),
  validationMiddlewares.handleValidationErrors,
  productBatchController.deleteBatch as any
);

export default router;

