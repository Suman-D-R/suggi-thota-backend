// Routes index - Centralized route registration
import express, { Express } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import productRoutes from './product.routes';
import categoryRoutes from './category.routes';
import cartRoutes from './cart.routes';
import orderRoutes from './order.routes';
import addressRoutes from './address.routes';
import deliveryRoutes from './delivery.routes';
import heroBannerRoutes from './heroBanner.routes';
import storeRoutes from './store.routes';
import storeProductRoutes from './storeProduct.routes';
import inventoryBatchRoutes from './inventoryBatch.routes';

/**
 * Register all API routes with the Express app
 * @param app - Express application instance
 */
export const registerRoutes = (app: Express): void => {
  // API info endpoint
  app.get('/api', (req, res) => {
    res.json({
      success: true,
      message: 'Vitura API',
      version: '1.0.0',
      documentation: '/api/docs',
    });
  });

  // Register all route modules
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/addresses', addressRoutes);
  app.use('/api/deliveries', deliveryRoutes);
  app.use('/api/hero-banners', heroBannerRoutes);
  app.use('/api/stores', storeRoutes);
  app.use('/api/store-products', storeProductRoutes);
  app.use('/api/inventory-batches', inventoryBatchRoutes);
};

// Export individual routes for direct access if needed
export {
  authRoutes,
  userRoutes,
  productRoutes,
  categoryRoutes,
  cartRoutes,
  orderRoutes,
  addressRoutes,
  deliveryRoutes,
  heroBannerRoutes,
  storeRoutes,
  storeProductRoutes,
  inventoryBatchRoutes,
};

export default registerRoutes;

