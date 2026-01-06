// Store routes
import express from 'express';
import { storeController } from '../controllers/store.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = express.Router();

// Find stores nearby (must come before /:id route)
// Public route - no auth required for checking store availability
router.get('/nearby/search', storeController.findStoresNearby as any);

// Get all stores
router.get('/', authenticate, storeController.getAllStores as any);

// Get store by ID
router.get('/:id', authenticate, storeController.getStoreById as any);

// Create store
router.post('/', authenticate, storeController.createStore as any);

// Update store
router.put('/:id', authenticate, storeController.updateStore as any);

// Delete store
router.delete('/:id', authenticate, storeController.deleteStore as any);

export default router;

