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

// Revalidate cart against current inventory
export const revalidateCart = async (cart: any) => {
  const updatedItems: any[] = [];
  const issues: any[] = [];

  for (const item of cart.items) {
    const batches = await InventoryBatch.find({
      storeId: cart.storeId,
      productId: item.productId,
      status: 'active',
      $or: [
        { usesSharedStock: true },
        { variantSku: item.variantSku },
      ],
    });

    const validBatches = batches.filter((b: any) => {
      return !b.expiryDate || new Date() <= b.expiryDate;
    });

    const availableStock = validBatches.reduce(
      (sum: number, b: any) => sum + (b.availableQuantity || 0),
      0
    );

    // ❌ Completely out of stock
    if (availableStock <= 0) {
      issues.push({
        productId: item.productId,
        variantSku: item.variantSku,
        reason: 'OUT_OF_STOCK',
        requestedQuantity: item.quantity,
        availableQuantity: 0,
      });
      continue;
    }

    // ⚠️ Partial stock available
    if (availableStock < item.quantity) {
      issues.push({
        productId: item.productId,
        variantSku: item.variantSku,
        reason: 'QUANTITY_REDUCED',
        requestedQuantity: item.quantity,
        availableQuantity: availableStock,
      });

      // Preserve price snapshot when reducing quantity
      const reducedItem = {
        ...item.toObject(),
        quantity: availableStock,
      };
      // Keep existing price snapshot (don't refresh on quantity reduction)
      if (item.priceSnapshot) {
        reducedItem.priceSnapshot = item.priceSnapshot;
      }
      updatedItems.push(reducedItem);
      continue;
    }

    // ✅ Fully available
    // Preserve price snapshot for fully available items
    const availableItem = item.toObject();
    if (item.priceSnapshot) {
      availableItem.priceSnapshot = item.priceSnapshot;
    }
    updatedItems.push(availableItem);
  }

  cart.items = updatedItems;
  cart.issues = issues;
  await cart.save();

  return cart;
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
      cart = new Cart({ userId, storeId, items: [], issues: [] });
      await cart.save();
    }

    // 🔥 Revalidate cart here
    cart = await revalidateCart(cart);

    if (!cart) {
      responseUtils.internalServerErrorResponse(res, 'Failed to revalidate cart');
      return;
    }

    // Populate product details
    await cart.populate('items.productId');
    await cart.populate('issues.productId');
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
          sku: v.sku, // Keep for backward compatibility
          variantSku: v.sku, // ⚠️ CRITICAL: Always use variantSku from StoreProduct
          size: v.size,
          unit: v.unit,
          originalPrice: v.mrp,
          sellingPrice: v.sellingPrice,
          discount: v.discount,
          stock: 0, // Stock is managed separately
          isAvailable: v.isAvailable,
          isOutOfStock: !v.isAvailable,
          maximumOrderLimit: v.maximumOrderLimit,
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
              variantSku: variant.sku, // ⚠️ CRITICAL: Include variantSku so frontend can use it
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

    // Enrich issues with product details
    const enrichedIssues = await Promise.all(
      (cart.issues || []).map(async (issue: any) => {
        const product = await Product.findById(issue.productId);
        const storeProduct = await StoreProduct.findOne({
          storeId,
          productId: issue.productId,
        }).populate('productId', 'name images');

        if (!product) {
          getLogger().warn(`Product not found for cart issue: ${issue.productId}`);
          return {
            productId: issue.productId?._id || issue.productId?.toString() || issue.productId,
            variantSku: issue.variantSku,
            reason: issue.reason,
            requestedQuantity: issue.requestedQuantity,
            availableQuantity: issue.availableQuantity,
            product: null,
          };
        }

        // Find the variant in storeProduct
        const variant = storeProduct?.variants.find((v: any) => v.sku === issue.variantSku);

        return {
          productId: issue.productId?._id || issue.productId?.toString() || issue.productId,
          variantSku: issue.variantSku,
          reason: issue.reason,
          requestedQuantity: issue.requestedQuantity,
          availableQuantity: issue.availableQuantity,
          product: {
            _id: product._id,
            name: product.name,
            images: product.images || [],
            originalPrice: variant?.mrp || 0,
            sellingPrice: variant?.sellingPrice || 0,
            unit: variant?.unit || '',
            size: variant?.size || 0,
          },
        };
      })
    );

    getLogger().info(`Cart retrieved for user ${userId}, store ${storeId}`);

    responseUtils.successResponse(res, 'Cart retrieved successfully', {
      cart: {
        _id: cart._id,
        userId: cart.userId,
        storeId: cart.storeId,
        items: validItems,
        issues: enrichedIssues,
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

    // ⚠️ CRITICAL: variantSku MUST be provided from the API response
    // Never construct variantSku from size+unit - always use the variantSku from StoreProduct
    if (!storeId || !productId || !variantSku) {
      responseUtils.badRequestResponse(res, 'Store ID, product ID, and variant SKU are required. variantSku must come from the product API response.');
      return;
    }

    const finalVariantSku = variantSku; // Use the variantSku from API

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

    // Get or create cart (needed for maximum order limit check and later for adding item)
    let cart = await Cart.findOne({ userId, storeId });

    // Check maximum order limit if set
    if (variant.maximumOrderLimit !== undefined && variant.maximumOrderLimit !== null && variant.maximumOrderLimit > 0) {
      // Get current quantity in cart for this variant
      const existingCartItem = cart?.items.find(
        (item) => item.productId.toString() === productId && item.variantSku === finalVariantSku
      );
      const currentQuantity = existingCartItem?.quantity || 0;
      const newQuantity = currentQuantity + quantity;

      if (newQuantity > variant.maximumOrderLimit) {
        responseUtils.badRequestResponse(
          res,
          `Maximum order limit exceeded. Maximum allowed: ${variant.maximumOrderLimit}, Current: ${currentQuantity}, Requested: ${quantity}`
        );
        return;
      }
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

    // Create cart if it doesn't exist

    if (!cart) {
      cart = new Cart({ userId, storeId, items: [], issues: [] });
      await cart.save();
    }

    // Calculate price snapshot for this item
    const sellingPrice = variant.sellingPrice || 0;
    const originalPrice = variant.mrp || 0;
    const discount = variant.discount || 0;
    // Ensure final price is never negative (discount cannot exceed selling price)
    const finalPrice = Math.max(0, sellingPrice - discount);
    
    // Log warning if discount exceeds selling price (data integrity issue)
    if (discount > sellingPrice) {
      getLogger().warn(
        `Discount (${discount}) exceeds selling price (${sellingPrice}) for product ${productId}, variant ${finalVariantSku}. Final price clamped to 0.`
      );
    }

    const priceSnapshot = {
      sellingPrice,
      originalPrice,
      discount,
      finalPrice,
      snapshotDate: new Date(),
    };

    // Check if item already exists in cart
    const existingItemIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productId && item.variantSku === finalVariantSku
    );

    if (existingItemIndex > -1) {
      // Update quantity and refresh price snapshot (price may have changed)
      cart.items[existingItemIndex].quantity += quantity;
      cart.items[existingItemIndex].priceSnapshot = priceSnapshot;
    } else {
      // Add new item with price snapshot
      cart.items.push({
        productId: new (require('mongoose').Types.ObjectId)(productId),
        variantSku: finalVariantSku,
        quantity,
        priceSnapshot,
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

    // ⚠️ CRITICAL: variantSku MUST be provided from the API response
    // Never construct variantSku from size+unit - always use the variantSku from StoreProduct
    if (!storeId || !productId || !variantSku || quantity === undefined) {
      responseUtils.badRequestResponse(res, 'Store ID, product ID, variant SKU, and quantity are required. variantSku must come from the product API response.');
      return;
    }

    const finalVariantSku = variantSku; // Use the variantSku from API

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

      // Check maximum order limit if set
      if (variant.maximumOrderLimit !== undefined && variant.maximumOrderLimit !== null && variant.maximumOrderLimit > 0) {
        if (quantity > variant.maximumOrderLimit) {
          responseUtils.badRequestResponse(
            res,
            `Maximum order limit exceeded. Maximum allowed: ${variant.maximumOrderLimit}, Requested: ${quantity}`
          );
          return;
        }
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

      // Update quantity and refresh price snapshot (price may have changed)
      const sellingPrice = variant.sellingPrice || 0;
      const originalPrice = variant.mrp || 0;
      const discount = variant.discount || 0;
      // Ensure final price is never negative (discount cannot exceed selling price)
      const finalPrice = Math.max(0, sellingPrice - discount);
      
      // Log warning if discount exceeds selling price (data integrity issue)
      if (discount > sellingPrice) {
        getLogger().warn(
          `Discount (${discount}) exceeds selling price (${sellingPrice}) for product ${productId}, variant ${finalVariantSku}. Final price clamped to 0.`
        );
      }

      cart.items[itemIndex].quantity = quantity;
      cart.items[itemIndex].priceSnapshot = {
        sellingPrice,
        originalPrice,
        discount,
        finalPrice,
        snapshotDate: new Date(),
      };
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
    cart.issues = [];
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
