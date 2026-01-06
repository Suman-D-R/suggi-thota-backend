// StoreProduct routes
import express from 'express';
import { storeProductController } from '../controllers/storeProduct.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = express.Router();

// Get all store products
router.get('/', authenticate, storeProductController.getAllStoreProducts as any);

// Get store products for a specific store (must come before /:id route)
router.get('/store/:storeId', authenticate, storeProductController.getStoreProducts as any);

// Get store product by ID
router.get('/:id', authenticate, storeProductController.getStoreProductById as any);

// Create store product
router.post('/', authenticate, storeProductController.createStoreProduct as any);

// Update store product
router.put('/:id', authenticate, storeProductController.updateStoreProduct as any);

// Delete store product
router.delete('/:id', authenticate, storeProductController.deleteStoreProduct as any);

export default router;

