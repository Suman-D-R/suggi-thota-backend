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

// Get user's orders (regular users) OR all orders (admin) OR delivery partner orders
router.get('/', (req: any, res: any) => {
  const userRole = req.user?.role;
  // If user is admin, use getAllOrders
  if (userRole === 'admin') {
    return orderController.getAllOrders(req, res);
  }
  // If user is delivery partner, use getDeliveryPartnerOrders
  if (userRole === 'delivery_partner') {
    return orderController.getDeliveryPartnerOrders(req, res);
  }
  // Otherwise, use getUserOrders for regular users
  return orderController.getUserOrders(req, res);
});

// Get order by ID
router.get('/:id', orderController.getOrderById as any);

// Update order status (Admin or Delivery Partner)
router.put('/:id/status', authenticate as any, orderController.updateOrderStatus as any);

// Assign delivery partner (Admin only)
router.post('/:id/assign-delivery-partner', requireAdmin as any, orderController.assignDeliveryPartner as any);

// Collect COD payment (Admin/Delivery Partner)
router.post('/:id/collect-payment', authenticate as any, orderController.collectPayment as any);

export default router;
