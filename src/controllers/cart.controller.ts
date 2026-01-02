// Cart controller
import { Request, Response } from 'express';
import { Cart } from '../models/cart.model';
import { Product } from '../models/product.model';
import { ProductBatch } from '../models/productBatch.model';
import { responseUtils } from '../utils/response';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

// Get user's cart
export const getCart = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    // Get or create cart for user
    const cart = await Cart.getOrCreateCart(userId);
    
    // Populate product details
    await cart.populate('items.product');

    getLogger().info(`Cart retrieved for user ${userId}`);

    responseUtils.successResponse(res, 'Cart retrieved successfully', {
      cart: {
        _id: cart._id,
        items: cart.items.map((item: any) => ({
          product: item.product,
          variants: item.variants,
          addedAt: item.addedAt,
        })),
        totalItems: cart.totalItems,
        totalPrice: cart.totalPrice,
        lastActivity: cart.lastActivity,
      },
    });
  } catch (error) {
    getLogger().error('Get cart error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve cart');
  }
};

// Add item to cart
export const addItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    console.log('addItem', req.body);
    const { productId, size, unit, quantity = 1, price } = req.body;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!productId) {
      responseUtils.badRequestResponse(res, 'Product ID is required');
      return;
    }

    if (!price || price < 0) {
      responseUtils.badRequestResponse(res, 'Valid price is required');
      return;
    }

    // Verify product exists and is active
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      responseUtils.notFoundResponse(res, 'Product not found or inactive');
      return;
    }

    // Fetch batches to check available variants
    const batches = await ProductBatch.find({ product: productId }).lean();
    const batchesWithVariants = batches.filter(
      (batch: any) => batch.sellingVariants && Array.isArray(batch.sellingVariants) && batch.sellingVariants.length > 0
    );

    // Collect all available variants from batches
    const availableVariants = new Map<string, { size: number; unit: string }>();
    batchesWithVariants.forEach((batch: any) => {
      batch.sellingVariants.forEach((sv: any) => {
        const key = `${sv.sellingSize}_${sv.sellingUnit}`;
        if (!availableVariants.has(key)) {
          availableVariants.set(key, { 
            size: Number(sv.sellingSize), 
            unit: String(sv.sellingUnit).toLowerCase() 
          });
        }
      });
    });

    // Also check product.variants for backward compatibility
    if (product.variants && Array.isArray(product.variants)) {
      product.variants.forEach((v: any) => {
        const key = `${v.size}_${v.unit}`;
        if (!availableVariants.has(key)) {
          availableVariants.set(key, { 
            size: Number(v.size), 
            unit: String(v.unit).toLowerCase() 
          });
        }
      });
    }
    
    // Check product-level size/unit for backward compatibility
    if (product.size && product.unit) {
      const key = `${product.size}_${product.unit}`;
      if (!availableVariants.has(key)) {
        availableVariants.set(key, { 
          size: Number(product.size), 
          unit: String(product.unit).toLowerCase() 
        });
      }
    }

    // Handle variant selection based on product structure
    let finalSize: number;
    let finalUnit: string;

    // Case 1: Variant provided in request
    if (size !== undefined && unit !== undefined) {
      // Ensure size is a number for comparison
      const sizeNum = typeof size === 'string' ? parseFloat(size) : Number(size);
      const unitLower = String(unit).toLowerCase();
      
      // Validate variant exists in available variants (from batches or product)
      const variantKey = `${sizeNum}_${unitLower}`;
      const variantExists = availableVariants.has(variantKey);

      if (!variantExists) {
        const availableVariantList = Array.from(availableVariants.values())
          .map((v: any) => `${v.size}${v.unit}`)
          .join(', ');
        getLogger().warn(`Invalid variant for product ${productId}: size=${sizeNum}, unit=${unit}. Available variants: ${availableVariantList || 'none'}`);
        responseUtils.badRequestResponse(res, `Invalid variant for this product. Available variants: ${availableVariantList || 'none'}`);
        return;
      }

      finalSize = sizeNum;
      finalUnit = unitLower;
    }
    // Case 2: Only one available variant - auto-select
    else if (availableVariants.size === 1) {
      const onlyVariant = Array.from(availableVariants.values())[0];
      finalSize = onlyVariant.size;
      finalUnit = onlyVariant.unit;
    }
    // Case 3: Multiple variants - require selection
    else if (availableVariants.size > 1) {
      const availableVariantList = Array.from(availableVariants.values())
        .map((v: any) => `${v.size}${v.unit}`)
        .join(', ');
      responseUtils.badRequestResponse(
        res,
        `Variant selection required. Product has multiple variants. Please provide size and unit. Available variants: ${availableVariantList}`
      );
      return;
    }
    // Case 4: No variant information available
    else {
      responseUtils.badRequestResponse(res, 'Product does not have valid variant information');
      return;
    }

    // Get or create cart
    const cart = await Cart.getOrCreateCart(userId);

    // Add item to cart with variant
    await cart.addItem(productId, finalSize, finalUnit, quantity, price);

    // Refresh cart to get updated totals
    await cart.populate('items.product');

    getLogger().info(
      `Item added to cart for user ${userId}: ${productId}, variant: ${finalSize}${finalUnit}`
    );

    responseUtils.successResponse(res, 'Item added to cart successfully', {
      cart: {
        _id: cart._id,
        items: cart.items.map((item: any) => ({
          product: item.product,
          variants: item.variants,
          addedAt: item.addedAt,
        })),
        totalItems: cart.totalItems,
        totalPrice: cart.totalPrice,
        lastActivity: cart.lastActivity,
      },
    });
  } catch (error) {
    getLogger().error('Add item to cart error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to add item to cart');
  }
};

// Update item quantity in cart
export const updateItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const { productId, size, unit, quantity } = req.body;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!productId || quantity === undefined) {
      responseUtils.badRequestResponse(res, 'Product ID and quantity are required');
      return;
    }

    if (size === undefined || unit === undefined) {
      responseUtils.badRequestResponse(res, 'Size and unit are required');
      return;
    }

    if (quantity < 0) {
      responseUtils.badRequestResponse(res, 'Quantity cannot be negative');
      return;
    }

    // Get user's cart (without population for update operations)
    const userObjectId = new (require('mongoose').Types.ObjectId)(userId);
    let cart = await Cart.findOne({ user: userObjectId });
    if (!cart) {
      responseUtils.notFoundResponse(res, 'Cart not found');
      return;
    }

    // Ensure types are correct
    const sizeNum = typeof size === 'string' ? parseFloat(size) : Number(size);
    const quantityNum = typeof quantity === 'string' ? parseInt(quantity, 10) : Number(quantity);

    getLogger().info(
      `Updating cart item for user ${userId}: productId=${productId}, size=${sizeNum} (type: ${typeof sizeNum}), unit=${unit}, quantity=${quantityNum}`
    );

    // Update variant quantity (will remove if quantity is 0)
    await cart.updateItem(productId, sizeNum, unit, quantityNum);

    // Refresh cart to get updated totals and populate product details
    await cart.populate('items.product');

    getLogger().info(
      `Cart item updated for user ${userId}: ${productId}, variant: ${sizeNum}${unit}, quantity: ${quantityNum}`
    );

    responseUtils.successResponse(res, 'Cart item updated successfully', {
      cart: {
        _id: cart._id,
        items: cart.items.map((item: any) => ({
          product: item.product,
          variants: item.variants,
          addedAt: item.addedAt,
        })),
        totalItems: cart.totalItems,
        totalPrice: cart.totalPrice,
        lastActivity: cart.lastActivity,
      },
    });
  } catch (error: any) {
    getLogger().error('Update cart item error:', error);
    if (error.message && error.message.includes('Variant not found')) {
      responseUtils.badRequestResponse(res, error.message);
    } else {
      responseUtils.internalServerErrorResponse(res, 'Failed to update cart item');
    }
  }
};

// Remove item from cart
export const removeItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const { productId, size, unit } = req.body;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!productId) {
      responseUtils.badRequestResponse(res, 'Product ID is required');
      return;
    }

    // Get user's cart
    const cart = await Cart.findUserCart(userId);
    if (!cart) {
      responseUtils.notFoundResponse(res, 'Cart not found');
      return;
    }

    // If variant info provided, remove specific variant; otherwise remove entire product
    if (size !== undefined && unit !== undefined) {
      await cart.removeVariant(productId, size, unit);
      getLogger().info(
        `Variant removed from cart for user ${userId}: ${productId}, variant: ${size}${unit}`
      );
    } else {
      await cart.removeItem(productId);
      getLogger().info(`Item removed from cart for user ${userId}: ${productId}`);
    }

    // Refresh cart to get updated totals
    await cart.populate('items.product');

    responseUtils.successResponse(res, 'Item removed from cart successfully', {
      cart: {
        _id: cart._id,
        items: cart.items.map((item: any) => ({
          product: item.product,
          variants: item.variants,
          addedAt: item.addedAt,
        })),
        totalItems: cart.totalItems,
        totalPrice: cart.totalPrice,
        lastActivity: cart.lastActivity,
      },
    });
  } catch (error) {
    getLogger().error('Remove cart item error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to remove cart item');
  }
};

// Clear cart
export const clearCart = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    // Get user's cart
    const cart = await Cart.findUserCart(userId);
    if (!cart) {
      responseUtils.notFoundResponse(res, 'Cart not found');
      return;
    }

    // Clear cart
    await cart.clearCart();

    getLogger().info(`Cart cleared for user ${userId}`);

    responseUtils.successResponse(res, 'Cart cleared successfully', {
      cart: {
        _id: cart._id,
        items: [],
        totalItems: 0,
        totalPrice: 0,
        lastActivity: cart.lastActivity,
      },
    });
  } catch (error) {
    getLogger().error('Clear cart error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to clear cart');
  }
};

// Cart controller object
export const cartController = {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
};
