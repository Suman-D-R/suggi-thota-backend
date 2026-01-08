// Delivery routes
import { Router } from 'express';
import { deliveryController } from '../controllers/delivery.controller';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware';

const router = Router();

// Admin routes for delivery agent management
router.post('/agents', authenticate, requireAdmin as any, deliveryController.createDeliveryAgent);
router.get('/agents', authenticate, requireAdmin as any, deliveryController.getAllDeliveryAgents);
router.get('/agents/:id', authenticate, requireAdmin as any, deliveryController.getDeliveryAgentById);
router.put('/agents/:id', authenticate, requireAdmin as any, deliveryController.updateDeliveryAgent);
router.delete('/agents/:id', authenticate, requireAdmin as any, deliveryController.deleteDeliveryAgent);

export default router;

