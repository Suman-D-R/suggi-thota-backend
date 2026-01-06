// Order routes
import { Router } from 'express';
import { orderController } from '../controllers/order.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/admin.middleware';
import { orderLimiter } from '../middlewares/rateLimit.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate as any);

// Create order from cart (with rate limiting)
router.post('/', orderLimiter, orderController.createOrder as any);

// Get user's orders (regular users) OR all orders (admin)
router.get('/', (req: any, res: any) => {
  // If user is admin, use getAllOrders, otherwise use getUserOrders
  if (req.user?.role === 'admin') {
    return orderController.getAllOrders(req, res);
  }
  return orderController.getUserOrders(req, res);
});

// Get order by ID
router.get('/:id', orderController.getOrderById as any);

export default router;
