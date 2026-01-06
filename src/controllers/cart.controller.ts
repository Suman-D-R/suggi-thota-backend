// Cart controller
import { Request, Response } from 'express';
import { Cart } from '../models/cart.model';
import { Product } from '../models/product.model';
import { StoreProduct } from '../models/storeProduct.model';
import { Store } from '../models/store.model';
import { InventoryBatch } from '../models/inventoryBatch.model';
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
    const storeId = req.query.storeId as string;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!storeId) {
      responseUtils.badRequestResponse(res, 'Store ID is required');
      return;
    }

    // Get or create cart for user and store
    let cart = await Cart.findOne({ userId, storeId });

    if (!cart) {
      cart = new Cart({ userId, storeId, items: [] });
      await cart.save();
    }

    // Populate product details
    await cart.populate('items.productId');
    await cart.populate('storeId');

    // Enrich items with product and store product details
    // Format items to match frontend expectations: { product: {...}, variants: [{ size, unit, quantity, price }] }
    const enrichedItems = await Promise.all(
      cart.items.map(async (item: any) => {
        const product = await Product.findById(item.productId);
        const storeProduct = await StoreProduct.findOne({
          storeId,
          productId: item.productId,
        }).populate('productId', 'name images');

        if (!product) {
          getLogger().warn(`Product not found for cart item: ${item.productId}`);
          return null;
        }

        if (!storeProduct) {
          getLogger().warn(`StoreProduct not found for cart item: ${item.productId}, store: ${storeId}`);
          return null;
        }

        // Find the variant in storeProduct
        const variant = storeProduct.variants.find((v: any) => v.sku === item.variantSku);
        if (!variant) {
          getLogger().warn(`Variant not found: ${item.variantSku} for product: ${item.productId}`);
          return null;
        }

        // Build product variants array from storeProduct
        const productVariants = storeProduct.variants.map((v: any) => ({
          sku: v.sku,
          size: v.size,
          unit: v.unit,
          originalPrice: v.mrp,
          sellingPrice: v.sellingPrice,
          discount: v.discount,
          stock: 0, // Stock is managed separately
          isAvailable: v.isAvailable,
          isOutOfStock: !v.isAvailable,
        }));

        // Return in format expected by frontend: { product: {...}, variants: [{...}] }
        return {
          product: {
            _id: product._id,
            name: product.name,
            originalPrice: variant.mrp || 0,
            sellingPrice: variant.sellingPrice || 0,
            unit: variant.unit || '',
            size: variant.size || 0,
            variants: productVariants,
            category: product.category,
            images: product.images || [],
            discount: variant.discount || 0,
            description: product.description,
            isActive: storeProduct.isActive,
            isFeatured: storeProduct.isFeatured || false,
          },
          variants: [
            {
              size: variant.size,
              unit: variant.unit,
              quantity: item.quantity,
              price: variant.sellingPrice,
            },
          ],
        };
      })
    );

    // Filter out null items (products that weren't found)
    const validItems = enrichedItems.filter((item: any) => item !== null);

    getLogger().info(`Cart retrieved for user ${userId}, store ${storeId}`);

    responseUtils.successResponse(res, 'Cart retrieved successfully', {
      cart: {
        _id: cart._id,
        userId: cart.userId,
        storeId: cart.storeId,
        items: validItems,
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
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
    const { storeId, productId, variantSku, size, unit, quantity = 1 } = req.body;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    // Construct variantSku from size and unit if not provided
    let finalVariantSku = variantSku;
    if (!finalVariantSku && size !== undefined && unit) {
      finalVariantSku = `${size}_${unit}`;
    }

    if (!storeId || !productId || !finalVariantSku) {
      responseUtils.badRequestResponse(res, 'Store ID, product ID, and variant SKU (or size and unit) are required');
      return;
    }

    // Verify store exists
    const store = await Store.findById(storeId);
    if (!store || !store.isActive) {
      responseUtils.notFoundResponse(res, 'Store not found or inactive');
      return;
    }

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      responseUtils.notFoundResponse(res, 'Product not found');
      return;
    }

    // Verify store product exists and is active
    const storeProduct = await StoreProduct.findOne({
      storeId,
      productId,
      isActive: true,
    });

    if (!storeProduct) {
      responseUtils.badRequestResponse(res, `Product is not available at this store`);
      return;
    }

    // Find the variant in the store product
    const variant = storeProduct.variants.find((v) => v.sku === finalVariantSku);
    if (!variant) {
      responseUtils.badRequestResponse(res, `Variant with SKU ${finalVariantSku} is not available for this product at this store`);
      return;
    }

    if (!variant.isAvailable) {
      responseUtils.badRequestResponse(res, `Variant with SKU ${finalVariantSku} is not available`);
      return;
    }

    // Check stock from InventoryBatches (stock is not stored in StoreProduct)
    // First, check if product uses shared stock
    const allProductBatches = await InventoryBatch.find({
      storeId,
      productId,
      status: 'active',
    });

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
        return batch.variantSku === finalVariantSku && !isExpired;
      });
    }

    const totalStock = batches.reduce((sum: number, batch: any) => {
      return sum + (batch.availableQuantity || 0);
    }, 0);

    if (totalStock < quantity) {
      responseUtils.badRequestResponse(res, `Insufficient stock. Available: ${totalStock}`);
      return;
    }

    // Get or create cart
    let cart = await Cart.findOne({ userId, storeId });

    if (!cart) {
      cart = new Cart({ userId, storeId, items: [] });
      await cart.save();
    }

    // Check if item already exists in cart
    const existingItemIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productId && item.variantSku === finalVariantSku
    );

    if (existingItemIndex > -1) {
      // Update quantity
      cart.items[existingItemIndex].quantity += quantity;
    } else {
      // Add new item
      cart.items.push({
        productId: new (require('mongoose').Types.ObjectId)(productId),
        variantSku: finalVariantSku,
        quantity,
      });
    }

    await cart.save();

    // Populate and enrich
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
      `Item added to cart for user ${userId}: ${productId}, variant: ${finalVariantSku}, store: ${storeId}`
    );

    responseUtils.successResponse(res, 'Item added to cart successfully', {
      cart: {
        _id: cart._id,
        userId: cart.userId,
        storeId: cart.storeId,
        items: enrichedItems,
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
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
    const { storeId, productId, variantSku, size, unit, quantity } = req.body;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    // Construct variantSku from size and unit if not provided
    let finalVariantSku = variantSku;
    if (!finalVariantSku && size !== undefined && unit) {
      finalVariantSku = `${size}_${unit}`;
    }

    if (!storeId || !productId || !finalVariantSku || quantity === undefined) {
      responseUtils.badRequestResponse(res, 'Store ID, product ID, variant SKU (or size and unit), and quantity are required');
      return;
    }

    if (quantity < 0) {
      responseUtils.badRequestResponse(res, 'Quantity cannot be negative');
      return;
    }

    // Get user's cart
    const cart = await Cart.findOne({ userId, storeId });
    if (!cart) {
      responseUtils.notFoundResponse(res, 'Cart not found');
      return;
    }

    // Find item
    const itemIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productId && item.variantSku === finalVariantSku
    );

    if (itemIndex === -1) {
      responseUtils.notFoundResponse(res, 'Item not found in cart');
      return;
    }

    if (quantity === 0) {
      // Remove item
      cart.items.splice(itemIndex, 1);
    } else {
      // Verify stock availability
      const storeProduct = await StoreProduct.findOne({
        storeId,
        productId,
      });

      if (!storeProduct) {
        responseUtils.badRequestResponse(res, 'Product is not available at this store');
        return;
      }

      // Find the variant in the store product
      const variant = storeProduct.variants.find((v) => v.sku === finalVariantSku);
      if (!variant || !variant.isAvailable) {
        responseUtils.badRequestResponse(res, 'Product variant is not available at this store');
        return;
      }

      // Check stock from InventoryBatches (stock is not stored in StoreProduct)
      // First, check if product uses shared stock
      const allProductBatches = await InventoryBatch.find({
        storeId,
        productId,
        status: 'active',
      });

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
          return batch.variantSku === finalVariantSku && !isExpired;
        });
      }

      const totalStock = batches.reduce((sum: number, batch: any) => {
        return sum + (batch.availableQuantity || 0);
      }, 0);

      if (totalStock < quantity) {
        responseUtils.badRequestResponse(res, `Insufficient stock. Available: ${totalStock}`);
        return;
      }

      // Update quantity
      cart.items[itemIndex].quantity = quantity;
    }

    await cart.save();

    // Populate and enrich
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
      `Cart item updated for user ${userId}: ${productId}, variant: ${finalVariantSku}, quantity: ${quantity}`
    );

    responseUtils.successResponse(res, 'Cart item updated successfully', {
      cart: {
        _id: cart._id,
        userId: cart.userId,
        storeId: cart.storeId,
        items: enrichedItems,
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
      },
    });
  } catch (error: any) {
    getLogger().error('Update cart item error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to update cart item');
  }
};

// Remove item from cart
export const removeItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const { storeId, productId, variantSku } = req.body;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!storeId || !productId || !variantSku) {
      responseUtils.badRequestResponse(res, 'Store ID, product ID, and variant SKU are required');
      return;
    }

    // Get user's cart
    const cart = await Cart.findOne({ userId, storeId });
    if (!cart) {
      responseUtils.notFoundResponse(res, 'Cart not found');
      return;
    }

    // Find and remove item
    const itemIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productId && item.variantSku === variantSku
    );

    if (itemIndex === -1) {
      responseUtils.notFoundResponse(res, 'Item not found in cart');
      return;
    }

    cart.items.splice(itemIndex, 1);
    await cart.save();

    // Populate and enrich
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
      `Item removed from cart for user ${userId}: ${productId}, variant: ${variantSku}`
    );

    responseUtils.successResponse(res, 'Item removed from cart successfully', {
      cart: {
        _id: cart._id,
        userId: cart.userId,
        storeId: cart.storeId,
        items: enrichedItems,
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
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
    const storeId = req.query.storeId as string;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!storeId) {
      responseUtils.badRequestResponse(res, 'Store ID is required');
      return;
    }

    // Get user's cart
    const cart = await Cart.findOne({ userId, storeId });
    if (!cart) {
      responseUtils.notFoundResponse(res, 'Cart not found');
      return;
    }

    // Clear cart
    cart.items = [];
    await cart.save();

    getLogger().info(`Cart cleared for user ${userId}, store ${storeId}`);

    responseUtils.successResponse(res, 'Cart cleared successfully', {
      cart: {
        _id: cart._id,
        userId: cart.userId,
        storeId: cart.storeId,
        items: [],
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
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
