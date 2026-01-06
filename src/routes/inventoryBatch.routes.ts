// InventoryBatch routes
import express from 'express';
import { inventoryBatchController } from '../controllers/inventoryBatch.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = express.Router();

// Get all inventory batches
router.get('/', authenticate, inventoryBatchController.getAllInventoryBatches as any);

// Get batches by store and product (must come before /:id route)
router.get('/store/:storeId/product/:productId', authenticate, inventoryBatchController.getBatchesByStoreAndProduct as any);

// Get inventory batch by ID
router.get('/:id', authenticate, inventoryBatchController.getInventoryBatchById as any);

// Create inventory batch
router.post('/', authenticate, inventoryBatchController.createInventoryBatch as any);

// Update inventory batch
router.put('/:id', authenticate, inventoryBatchController.updateInventoryBatch as any);

// Delete inventory batch
router.delete('/:id', authenticate, inventoryBatchController.deleteInventoryBatch as any);

export default router;

