// Order controller
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Order } from '../models/order.model';
import { Cart } from '../models/cart.model';
import { Product } from '../models/product.model';
import { StoreProduct } from '../models/storeProduct.model';
import { InventoryBatch } from '../models/inventoryBatch.model';
import { Address } from '../models/address.model';
import { responseUtils } from '../utils/response';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

/**
 * Check stock availability for a product variant at a store
 */
async function checkStockAvailability(
  storeId: string,
  productId: string,
  variantSku: string,
  requiredQuantity: number
): Promise<{ available: number; sufficient: boolean }> {
  // Check StoreProduct for availability
  const storeProduct = await StoreProduct.findOne({
    storeId,
    productId,
    isActive: true,
  }).lean();

  if (!storeProduct) {
    return { available: 0, sufficient: false };
  }

  // Check if variant exists and is available
  const variant = storeProduct.variants.find((v) => v.sku === variantSku);
  if (!variant || !variant.isAvailable) {
    return { available: 0, sufficient: false };
  }

  // Get total stock from InventoryBatches (only active, non-expired batches)
  // First, check if product uses shared stock
  const allProductBatches = await InventoryBatch.find({
    storeId,
    productId,
    status: 'active',
  })
    .sort({ createdAt: 1 }) // FIFO order
    .lean();

  // Check if any batch uses shared stock
  const hasSharedStock = allProductBatches.some((batch: any) => batch.usesSharedStock === true);

  let batches: any[];
  if (hasSharedStock) {
    // Shared stock: Get all active shared stock batches (ignore variantSku)
    batches = allProductBatches.filter((batch: any) => {
      const isExpired = batch.expiryDate && new Date() > batch.expiryDate;
      return batch.usesSharedStock === true && !isExpired;
    });
  } else {
    // Variant-specific stock: Get batches matching the variant SKU
    batches = allProductBatches.filter((batch: any) => {
      const isExpired = batch.expiryDate && new Date() > batch.expiryDate;
      return batch.variantSku === variantSku && !isExpired;
    });
  }

  const totalAvailable = batches.reduce((sum, batch) => {
    return sum + (batch.availableQuantity || 0);
  }, 0);

  return {
    available: totalAvailable,
    sufficient: totalAvailable >= requiredQuantity,
  };
}

/**
 * Create order from cart
 */
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  // For development: Skip transactions entirely (MongoDB transactions require replica set)
  // In production with replica set, set ENABLE_TRANSACTIONS=true
  const useTransaction = process.env.ENABLE_TRANSACTIONS === 'true';
  let session: mongoose.ClientSession | null = null;
  
  if (useTransaction) {
    try {
      session = await mongoose.startSession();
      await session.startTransaction();
      getLogger().info('Transaction started for order creation');
    } catch (error: any) {
      getLogger().warn('Failed to start transaction, proceeding without:', error.message);
      if (session) {
        try {
          session.endSession();
        } catch (e) {
          // Ignore
        }
        session = null;
      }
    }
  }

  // Helper function to add session to query if available
  const withSession = (query: any): any => {
    if (useTransaction && session) {
      return query.session(session);
    }
    return query;
  };

  try {
    const userId = (req as any).user?.userId;
    const {
      deliveryAddressId,
      paymentMethod,
      couponCode,
      deliveryFee = 50,
      tax = 0,
      discount = 0,
      deliveryInstructions,
      orderNotes,
    } = req.body;

    if (!userId) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!deliveryAddressId) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.badRequestResponse(res, 'Delivery address is required');
      return;
    }

    if (!paymentMethod) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.badRequestResponse(res, 'Payment method is required');
      return;
    }

    // Validate payment method
    const validPaymentMethods = ['cod', 'online', 'wallet'];
    if (!validPaymentMethods.includes(paymentMethod)) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.badRequestResponse(
        res,
        `Invalid payment method. Must be one of: ${validPaymentMethods.join(', ')}`
      );
      return;
    }

    // Handle address - check if deliveryAddressId is a valid ObjectId
    let address;
    const isValidObjectId = mongoose.Types.ObjectId.isValid(deliveryAddressId);

    if (isValidObjectId) {
      // Try to find existing address by ID
      address = await withSession(
        Address.findOne({
          _id: deliveryAddressId,
          user: userId,
        })
      );

      if (!address) {
        if (useTransaction && session) {
          await session.abortTransaction();
          session.endSession();
        }
        responseUtils.notFoundResponse(res, 'Delivery address not found');
        return;
      }
    } else {
      // Not a valid ObjectId - check if address details are provided
      const {
        addressDetails,
      } = req.body;

      if (!addressDetails) {
        if (useTransaction && session) {
          await session.abortTransaction();
          session.endSession();
        }
        responseUtils.badRequestResponse(
          res,
          'Invalid address ID. Please provide address details or a valid address ID.'
        );
        return;
      }

      // Create address from details
      // Parse address string to extract components
      const addressString = addressDetails.address || '';
      const addressParts = addressString.split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0);

      // Default values
      let city = 'Unknown';
      let state = 'Unknown';
      let street = addressString;

      // Try to extract structured information from address string
      // Common format: "Street, City, State" or "Street, City"
      if (addressParts.length >= 2) {
        street = addressParts[0] || addressString;

        // Last part is usually state or city
        if (addressParts.length >= 3) {
          city = addressParts[addressParts.length - 2] || 'Unknown';
          state = addressParts[addressParts.length - 1] || 'Unknown';
        } else {
          city = addressParts[addressParts.length - 1] || 'Unknown';
        }
      }

      // Create new address
      address = new Address({
        user: userId,
        type: addressDetails.label?.toLowerCase() === 'work' ? 'work' : 
              addressDetails.label?.toLowerCase() === 'other' ? 'other' : 'home',
        label: addressDetails.label || 'Home',
        street: street,
        city: city,
        state: state,
        country: addressDetails.country || 'India',
        contactName: addressDetails.contactName || 'User',
        contactPhone: addressDetails.contactPhone || '',
        isDefault: addressDetails.isDefault || false,
        isActive: true,
      });

      if (useTransaction && session) {
        await address.save({ session });
      } else {
        await address.save();
      }
    }

    // Get user's cart (storeId should be in request body)
    const storeId = req.body.storeId;
    if (!storeId) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.badRequestResponse(res, 'Store ID is required');
      return;
    }

    const cart = await withSession(
      Cart.findOne({ userId, storeId }).populate('items.productId')
    );

    getLogger().info(`Cart lookup for userId: ${userId}, storeId: ${storeId}, found: ${cart ? 'yes' : 'no'}, items: ${cart?.items?.length || 0}`);

    if (!cart) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.badRequestResponse(res, 'Cart not found. Please add items to cart first.');
      return;
    }

    if (!cart.items || cart.items.length === 0) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.badRequestResponse(res, 'Cart is empty. Please add items to cart before placing order.');
      return;
    }

    // Validate stock availability and prepare order items
    const orderItems: any[] = [];
    const stockErrors: string[] = [];
    const allBatchSplits: any[] = [];

    for (const cartItem of cart.items) {
      // Extract productId - handle both populated and non-populated cases
      let productId: string;
      let product: any;
      
      if (typeof cartItem.productId === 'object' && cartItem.productId !== null && '_id' in cartItem.productId) {
        // Product is populated, extract _id
        product = cartItem.productId;
        productId = (cartItem.productId as any)._id?.toString() || String(cartItem.productId);
      } else {
        // ProductId is already an ObjectId or string
        productId = String(cartItem.productId);
        // Get product to verify it exists
        product = await withSession(Product.findById(productId));
      }
      
      if (!product) {
        stockErrors.push(`Product ${productId} is no longer available`);
        continue;
      }
      
      const variantSku = cartItem.variantSku;
      const quantity = cartItem.quantity;

      // Get StoreProduct for pricing and variant info
      const storeProduct = await withSession(
        StoreProduct.findOne({
          storeId,
          productId,
          isActive: true,
        })
      );

      if (!storeProduct) {
        stockErrors.push(
          `${product.name} is not available at this store`
        );
        continue;
      }

      // Find the variant in the store product
      const variant = storeProduct.variants.find((v: any) => v.sku === variantSku);
      if (!variant || !variant.isAvailable) {
        stockErrors.push(
          `${product.name} (${variantSku}) is not available at this store`
        );
        continue;
      }

      const size = variant.size || 0;
      const unit = variant.unit || 'piece';
      const mrp = variant.mrp;

      // Use variant selling price (with discount applied)
      const price = variant.sellingPrice;
      const finalPrice = price - (variant.discount || 0);

      // Check stock availability
      const stockCheck = await checkStockAvailability(
        storeId,
        productId,
        variantSku,
        quantity
      );

      if (!stockCheck.sufficient) {
        stockErrors.push(
          `${product.name} (${size} ${unit}) - Required: ${quantity}, Available: ${stockCheck.available}`
        );
        continue;
      }

      // Allocate inventory batches (FIFO) - only active, non-expired batches
      // First check if product uses shared stock
      const allProductBatches = await withSession(
        InventoryBatch.find({
          storeId,
          productId,
          status: 'active',
        }).sort({ createdAt: 1 })
      );

      // Check if any batch uses shared stock
      const hasSharedStock = allProductBatches.some((batch: any) => (batch as any).usesSharedStock === true);

      let batches: any[];
      if (hasSharedStock) {
        // Shared stock: Get all active shared stock batches (ignore variantSku)
        batches = allProductBatches.filter((batch: any) => {
          const isExpired = batch.expiryDate && new Date() > batch.expiryDate;
          return batch.usesSharedStock === true && !isExpired;
        });
      } else {
        // Variant-specific stock: Get batches matching the variant SKU
        batches = allProductBatches.filter((batch: any) => {
          const isExpired = batch.expiryDate && new Date() > batch.expiryDate;
          return batch.variantSku === variantSku && !isExpired;
        });
      }

      let remainingQuantity = quantity;
      const batchSplits: any[] = [];

      for (const batch of batches) {
        if (remainingQuantity <= 0) break;

        // Skip expired batches
        const isExpired = batch.expiryDate && new Date() > batch.expiryDate;
        if (isExpired) continue;

        const availableFromBatch = Math.min(batch.availableQuantity, remainingQuantity);
        if (availableFromBatch > 0) {
          batchSplits.push({
            batch: batch._id,
            quantity: availableFromBatch,
            sellingPrice: finalPrice,
            costPrice: batch.costPrice,
          });
          remainingQuantity -= availableFromBatch;
        }
      }

      if (remainingQuantity > 0) {
        stockErrors.push(
          `${product.name} (${size} ${unit}) - Insufficient stock in batches`
        );
        continue;
      }

      // Calculate item total
      const itemTotal = finalPrice * quantity;

      // Create order item
      orderItems.push({
        product: productId,
        quantity,
        price: finalPrice,
        total: itemTotal,
        size,
        unit,
        variantSku,
        batchSplits,
      });

      // Collect all batch splits for stock reduction
      allBatchSplits.push(...batchSplits);
    }

    // If there are stock errors, abort the order
    if (stockErrors.length > 0) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.badRequestResponse(
        res,
        'Some items are out of stock or have insufficient quantity',
        { stockErrors }
      );
      return;
    }

    if (orderItems.length === 0) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.badRequestResponse(res, 'No valid items to order');
      return;
    }

    // Calculate totals
    const subtotal = orderItems.reduce((sum, item) => sum + item.total, 0);
    const finalDiscount = discount || 0;
    const finalTotal = subtotal + deliveryFee + tax - finalDiscount;

    // Generate order number
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    const orderNumber = `ORD-${timestamp}-${random}`;

    // Create order
    const order = new Order({
      orderNumber,
      user: userId,
      storeId,
      items: orderItems,
      deliveryAddress: deliveryAddressId,
      subtotal,
      deliveryFee,
      tax,
      discount: finalDiscount,
      total: finalTotal,
      paymentMethod,
      deliveryInstructions,
      orderNotes,
      status: 'pending',
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'pending',
    });

    // Save order
    if (useTransaction && session) {
      await order.save({ session });
    } else {
      await order.save();
    }

    // Reduce stock from inventory batches
    for (const split of allBatchSplits) {
      const updateOptions: any = { $inc: { availableQuantity: -split.quantity } };
      if (useTransaction && session) {
        await InventoryBatch.findByIdAndUpdate(split.batch, updateOptions, { session });
      } else {
        await InventoryBatch.findByIdAndUpdate(split.batch, updateOptions);
      }
    }

    // Update StoreProduct stock (if stock field exists)
    for (const item of orderItems) {
      const updateOptions: any = {};
      // Note: StoreProduct doesn't have a stock field, stock is managed via InventoryBatch
      // This update is kept for backward compatibility if needed
    }

    // Clear cart
    cart.items = [];
    if (useTransaction && session) {
      await cart.save({ session });
    } else {
      await cart.save();
    }

    // Commit transaction if using one
    if (useTransaction && session) {
      await session.commitTransaction();
      session.endSession();
    }

    // Populate order for response
    await order.populate('items.product');
    await order.populate('deliveryAddress');

    getLogger().info(`Order created: ${order.orderNumber} for user ${userId}`);

    responseUtils.successResponse(res, 'Order placed successfully', {
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        items: order.items,
        deliveryAddress: order.deliveryAddress,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        tax: order.tax,
        discount: order.discount,
        total: order.total,
        paymentMethod: order.paymentMethod,
        status: order.status,
        paymentStatus: order.paymentStatus,
        estimatedDeliveryTime: order.estimatedDeliveryTime,
        createdAt: order.createdAt,
      },
    });
  } catch (error: any) {
    if (useTransaction && session) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        // Ignore abort errors
      }
      try {
        session.endSession();
      } catch (endError) {
        // Ignore end session errors
      }
    }
    getLogger().error('Create order error:', error);
    responseUtils.internalServerErrorResponse(
      res,
      error.message || 'Failed to create order'
    );
  }
};

/**
 * Get user's orders
 */
export const getUserOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    const orders = await Order.findUserOrders(userId, page, limit);

    responseUtils.successResponse(res, 'Orders retrieved successfully', {
      orders,
      page,
      limit,
    });
  } catch (error) {
    getLogger().error('Get user orders error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve orders');
  }
};

/**
 * Get order by ID
 */
export const getOrderById = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    const order = await Order.findById(id)
      .populate('items.product')
      .populate('deliveryAddress')
      .populate('deliveryPartner', 'name phone');

    if (!order) {
      responseUtils.notFoundResponse(res, 'Order not found');
      return;
    }

    // Verify order belongs to user (unless admin)
    if (order.user.toString() !== userId && (req as any).user?.role !== 'admin') {
      responseUtils.forbiddenResponse(res, 'Access denied');
      return;
    }

    responseUtils.successResponse(res, 'Order retrieved successfully', {
      order,
    });
  } catch (error) {
    getLogger().error('Get order by ID error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve order');
  }
};

/**
 * Get all orders (Admin only)
 */
export const getAllOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const status = req.query.status as string;
    const storeId = req.query.storeId as string;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    // Build query
    const query: any = {};
    if (status) query.status = status;
    if (storeId) query.storeId = storeId;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    // Get orders with pagination
    const orders = await Order.find(query)
      .populate('user', 'name phone email')
      .populate('storeId', 'name location serviceRadiusKm isActive')
      .populate('items.product', 'name images')
      .populate('deliveryAddress')
      .populate('deliveryPartner', 'name phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const totalOrders = await Order.countDocuments(query);

    // Calculate time elapsed for each order
    const now = new Date();
    const formattedOrders = orders.map(order => {
      const createdAt = new Date(order.createdAt);
      const diffMs = now.getTime() - createdAt.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      let timeElapsed = '';
      if (diffMins < 60) {
        timeElapsed = `${diffMins} min`;
      } else if (diffHours < 24) {
        timeElapsed = `${diffHours} hour${diffHours > 1 ? 's' : ''}`;
      } else {
        timeElapsed = `${diffDays} day${diffDays > 1 ? 's' : ''}`;
      }

      const user = order.user as any;
      const store = order.storeId as any;
      const deliveryPartner = order.deliveryPartner as any;

      // Format store name
      let storeName = 'Unknown Store';
      if (store) {
        if (typeof store === 'object' && store.name) {
          storeName = store.name;
        } else if (typeof store === 'string') {
          storeName = store;
        }
      }

      return {
        _id: order._id,
        id: order._id.toString(),
        orderNumber: order.orderNumber,
        customer: {
          name: user?.name || 'Unknown',
          phone: user?.phone || '',
          email: user?.email || '',
        },
        store: storeName,
        storeId: (store && typeof store === 'object' && store._id) ? store._id.toString() : '',
        items: order.items.map((item: any) => {
          const product = item.product as any;
          return {
            product: product?.name || 'Unknown Product',
            variant: item.variantSku || `${item.size || ''} ${item.unit || ''}`.trim() || 'N/A',
            quantity: item.quantity,
            price: item.price,
            total: item.total,
          };
        }),
        total: order.total,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        tax: order.tax,
        discount: order.discount,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        deliveryPartner: deliveryPartner ? `${deliveryPartner.name || ''}${deliveryPartner.phone ? ` (${deliveryPartner.phone})` : ''}` : undefined,
        deliveryAddress: order.deliveryAddress,
        createdAt: order.createdAt,
        estimatedDeliveryTime: order.estimatedDeliveryTime,
        actualDeliveryTime: order.actualDeliveryTime,
        timeElapsed,
      };
    });

    responseUtils.paginatedResponse(
      res,
      'Orders retrieved successfully',
      formattedOrders,
      page,
      limit,
      totalOrders
    );
  } catch (error) {
    getLogger().error('Get all orders error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve orders');
  }
};

// Order controller object
export const orderController = {
  createOrder,
  getUserOrders,
  getOrderById,
  getAllOrders,
};
