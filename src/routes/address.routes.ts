// Address routes
import { Router } from 'express';
import { addressController } from '../controllers/address.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate as any);

// Get all user addresses
router.get('/', addressController.getAddresses as any);

// Get address by ID
router.get('/:id', addressController.getAddressById as any);

// Create new address
router.post('/', addressController.createAddress as any);

// Update address
router.put('/:id', addressController.updateAddress as any);

// Delete address
router.delete('/:id', addressController.deleteAddress as any);

// Set address as default
router.patch('/:id/default', addressController.setDefaultAddress as any);

export default router;
