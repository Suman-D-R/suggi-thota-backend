// Order routes
import { Router } from 'express';
import { orderController } from '../controllers/order.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { orderLimiter } from '../middlewares/rateLimit.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate as any);

// Create order from cart (with rate limiting)
router.post('/', orderLimiter, orderController.createOrder as any);

// Get user's orders
router.get('/', orderController.getUserOrders as any);

// Get order by ID
router.get('/:id', orderController.getOrderById as any);

export default router;
