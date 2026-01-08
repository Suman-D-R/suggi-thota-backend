/**
 * Migration script to fix orders missing storeId
 * 
 * This script attempts to recover storeId for orders that don't have it:
 * 1. Try to get storeId from the user's cart (if cart still exists)
 * 2. Try to get storeId from store products referenced in order items
 * 3. Default to the first active store if nothing else works
 * 
 * Usage: ts-node src/scripts/fixOrdersMissingStoreId.ts
 */

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db';
import { Order } from '../models/order.model';
import { Cart } from '../models/cart.model';
import { Store } from '../models/store.model';
import { StoreProduct } from '../models/storeProduct.model';
import { logger } from '../utils/logger';

async function fixOrdersMissingStoreId() {
  try {
    // Connect to database
    await connectDB();
    console.log('Connected to MongoDB');

    // Find all orders without storeId
    // Query using $or with conditions that avoid ObjectId casting for empty strings
    // We'll use $exists and $in to avoid the casting issue
    const ordersWithoutStoreId = await Order.find({
      $or: [
        { storeId: { $exists: false } },
        { storeId: null },
        // For empty strings, we need to check them differently to avoid casting
        // We'll handle this by checking if storeId is not a valid ObjectId
      ]
    }).lean();
    
    // Also filter out orders with empty string storeId or invalid ObjectIds
    const filteredOrders = ordersWithoutStoreId.filter((order: any) => {
      if (!order.storeId) return true;
      if (typeof order.storeId === 'string' && order.storeId.trim() === '') return true;
      if (!mongoose.Types.ObjectId.isValid(order.storeId)) return true;
      return false;
    });

    console.log(`Found ${filteredOrders.length} orders without storeId`);

    if (filteredOrders.length === 0) {
      console.log('No orders to fix. Exiting.');
      await disconnectDB();
      return;
    }

    // Get default store (first active store)
    const defaultStore = await Store.findOne({ isActive: true });
    if (!defaultStore) {
      console.error('No active store found. Cannot set default storeId.');
      await disconnectDB();
      return;
    }
    console.log(`Default store: ${defaultStore.name} (${defaultStore._id})`);

    let fixedCount = 0;
    let failedCount = 0;

    for (const order of filteredOrders) {
      let storeIdToUse: mongoose.Types.ObjectId | null = null;

      const orderNumber = order.orderNumber || order._id.toString();
      
      // Strategy 1: Try to get storeId from cart
      try {
        const cart = await Cart.findOne({ userId: order.user });
        if (cart && cart.storeId) {
          storeIdToUse = cart.storeId as mongoose.Types.ObjectId;
          console.log(`  Order ${orderNumber}: Found storeId from cart: ${storeIdToUse}`);
        }
      } catch (error) {
        // Continue to next strategy
      }

      // Strategy 2: Try to get storeId from store products in order items
      if (!storeIdToUse && order.items && order.items.length > 0) {
        try {
          // Get product IDs from order items
          const productIds = order.items.map((item: any) => item.product);
          
          // Find store products that contain these products
          const storeProducts = await StoreProduct.find({
            product: { $in: productIds }
          }).limit(1);

          if (storeProducts.length > 0 && storeProducts[0].storeId) {
            storeIdToUse = storeProducts[0].storeId as mongoose.Types.ObjectId;
            console.log(`  Order ${orderNumber}: Found storeId from store products: ${storeIdToUse}`);
          }
        } catch (error) {
          // Continue to next strategy
        }
      }

      // Strategy 3: Use default store
      if (!storeIdToUse) {
        storeIdToUse = defaultStore._id;
        console.log(`  Order ${orderNumber}: Using default store: ${storeIdToUse}`);
      }

      // Update the order (use findByIdAndUpdate since we used .lean())
      try {
        await Order.findByIdAndUpdate(
          order._id,
          { storeId: storeIdToUse },
          { new: true }
        );
        fixedCount++;
        console.log(`  ✓ Fixed order ${orderNumber}`);
      } catch (error: any) {
        failedCount++;
        console.error(`  ✗ Failed to fix order ${orderNumber}:`, error.message);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Total orders processed: ${filteredOrders.length}`);
    console.log(`Successfully fixed: ${fixedCount}`);
    console.log(`Failed: ${failedCount}`);

    await disconnectDB();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    logger.error('Error fixing orders:', error);
    console.error('Error fixing orders:', error);
    await disconnectDB();
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  fixOrdersMissingStoreId()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export default fixOrdersMissingStoreId;

