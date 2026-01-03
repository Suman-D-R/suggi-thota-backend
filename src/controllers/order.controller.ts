// Order controller
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Order } from '../models/order.model';
import { Cart } from '../models/cart.model';
import { Product } from '../models/product.model';
import { ProductBatch } from '../models/productBatch.model';
import { Address } from '../models/address.model';
import { responseUtils } from '../utils/response';
import { allocateBatches, reduceBatchStock } from '../utils/batchAllocation';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

/**
 * Check stock availability for a product variant
 */
async function checkStockAvailability(
  productId: string,
  size: number,
  unit: string,
  requiredQuantity: number
): Promise<{ available: number; sufficient: boolean }> {
  const batches = await ProductBatch.find({ product: productId })
    .sort({ createdAt: 1 }) // FIFO order
    .lean();

  let totalAvailable = 0;

  for (const batch of batches) {
    if (!batch.sellingVariants || !Array.isArray(batch.sellingVariants)) {
      continue;
    }

    const matchingVariants = batch.sellingVariants.filter(
      (sv: any) =>
        Number(sv.sellingSize) === Number(size) &&
        String(sv.sellingUnit).toLowerCase() === String(unit).toLowerCase() &&
        (sv.quantityAvailable || 0) > 0
    );

    for (const variant of matchingVariants) {
      totalAvailable += variant.quantityAvailable || 0;
    }
  }

  return {
    available: totalAvailable,
    sufficient: totalAvailable >= requiredQuantity,
  };
}

/**
 * Create order from cart
 */
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

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
      await session.abortTransaction();
      session.endSession();
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!deliveryAddressId) {
      await session.abortTransaction();
      session.endSession();
      responseUtils.badRequestResponse(res, 'Delivery address is required');
      return;
    }

    if (!paymentMethod) {
      await session.abortTransaction();
      session.endSession();
      responseUtils.badRequestResponse(res, 'Payment method is required');
      return;
    }

    // Validate payment method
    const validPaymentMethods = ['cod', 'online', 'wallet'];
    if (!validPaymentMethods.includes(paymentMethod)) {
      await session.abortTransaction();
      session.endSession();
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
      address = await Address.findOne({
        _id: deliveryAddressId,
        user: userId,
      }).session(session);

      if (!address) {
        await session.abortTransaction();
        session.endSession();
        responseUtils.notFoundResponse(res, 'Delivery address not found');
        return;
      }
    } else {
      // Not a valid ObjectId - check if address details are provided
      const {
        addressDetails,
      } = req.body;

      if (!addressDetails) {
        await session.abortTransaction();
        session.endSession();
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
      let pincode = '000000';
      let street = addressString;

      // Try to extract structured information from address string
      // Common format: "Street, City, State, Pincode" or "Street, City, State"
      if (addressParts.length >= 2) {
        street = addressParts[0] || addressString;
        
        // Try to find pincode (6 digits) in any part
        const pincodeMatch = addressString.match(/\b\d{6}\b/);
        if (pincodeMatch) {
          pincode = pincodeMatch[0];
        }

        // Last part is usually state or city
        if (addressParts.length >= 3) {
          city = addressParts[addressParts.length - 2] || 'Unknown';
          state = addressParts[addressParts.length - 1] || 'Unknown';
        } else {
          city = addressParts[addressParts.length - 1] || 'Unknown';
        }

        // Remove pincode from state if it's there
        state = state.replace(/\b\d{6}\b/, '').trim() || 'Unknown';
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
        pincode: pincode,
        country: addressDetails.country || 'India',
        contactName: addressDetails.contactName || 'User',
        contactPhone: addressDetails.contactPhone || '',
        isDefault: addressDetails.isDefault || false,
        isActive: true,
      });

      await address.save({ session });
    }

    // Get user's cart
    const cart = await Cart.findOne({ user: userId })
      .populate('items.product')
      .session(session);

    if (!cart || cart.items.length === 0) {
      await session.abortTransaction();
      session.endSession();
      responseUtils.badRequestResponse(res, 'Cart is empty');
      return;
    }

    // Validate stock availability and prepare order items
    const orderItems: any[] = [];
    const stockErrors: string[] = [];
    const allBatchSplits: any[] = [];

    for (const cartItem of cart.items) {
      const product = cartItem.product as any;
      const productId = product._id.toString();

      // Verify product is active
      if (!product.isActive) {
        stockErrors.push(`${product.name} is no longer available`);
        continue;
      }

      // Process each variant in cart item
      for (const variant of cartItem.variants) {
        const { size, unit, quantity, price } = variant;

        // Check stock availability
        const stockCheck = await checkStockAvailability(
          productId,
          size,
          unit,
          quantity
        );

        if (!stockCheck.sufficient) {
          stockErrors.push(
            `${product.name} (${size} ${unit}) - Required: ${quantity}, Available: ${stockCheck.available}`
          );
          continue;
        }

        // Allocate batches for this variant
        let batchSplits;
        try {
          batchSplits = await allocateBatches(productId, quantity, size, unit);
        } catch (error: any) {
          stockErrors.push(
            `${product.name} (${size} ${unit}) - ${error.message}`
          );
          continue;
        }

        // Calculate item total
        const itemTotal = price * quantity;

        // Create order item
        orderItems.push({
          product: productId,
          quantity,
          price,
          total: itemTotal,
          size,
          unit,
          batchSplits,
        });

        // Collect all batch splits for stock reduction
        allBatchSplits.push(...batchSplits);
      }
    }

    // If there are stock errors, abort the order
    if (stockErrors.length > 0) {
      await session.abortTransaction();
      session.endSession();
      responseUtils.badRequestResponse(
        res,
        'Some items are out of stock or have insufficient quantity',
        { stockErrors }
      );
      return;
    }

    if (orderItems.length === 0) {
      await session.abortTransaction();
      session.endSession();
      responseUtils.badRequestResponse(res, 'No valid items to order');
      return;
    }

    // Calculate totals
    const subtotal = orderItems.reduce((sum, item) => sum + item.total, 0);
    const finalDiscount = discount || 0;
    const finalTotal = subtotal + deliveryFee + tax - finalDiscount;

    // Create order
    const order = new Order({
      user: userId,
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
    await order.save({ session });

    // Reduce stock from batches
    await reduceBatchStock(allBatchSplits, session);

    // Clear cart
    await cart.clearCart();
    await cart.save({ session });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

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
    await session.abortTransaction();
    session.endSession();
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

// Order controller object
export const orderController = {
  createOrder,
  getUserOrders,
  getOrderById,
};
