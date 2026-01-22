// Order controller
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Order } from '../models/order.model';
import { Cart } from '../models/cart.model';
import { Product } from '../models/product.model';
import { StoreProduct } from '../models/storeProduct.model';
import { InventoryBatch } from '../models/inventoryBatch.model';
import { Address } from '../models/address.model';
import { Store } from '../models/store.model';
import { Transaction } from '../models/transaction.model';
import { User } from '../models/user.model';
import { USER_ROLES } from '../constants/roles';
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
 * 
 * ⚠️ IMPORTANT: This function is INFORMATIONAL ONLY, not authoritative.
 * Stock can change between this check and actual deduction.
 * Real stock validation happens via atomic findOneAndUpdate operations.
 * Use this only for UX messaging, not for business logic decisions.
 */
async function checkStockAvailability(
  storeId: string,
  productId: string,
  variantSku: string,
  requiredQuantity: number
): Promise<{ available: number; sufficient: boolean }> {
  try {
    // Convert productId to ObjectId if it's a string
    const productIdObj = typeof productId === 'string' 
      ? new mongoose.Types.ObjectId(productId) 
      : productId;
    const storeIdObj = typeof storeId === 'string'
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;

    // Check StoreProduct for availability
    const storeProduct = await StoreProduct.findOne({
      storeId: storeIdObj,
      productId: productIdObj,
      isActive: true,
    }).lean();

    if (!storeProduct) {
      getLogger().warn(
        `checkStockAvailability: StoreProduct not found for storeId: ${storeId}, productId: ${productId}`
      );
      return { available: 0, sufficient: false };
    }

    // ⚠️ CRITICAL: variantSku MUST come from StoreProduct API response
    // Never construct variantSku - always use the variantSku from the product API
    const variant = storeProduct.variants.find((v) => v.sku === variantSku);
    
    if (!variant) {
      getLogger().warn(
        `checkStockAvailability: Variant not found for productId: ${productId}, variantSku: ${variantSku}. Available variants: ${storeProduct.variants.map((v: any) => v.sku).join(', ')}`
      );
      return { available: 0, sufficient: false };
    }
    
    // Use the actual SKU from the matched variant (should be same as variantSku)
    // Note: We don't check isAvailable here because it might be stale.
    // We'll check actual stock from InventoryBatch instead.
    const actualVariantSku = variant.sku;

    // Get total stock from InventoryBatches (only active, non-expired batches)
    // First, check if product uses shared stock
    const allProductBatches = await InventoryBatch.find({
      storeId: storeIdObj,
      productId: productIdObj,
      status: 'active',
    })
      .sort({ createdAt: 1 }) // FIFO order
      .lean();

    getLogger().info(
      `checkStockAvailability: Found ${allProductBatches.length} active batches for productId: ${productId}, storeId: ${storeId}`
    );

    // Check if any batch uses shared stock
    const hasSharedStock = allProductBatches.some((batch: any) => batch.usesSharedStock === true);

    let batches: any[];
    if (hasSharedStock) {
      // Shared stock: Get all active shared stock batches (ignore variantSku)
      batches = allProductBatches.filter((batch: any) => {
        const isExpired = batch.expiryDate && new Date() > batch.expiryDate;
        return batch.usesSharedStock === true && !isExpired;
      });
      getLogger().info(
        `checkStockAvailability: Using shared stock. Found ${batches.length} shared stock batches. Total available: ${batches.reduce((sum, b) => sum + (b.availableQuantity || 0), 0)}`
      );
    } else {
      // Variant-specific stock: Get batches matching the variant SKU
      // Use the actual SKU from the matched variant (may have been corrected from size+unit matching)
      batches = allProductBatches.filter((batch: any) => {
        const isExpired = batch.expiryDate && new Date() > batch.expiryDate;
        const matches = batch.variantSku === actualVariantSku && !isExpired;
        if (!matches && !isExpired) {
          getLogger().debug(
            `checkStockAvailability: Batch variantSku mismatch. Batch: ${batch.variantSku}, Required: ${actualVariantSku}`
          );
        }
        return matches;
      });
      getLogger().info(
        `checkStockAvailability: Using variant-specific stock. Found ${batches.length} batches for variantSku: ${actualVariantSku}. Total available: ${batches.reduce((sum, b) => sum + (b.availableQuantity || 0), 0)}`
      );
    }

    const totalAvailable = batches.reduce((sum, batch) => {
      return sum + (batch.availableQuantity || 0);
    }, 0);

    getLogger().info(
      `checkStockAvailability: Final result for productId: ${productId}, variantSku: ${variantSku}, required: ${requiredQuantity}, available: ${totalAvailable}, sufficient: ${totalAvailable >= requiredQuantity}`
    );

    return {
      available: totalAvailable,
      sufficient: totalAvailable >= requiredQuantity,
    };
  } catch (error: any) {
    getLogger().error(
      `checkStockAvailability error for productId: ${productId}, variantSku: ${variantSku}:`,
      error
    );
    return { available: 0, sufficient: false };
  }
}

/**
 * 🔒 ATOMIC STOCK DEDUCTION HELPER
 * 
 * This is a wrapper around InventoryBatch.deductStock() for convenience.
 * The actual atomic deduction logic is in the InventoryBatch model static method.
 * 
 * ⚠️ CRITICAL: Always use InventoryBatch.deductStock() for stock deductions.
 * Cart, StoreProduct, and UI checks are advisory only.
 * 
 * @deprecated Use InventoryBatch.deductStock() directly instead
 * @param batchId - The inventory batch ID
 * @param quantity - Quantity to deduct
 * @param session - Optional MongoDB session for transactions
 * @returns Updated batch
 * @throws Error with message starting with 'INSUFFICIENT_STOCK' if deduction fails
 */
async function deductStockSafely({
  batchId,
  quantity,
  session,
}: {
  batchId: mongoose.Types.ObjectId;
  quantity: number;
  session?: mongoose.ClientSession | null;
}): Promise<any> {
  // Use the model's atomic static method
  return await InventoryBatch.deductStock(batchId, quantity, session || null);
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

    // IDEMPOTENCY CHECK - Prevent duplicate orders (CRITICAL FIX)
    // Accept Idempotency-Key header (industry standard: RFC 7231)
    const idempotencyKey = req.headers['idempotency-key'] as string || 
                          req.headers['x-idempotency-key'] as string ||
                          req.body.idempotencyKey;

    if (idempotencyKey) {
      // Check if order with this key already exists
      const existingOrder = await Order.findOne({ idempotencyKey });
      if (existingOrder) {
        getLogger().info(`Idempotent request detected - returning existing order: ${existingOrder.orderNumber}`);
        // Return existing order (don't create duplicate)
        await existingOrder.populate('items.product');
        await existingOrder.populate('deliveryAddress');
        
        responseUtils.successResponse(res, 'Order already exists (idempotent request)', {
          order: {
            _id: existingOrder._id,
            orderNumber: existingOrder.orderNumber,
            items: existingOrder.items,
            deliveryAddress: existingOrder.deliveryAddress,
            subtotal: existingOrder.subtotal,
            deliveryFee: existingOrder.deliveryFee,
            tax: existingOrder.tax,
            discount: existingOrder.discount,
            total: existingOrder.total,
            paymentMethod: existingOrder.paymentMethod,
            status: existingOrder.status,
            paymentStatus: existingOrder.paymentStatus,
            estimatedDeliveryTime: existingOrder.estimatedDeliveryTime,
            createdAt: existingOrder.createdAt,
          },
        });
        return;
      }
    }

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

    // Validate storeId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.badRequestResponse(res, 'Invalid Store ID format');
      return;
    }

    // Verify store exists
    const store = await withSession(Store.findById(storeId));
    if (!store) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      responseUtils.badRequestResponse(res, 'Store not found');
      return;
    }

    let cart = await withSession(
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

    // CRITICAL: Revalidate cart before order creation
    // This ensures quantities are adjusted based on current stock
    // Import revalidateCart function from cart controller
    const { revalidateCart } = require('./cart.controller');
    cart = await revalidateCart(cart);
    
    // Check if cart has issues after revalidation
    if (cart.issues && cart.issues.length > 0) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      
      // Return cart issues so frontend can display them
      const issueMessages = cart.issues.map((issue: any) => {
        const productName = issue.productId?.name || 'Product';
        if (issue.reason === 'OUT_OF_STOCK') {
          return `${productName} is out of stock`;
        } else {
          return `${productName} - Only ${issue.availableQuantity} available (requested ${issue.requestedQuantity})`;
        }
      });
      
      // Return conflict response (409) to indicate stock changed
      responseUtils.conflictResponse(
        res,
        'Stock changed, please retry',
        { 
          stockErrors: issueMessages,
          cartIssues: cart.issues,
          message: 'Cart items have stock issues. Please review and update your cart.'
        }
      );
      return;
    }

    // Update cart if it was modified during revalidation
    if (useTransaction && session) {
      await cart.save({ session });
    } else {
      await cart.save();
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
      
      const cartVariantSku = cartItem.variantSku; // SKU from cart (may be constructed like "200_g")
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

      // ⚠️ CRITICAL: variantSku MUST come from StoreProduct API response
      // Never construct variantSku - always use the variantSku from the product API
      const variant = storeProduct.variants.find((v: any) => v.sku === cartVariantSku);
      
      if (!variant) {
        stockErrors.push(
          `${product.name} - Variant with SKU "${cartVariantSku}" not found. Please use variantSku from the product API response.`
        );
        continue;
      }

      if (!variant.isAvailable) {
        stockErrors.push(
          `${product.name} (${variant.sku}) is not available at this store`
        );
        continue;
      }

      // Use the actual SKU from the matched variant (should be same as cartVariantSku)
      const actualVariantSku = variant.sku;

      const size = variant.size || 0;
      const unit = variant.unit || 'piece';
      const mrp = variant.mrp;

      // PRICE VALIDATION - Compare current price with cart snapshot (CRITICAL FIX)
      // Get price from cart snapshot if available
      const cartItemPriceSnapshot = cartItem.priceSnapshot;
      const currentSellingPrice = variant.sellingPrice || 0;
      const currentDiscount = variant.discount || 0;
      // Ensure final price is never negative (discount cannot exceed selling price)
      const currentFinalPrice = Math.max(0, currentSellingPrice - currentDiscount);
      
      // Log warning if discount exceeds selling price (data integrity issue)
      if (currentDiscount > currentSellingPrice) {
        getLogger().warn(
          `Discount (${currentDiscount}) exceeds selling price (${currentSellingPrice}) for product ${productId}, variant ${actualVariantSku}. Final price clamped to 0.`
        );
      }

      // If cart has price snapshot, validate against current price
      if (cartItemPriceSnapshot) {
        const snapshotFinalPrice = cartItemPriceSnapshot.finalPrice || 0;
        const priceDifference = Math.abs(currentFinalPrice - snapshotFinalPrice);
        const priceTolerance = 0.01; // Allow 1 paisa difference for floating point

        if (priceDifference > priceTolerance) {
          // Price has changed - notify user
          const priceChangeMessage = currentFinalPrice > snapshotFinalPrice
            ? `Price increased from ₹${snapshotFinalPrice.toFixed(2)} to ₹${currentFinalPrice.toFixed(2)}`
            : `Price decreased from ₹${snapshotFinalPrice.toFixed(2)} to ₹${currentFinalPrice.toFixed(2)}`;

          stockErrors.push(
            `${product.name} (${size} ${unit}) - ${priceChangeMessage}. Please update your cart.`
          );
          continue;
        }
      }

      // Use current price (validated against snapshot)
      const finalPrice = currentFinalPrice;

      // Check stock availability (informational only - atomic deduction is authoritative)
      // Use the actual variant SKU (may have been corrected from size+unit matching above)
      const stockCheck = await checkStockAvailability(
        storeId,
        productId,
        actualVariantSku, // Use the actual SKU (may have been corrected from size+unit matching)
        quantity
      );

      if (!stockCheck.sufficient) {
        stockErrors.push(
          `${product.name} (${size} ${unit}) - Required: ${quantity}, Available: ${stockCheck.available}`
        );
        continue;
      }

      // NOTE: We don't do final stock check here because:
      // 1. Cart was already revalidated at the start
      // 2. Atomic deduction will handle race conditions
      // 3. checkStockAvailability() is informational only, not authoritative

      // Allocate inventory batches (FIFO) - only active, non-expired batches
      // OPTIMIZATION: Fetch all batches once per product, not per item
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
        // Use the actual SKU from the matched variant (may have been corrected from size+unit matching)
        batches = allProductBatches.filter((batch: any) => {
          const isExpired = batch.expiryDate && new Date() > batch.expiryDate;
          return batch.variantSku === variant.sku && !isExpired;
        });
      }

      let remainingQuantity = quantity;
      const batchSplits: any[] = [];

      // Allocate from batches (no re-fetch needed - atomic deduction will handle conflicts)
      for (const batch of batches) {
        if (remainingQuantity <= 0) break;

        // Skip if batch is expired (already filtered, but double-check)
        if (batch.expiryDate && new Date() > batch.expiryDate) continue;

        // Use available quantity from fetched batch
        // Note: This may be stale, but atomic deduction will catch conflicts
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
          `${product.name} (${size} ${unit}) - Insufficient stock in batches. Required: ${quantity}, Allocated: ${quantity - remainingQuantity}`
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
        variantSku: actualVariantSku, // Use the actual SKU (may have been corrected from size+unit matching)
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

    // 🔒 CRITICAL: Deduct stock BEFORE creating order/transaction
    // This ensures we don't create orders for items we can't fulfill
    // If stock deduction fails, we abort before creating any records
    // 
    // ⚠️ AUTHORITATIVE STOCK DEDUCTION
    // This is the ONLY place where stock is actually deducted.
    // Cart, StoreProduct, and UI checks are advisory only.
    // Uses InventoryBatch.deductStock() for atomic, concurrency-safe deduction.
    try {
      for (const split of allBatchSplits) {
        await InventoryBatch.deductStock(
          split.batch,
          split.quantity,
          useTransaction && session ? session : null
        );
      }
    } catch (error: any) {
      // Stock deduction failed - abort transaction and return error
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }

      getLogger().warn(`Stock deduction failed before order creation:`, error.message);
      
      // Check if it's an INSUFFICIENT_STOCK error
      const isStockError = error.message && error.message.includes('INSUFFICIENT_STOCK');
      
      // Return conflict response (409) to indicate stock changed
      responseUtils.conflictResponse(
        res,
        'Stock changed, please retry',
        { 
          stockError: error.message,
          message: isStockError 
            ? 'Some items may have been purchased by another customer or stock was manually updated. Please review your cart and try again.'
            : error.message
        }
      );
      return;
    }

    // Stock successfully deducted - now safe to create order
    // Generate order number
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    const orderNumber = `ORD-${timestamp}-${random}`;

    // Create order
    // Double-check storeId is set before creating order
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      if (useTransaction && session) {
        await session.abortTransaction();
        session.endSession();
      }
      getLogger().error('storeId validation failed before order creation', { storeId, userId });
      responseUtils.internalServerErrorResponse(res, 'Store ID validation failed');
      return;
    }

    const order = new Order({
      orderNumber,
      user: userId,
      storeId: new mongoose.Types.ObjectId(storeId), // Ensure it's an ObjectId
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
      idempotencyKey: idempotencyKey || undefined, // Store idempotency key if provided
    });

    // Save order
    if (useTransaction && session) {
      await order.save({ session });
    } else {
      await order.save();
    }

    // Create transaction record
    // For COD: Create as 'pending' - will be marked completed when payment is collected
    // For online/wallet: Create based on payment gateway response
    //   - If paymentId/transactionId provided and payment successful: 'completed'
    //   - If payment failed: 'failed'
    //   - If payment pending (async): 'pending'
    let transactionStatus: 'pending' | 'completed' | 'failed' = 'pending';
    if (paymentMethod !== 'cod') {
      // For online/wallet payments
      if (req.body.paymentId && req.body.transactionId) {
        // Payment gateway has responded - check if successful
        const paymentSuccess = req.body.paymentStatus === 'success' || 
                              req.body.paymentStatus === 'paid' ||
                              (req.body.gatewayResponse && req.body.gatewayResponse.status === 'success');
        transactionStatus = paymentSuccess ? 'completed' : 'failed';
        
        // Update order payment status based on transaction status
        if (transactionStatus === 'completed') {
          order.paymentStatus = 'paid';
          if (useTransaction && session) {
            await order.save({ session });
          } else {
            await order.save();
          }
        } else if (transactionStatus === 'failed') {
          order.paymentStatus = 'failed';
          if (useTransaction && session) {
            await order.save({ session });
          } else {
            await order.save();
          }
        }
      } else {
        // Payment initiated but not yet confirmed (async payment flow)
        transactionStatus = 'pending';
      }
    }

    const transaction = new Transaction({
      order: order._id,
      user: userId,
      store: new mongoose.Types.ObjectId(storeId),
      type: 'payment',
      paymentMethod,
      amount: finalTotal,
      currency: 'INR',
      status: transactionStatus,
      paymentId: req.body.paymentId,
      transactionId: req.body.transactionId,
      gateway: req.body.gateway,
      gatewayResponse: req.body.gatewayResponse,
    });

    if (useTransaction && session) {
      await transaction.save({ session });
    } else {
      await transaction.save();
    }

    // Update StoreProduct stock (if stock field exists)
    for (const item of orderItems) {
      const updateOptions: any = {};
      // Note: StoreProduct doesn't have a stock field, stock is managed via InventoryBatch
      // This update is kept for backward compatibility if needed
    }

    // Clear cart only when:
    // 1. COD payment (immediate)
    // 2. Online payment that is confirmed (status = 'completed')
    // Don't clear cart for pending online payments (payment may fail)
    const shouldClearCart = 
      paymentMethod === 'cod' || 
      (paymentMethod !== 'cod' && transactionStatus === 'completed');
    
    if (shouldClearCart) {
      cart.items = [];
      cart.issues = [];
      if (useTransaction && session) {
        await cart.save({ session });
      } else {
        await cart.save();
      }
    } else {
      // For pending online payments, keep cart but mark items as "in order"
      // This allows user to see what's being processed
      // Cart will be cleared when payment is confirmed via webhook/callback
      getLogger().info(`Cart kept for pending payment - order ${order.orderNumber}`);
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
 * Get delivery partner's assigned orders
 */
export const getDeliveryPartnerOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const status = req.query.status as string;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    // Build query - only orders assigned to this delivery partner
    const query: any = {
      deliveryPartner: userId,
    };
    
    if (status) {
      query.status = status;
    }

    // Get orders with pagination
    const orders = await Order.find(query)
      .populate('user', 'name phone email')
      .populate('storeId', 'name location serviceRadiusKm isActive')
      .populate('items.product', 'name images')
      .populate('deliveryAddress')
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
    getLogger().error('Get delivery partner orders error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve orders');
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

      // Debug logging for populate issues
      if (!user || !user.name) {
        getLogger().warn(`Order ${order.orderNumber}: User not populated or missing name`, {
          orderId: order._id,
          userId: order.user,
          userType: typeof order.user,
          userValue: user,
        });
      }
      if (!store || (typeof store === 'object' && !store.name)) {
        getLogger().warn(`Order ${order.orderNumber}: Store not populated or missing name`, {
          orderId: order._id,
          storeId: order.storeId,
          storeType: typeof order.storeId,
          storeValue: store,
        });
      }

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
        cancelReason: order.cancelReason,
        cancelledAt: order.cancelledAt,
        refundedAt: order.refundedAt,
        refundAmount: order.refundAmount,
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

/**
 * Update order status (Admin only)
 */
export const updateOrderStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, cancelReason } = req.body;
    const userId = (req as any).user?.userId;
    const userRole = (req as any).user?.role;

    // Admin can update any order status, delivery partners can only update their assigned orders
    const isAdmin = userRole === 'admin';
    const isDeliveryPartner = userRole === 'delivery_partner';
    
    if (!isAdmin && !isDeliveryPartner) {
      responseUtils.forbiddenResponse(res, 'Only admins or delivery partners can update order status');
      return;
    }

    // Validate status
    const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'];
    if (!status || !validStatuses.includes(status)) {
      responseUtils.badRequestResponse(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      return;
    }

    // Find order
    const order = await Order.findById(id);
    if (!order) {
      responseUtils.notFoundResponse(res, 'Order not found');
      return;
    }

    // If delivery partner, verify they are assigned to this order
    if (isDeliveryPartner && !isAdmin) {
      if (!order.deliveryPartner || order.deliveryPartner.toString() !== userId) {
        responseUtils.forbiddenResponse(res, 'You can only update orders assigned to you');
        return;
      }
      
      // Delivery partners can only update to 'out_for_delivery' or 'delivered'
      if (status !== 'out_for_delivery' && status !== 'delivered') {
        responseUtils.forbiddenResponse(
          res, 
          'Delivery partners can only update order status to "out_for_delivery" or "delivered"'
        );
        return;
      }
    }

    // Check if trying to deliver COD order without payment
    if (status === 'delivered' && order.paymentMethod === 'cod' && order.paymentStatus !== 'paid') {
      // Check if transaction exists and is completed
      const transaction = await Transaction.findCompletedByOrder(id);
      if (!transaction || transaction.status !== 'completed') {
        responseUtils.badRequestResponse(
          res,
          'Cannot deliver COD order. Payment must be collected first. Please collect payment before marking as delivered.'
        );
        return;
      }
    }

    // Validate status transition
    const currentStatus = order.status;
    const statusFlow = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
    const currentIndex = statusFlow.indexOf(currentStatus);
    const newIndex = statusFlow.indexOf(status);

    // Allow forward progression, cancellation, or refund at any point
    const canTransition = 
      status === 'cancelled' || 
      status === 'refunded' || 
      newIndex > currentIndex || 
      status === currentStatus;

    if (!canTransition && newIndex !== -1) {
      responseUtils.badRequestResponse(
        res, 
        `Cannot transition from ${currentStatus} to ${status}. Order can only progress forward or be cancelled/refunded.`
      );
      return;
    }

    // Validate cancellation reason if cancelling
    if (status === 'cancelled' && !cancelReason) {
      responseUtils.badRequestResponse(res, 'Cancellation reason is required when cancelling an order');
      return;
    }

    // Update status
    order.status = status as any;
    
    // If delivering, update payment status if COD and transaction is completed
    if (status === 'delivered' && order.paymentMethod === 'cod') {
      const transaction = await Transaction.findCompletedByOrder(id);
      if (transaction && transaction.status === 'completed') {
        order.paymentStatus = 'paid';
      }
    }

    // Set timestamps and reasons for specific statuses
    if (status === 'delivered') {
      order.actualDeliveryTime = new Date();
    } else if (status === 'cancelled') {
      order.cancelledAt = new Date();
      if (cancelReason) {
        order.cancelReason = cancelReason;
      }
    } else if (status === 'refunded') {
      order.refundedAt = new Date();
      order.refundAmount = order.total;
    }

    await order.save();

    getLogger().info(`Order ${order.orderNumber} status updated from ${currentStatus} to ${status}`);

    responseUtils.successResponse(res, 'Order status updated successfully', {
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        previousStatus: currentStatus,
      },
    });
  } catch (error: any) {
    getLogger().error('Update order status error:', error);
    responseUtils.internalServerErrorResponse(res, error.message || 'Failed to update order status');
  }
};

/**
 * Assign delivery partner to order (Admin only)
 */
export const assignDeliveryPartner = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { deliveryPartnerId } = req.body;
    const userRole = (req as any).user?.role;

    // Only admin can assign delivery partner
    if (userRole !== 'admin') {
      responseUtils.forbiddenResponse(res, 'Only admins can assign delivery partners');
      return;
    }

    // Validate delivery partner ID
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
      responseUtils.badRequestResponse(res, 'Valid delivery partner ID is required');
      return;
    }

    // Find order
    const order = await Order.findById(id);
    if (!order) {
      responseUtils.notFoundResponse(res, 'Order not found');
      return;
    }

    // Check if order can be assigned (should be ready or preparing)
    if (order.status !== 'ready' && order.status !== 'preparing' && order.status !== 'confirmed') {
      responseUtils.badRequestResponse(
        res,
        `Cannot assign delivery partner. Order must be in 'ready', 'preparing', or 'confirmed' status. Current status: ${order.status}`
      );
      return;
    }

    // Verify delivery partner exists and is active
    const deliveryPartner = await User.findOne({
      _id: deliveryPartnerId,
      role: USER_ROLES.DELIVERY_PARTNER,
      isActive: true,
    });

    if (!deliveryPartner) {
      responseUtils.notFoundResponse(res, 'Delivery partner not found or inactive');
      return;
    }

    // Assign delivery partner
    order.deliveryPartner = new mongoose.Types.ObjectId(deliveryPartnerId);
    
    // If order is ready, automatically move to out_for_delivery
    if (order.status === 'ready') {
      order.status = 'out_for_delivery';
    }
    
    await order.save();

    getLogger().info(`Delivery partner ${deliveryPartnerId} assigned to order ${order.orderNumber}`);

    responseUtils.successResponse(res, 'Delivery partner assigned successfully', {
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        deliveryPartner: {
          id: deliveryPartner._id,
          name: deliveryPartner.name,
          phone: deliveryPartner.phone,
        },
      },
    });
  } catch (error: any) {
    getLogger().error('Assign delivery partner error:', error);
    responseUtils.internalServerErrorResponse(res, error.message || 'Failed to assign delivery partner');
  }
};

/**
 * Collect COD payment (Admin/Delivery Partner only)
 */
export const collectPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = (req as any).user?.userId;
    const userRole = (req as any).user?.role;

    // Only admin or delivery partner can collect payment
    if (userRole !== 'admin' && userRole !== 'delivery_partner') {
      responseUtils.forbiddenResponse(res, 'Only admins or delivery partners can collect payment');
      return;
    }

    // Find order
    const order = await Order.findById(id);
    if (!order) {
      responseUtils.notFoundResponse(res, 'Order not found');
      return;
    }

    // Check if order is COD
    if (order.paymentMethod !== 'cod') {
      responseUtils.badRequestResponse(res, 'This order is not COD. Payment collection is only for COD orders.');
      return;
    }

    // Check if payment already collected
    if (order.paymentStatus === 'paid') {
      responseUtils.badRequestResponse(res, 'Payment has already been collected for this order.');
      return;
    }

    // Find or create transaction
    let transaction = await Transaction.findCompletedByOrder(id);
    if (!transaction) {
      // Find pending transaction
      const pendingTransaction = await Transaction.findOne({
        order: id,
        type: 'payment',
        status: 'pending',
      });

      if (pendingTransaction) {
        transaction = pendingTransaction;
      } else {
        // Create new transaction if not found
        transaction = new Transaction({
          order: order._id,
          user: order.user,
          store: order.storeId,
          type: 'payment',
          paymentMethod: 'cod',
          amount: order.total,
          currency: 'INR',
          status: 'pending',
        });
      }
    } else {
      responseUtils.badRequestResponse(res, 'Payment has already been collected for this order.');
      return;
    }

    // Mark transaction as completed
    await transaction.markAsCompleted(
      new mongoose.Types.ObjectId(userId),
      notes
    );

    // Update order payment status
    order.paymentStatus = 'paid';
    await order.save();

    getLogger().info(`Payment collected for order ${order.orderNumber} by user ${userId}`);

    responseUtils.successResponse(res, 'Payment collected successfully', {
      transaction: {
        _id: transaction._id,
        orderNumber: order.orderNumber,
        amount: transaction.amount,
        collectedAt: transaction.collectedAt,
        collectedBy: transaction.collectedBy,
      },
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
      },
    });
  } catch (error: any) {
    getLogger().error('Collect payment error:', error);
    responseUtils.internalServerErrorResponse(res, error.message || 'Failed to collect payment');
  }
};

/**
 * Reorder items from a previous order
 * Checks stock availability and adds available items to cart
 * Removes existing items from cart before adding new ones
 */
export const reorder = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const { id: orderId } = req.params;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    // Get order and verify ownership
    // Don't populate items.product to avoid issues with productId extraction
    const order = await Order.findById(orderId);

    if (!order) {
      responseUtils.notFoundResponse(res, 'Order not found');
      return;
    }

    // Verify order belongs to user (unless admin)
    if (order.user.toString() !== userId && (req as any).user?.role !== 'admin') {
      responseUtils.forbiddenResponse(res, 'Access denied');
      return;
    }

    const storeId = order.storeId.toString();
    const storeIdObj = typeof storeId === 'string' 
      ? new mongoose.Types.ObjectId(storeId) 
      : storeId;
    const store = await Store.findById(storeIdObj);
    if (!store || !store.isActive) {
      responseUtils.badRequestResponse(res, 'Store not found or inactive');
      return;
    }

    // Get or create cart - ALWAYS clear existing items for reorder
    // Use findOneAndUpdate to atomically clear items to ensure they're actually removed
    const clearResult = await Cart.findOneAndUpdate(
      { userId, storeId: storeIdObj },
      { $set: { items: [], issues: [] } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    if (!clearResult) {
      responseUtils.internalServerErrorResponse(res, 'Failed to initialize cart');
      return;
    }

    getLogger().info(
      `Reorder: Cleared existing cart for user ${userId}, store ${storeId}. Cart now has ${clearResult.items.length} items`
    );

    // Reload cart to get fresh reference (avoid any potential stale data)
    let cart = await Cart.findOne({ userId, storeId: storeIdObj });
    if (!cart) {
      // If cart doesn't exist after clear, create new one
      cart = new Cart({ userId, storeId: storeIdObj, items: [], issues: [] });
      await cart.save();
    }

    // Double-check cart is empty before adding items
    if (cart.items.length > 0) {
      getLogger().warn(
        `Reorder: Cart still has ${cart.items.length} items after clearing. Force clearing with direct update.`
      );
      // Use direct update to ensure items are cleared
      await Cart.updateOne(
        { _id: cart._id },
        { $set: { items: [], issues: [] } }
      );
      // Reload again
      cart = await Cart.findOne({ userId, storeId: storeIdObj });
      if (!cart) {
        cart = new Cart({ userId, storeId: storeIdObj, items: [], issues: [] });
        await cart.save();
      }
    }

    getLogger().info(
      `Reorder: Cart verified empty. Starting to add ${order.items.length} order items.`
    );

    const addedItems: any[] = [];
    const skippedItems: any[] = [];

    // Process each order item
    for (const orderItem of order.items) {
      // Extract productId - handle both populated and non-populated cases
      let productId: string;
      if (typeof orderItem.product === 'object' && orderItem.product !== null && '_id' in orderItem.product) {
        // Product is populated, extract _id
        productId = (orderItem.product as any)._id?.toString() || String(orderItem.product);
      } else {
        // ProductId is already an ObjectId or string
        productId = String(orderItem.product);
      }
      const quantity = orderItem.quantity;

      // Try to get variantSku from order item, or fallback to matching by size/unit
      let variantSku = orderItem.variantSku;
      
      // If variantSku is missing (old orders), try to find variant by size and unit
      if (!variantSku && orderItem.size !== undefined && orderItem.unit) {
        getLogger().info(
          `Reorder: variantSku missing, attempting to find by size/unit - productId: ${productId}, size: ${orderItem.size}, unit: ${orderItem.unit}`
        );
      }

      getLogger().info(
        `Reorder: Processing order item - productId: ${productId}, variantSku: ${variantSku}, quantity: ${quantity}`
      );

      // Verify product exists
      const product = await Product.findById(productId);
      if (!product) {
        getLogger().warn(`Reorder: Product not found - productId: ${productId}`);
        skippedItems.push({
          productId,
          productName: 'Unknown Product',
          reason: 'PRODUCT_NOT_FOUND',
          message: 'Product no longer exists',
        });
        continue;
      }

      // Convert productId to ObjectId if needed
      const productIdObj = typeof productId === 'string'
        ? new mongoose.Types.ObjectId(productId)
        : productId;

      // Verify store product exists and is active
      const storeProduct = await StoreProduct.findOne({
        storeId: storeIdObj,
        productId: productIdObj,
        isActive: true,
      });

      if (!storeProduct) {
        getLogger().warn(
          `Reorder: StoreProduct not found or inactive - storeId: ${storeId}, productId: ${productId}`
        );
        skippedItems.push({
          productId,
          productName: product.name,
          variantSku: variantSku || 'unknown',
          reason: 'PRODUCT_NOT_AVAILABLE',
          message: 'Product is not available at this store',
        });
        continue;
      }

      // Find the variant in the store product
      let variant = variantSku 
        ? storeProduct.variants.find((v) => v.sku === variantSku)
        : null;

      // If variant not found by SKU and we have size/unit, try to match by size/unit
      if (!variant && orderItem.size !== undefined && orderItem.unit) {
        variant = storeProduct.variants.find(
          (v) => v.size === orderItem.size && v.unit === orderItem.unit
        );
        if (variant) {
          variantSku = variant.sku; // Update variantSku for later use
          getLogger().info(
            `Reorder: Found variant by size/unit match - productId: ${productId}, size: ${orderItem.size}, unit: ${orderItem.unit}, variantSku: ${variantSku}`
          );
        }
      }

      if (!variant) {
        const availableVariants = storeProduct.variants.map((v: any) => `${v.sku} (${v.size} ${v.unit})`).join(', ');
        getLogger().warn(
          `Reorder: Variant not found - productId: ${productId}, variantSku: ${variantSku || 'missing'}, size: ${orderItem.size}, unit: ${orderItem.unit}, available variants: ${availableVariants}`
        );
        skippedItems.push({
          productId,
          productName: product.name,
          variantSku: variantSku || 'unknown',
          reason: 'VARIANT_NOT_FOUND',
          message: `Product variant not found. Available variants: ${availableVariants}`,
        });
        continue;
      }

      // Ensure variantSku is set (should be set by now from variant.sku)
      if (!variantSku) {
        variantSku = variant.sku;
      }

      getLogger().info(
        `Reorder: Variant found - productId: ${productId}, variantSku: ${variantSku}, variant: ${JSON.stringify({ sku: variant.sku, size: variant.size, unit: variant.unit })}`
      );

      // Check stock availability directly from InventoryBatch (don't rely on isAvailable flag)
      // The isAvailable flag might be stale, so we check actual stock
      const stockCheck = await checkStockAvailability(
        storeIdObj.toString(),
        productIdObj.toString(),
        variantSku,
        quantity
      );

      getLogger().info(
        `Reorder stock check result for product ${productId}, variant ${variantSku}: Available: ${stockCheck.available}, Required: ${quantity}, Sufficient: ${stockCheck.sufficient}`
      );

      if (!stockCheck.sufficient) {
        skippedItems.push({
          productId,
          productName: product.name,
          variantSku,
          quantity,
          available: stockCheck.available,
          reason: 'OUT_OF_STOCK',
          message: `Insufficient stock. Available: ${stockCheck.available}, Required: ${quantity}`,
        });
        continue;
      }

      // Calculate price snapshot for this item
      // Note: Cart is already cleared, so no need to check for existing items
      const sellingPrice = variant.sellingPrice || 0;
      const originalPrice = variant.mrp || 0;
      const discount = variant.discount || 0;
      // Ensure final price is never negative (discount cannot exceed selling price)
      const finalPrice = Math.max(0, sellingPrice - discount);
      
      // Log warning if discount exceeds selling price (data integrity issue)
      if (discount > sellingPrice) {
        getLogger().warn(
          `Discount (${discount}) exceeds selling price (${sellingPrice}) for product ${productId}, variant ${variantSku}. Final price clamped to 0.`
        );
      }

      const priceSnapshot = {
        sellingPrice,
        originalPrice,
        discount,
        finalPrice,
        snapshotDate: new Date(),
      };

      // Add item to cart
      cart.items.push({
        productId: productIdObj,
        variantSku,
        quantity,
        priceSnapshot,
      });

      addedItems.push({
        productId,
        productName: product.name,
        variantSku,
        quantity,
      });
    }

    // Mark arrays as modified to ensure Mongoose saves them
    cart.markModified('items');
    cart.markModified('issues');
    
    // Save cart
    await cart.save();

    getLogger().info(
      `Reorder: Cart saved with ${cart.items.length} items after processing ${order.items.length} order items`
    );

    // Populate and enrich cart items
    await cart.populate('items.productId');
    await cart.populate('storeId');

    const enrichedItems = await Promise.all(
      cart.items.map(async (item: any) => {
        const sp = await StoreProduct.findOne({
          storeId,
          productId: item.productId,
          variantSku: item.variantSku,
        }).populate('productId', 'name images');

        return {
          productId: item.productId,
          variantSku: item.variantSku,
          quantity: item.quantity,
          product: item.productId,
          storeProduct: sp || null,
        };
      })
    );

    getLogger().info(
      `Reorder completed for user ${userId}, order ${orderId}: ${addedItems.length} items added, ${skippedItems.length} items skipped`
    );

    responseUtils.successResponse(res, 'Reorder completed', {
      cart: {
        _id: cart._id,
        userId: cart.userId,
        storeId: cart.storeId,
        items: enrichedItems,
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
      },
      summary: {
        totalItems: order.items.length,
        addedItems: addedItems.length,
        skippedItems: skippedItems.length,
      },
      addedItems,
      skippedItems,
    });
  } catch (error: any) {
    getLogger().error('Reorder error:', error);
    responseUtils.internalServerErrorResponse(res, error.message || 'Failed to reorder items');
  }
};

// Order controller object
export const orderController = {
  createOrder,
  getUserOrders,
  getOrderById,
  getDeliveryPartnerOrders,
  getAllOrders,
  updateOrderStatus,
  assignDeliveryPartner,
  collectPayment,
  reorder,
};
