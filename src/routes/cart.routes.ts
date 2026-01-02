// Cart routes
import { Router } from 'express';
import { cartController } from '../controllers/cart.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validationMiddlewares } from '../middlewares/validate.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate as any);

// Get user's cart
router.get('/', cartController.getCart as any);

// Add item to cart
router.post(
  '/items',
  ...validationMiddlewares.validateAddCartItem(),
  cartController.addItem as any
);

// Update item quantity in cart
router.put(
  '/items',
  ...validationMiddlewares.validateUpdateCartItem(),
  cartController.updateItem as any
);

// Remove item from cart
router.delete(
  '/items',
  ...validationMiddlewares.validateRemoveCartItem(),
  cartController.removeItem as any
);

// Clear cart
router.delete('/', cartController.clearCart as any);

export default router;
