// InventoryBatch controller
import { Response } from 'express';
import { InventoryBatch } from '../models/inventoryBatch.model';
import { Store } from '../models/store.model';
import { Product } from '../models/product.model';
import { StoreProduct } from '../models/storeProduct.model';
import { responseUtils } from '../utils/response';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import mongoose from 'mongoose';

// Lazy import logger
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

// Get all inventory batches
export const getAllInventoryBatches = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (req.query.storeId && req.query.storeId !== 'all') {
      filter.storeId = req.query.storeId;
    }

    if (req.query.productId) {
      filter.productId = req.query.productId;
    }

    if (req.query.variantSku) {
      filter.variantSku = req.query.variantSku;
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.usesSharedStock !== undefined) {
      filter.usesSharedStock = req.query.usesSharedStock === 'true';
    }

    const [batches, total] = await Promise.all([
      InventoryBatch.find(filter)
        .populate('storeId', 'name')
        .populate('productId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InventoryBatch.countDocuments(filter),
    ]);

    responseUtils.paginatedResponse(
      res,
      'Inventory batches retrieved successfully',
      batches,
      page,
      limit,
      total
    );
  } catch (error) {
    getLogger().error('Get all inventory batches error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve inventory batches');
  }
};

// Get inventory batch by ID
export const getInventoryBatchById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid inventory batch ID');
      return;
    }

    const batch = await InventoryBatch.findById(id)
      .populate('storeId', 'name location')
      .populate('productId', 'name images');

    if (!batch) {
      responseUtils.notFoundResponse(res, 'Inventory batch not found');
      return;
    }

    responseUtils.successResponse(res, 'Inventory batch retrieved successfully', { batch });
  } catch (error) {
    getLogger().error('Get inventory batch by ID error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve inventory batch');
  }
};

// Create inventory batch
export const createInventoryBatch = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      storeId,
      productId,
      variantSku,
      initialQuantity,
      costPrice,
      usesSharedStock = false,
      baseUnit,
      batchNumber,
      supplier,
      purchaseDate,
      expiryDate,
      notes,
      status = 'active',
    } = req.body;

    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      responseUtils.badRequestResponse(res, 'Valid store ID is required');
      return;
    }

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      responseUtils.badRequestResponse(res, 'Valid product ID is required');
      return;
    }

    // For variant-specific stock, variantSku is required
    if (!usesSharedStock && !variantSku) {
      responseUtils.badRequestResponse(res, 'Variant SKU is required for variant-specific stock');
      return;
    }

    // For shared stock, baseUnit is required
    if (usesSharedStock && !baseUnit) {
      responseUtils.badRequestResponse(res, 'Base unit is required for shared stock batches');
      return;
    }

    if (initialQuantity === undefined || initialQuantity < 0) {
      responseUtils.badRequestResponse(res, 'Valid initial quantity is required');
      return;
    }

    if (costPrice === undefined || costPrice < 0) {
      responseUtils.badRequestResponse(res, 'Valid cost price is required');
      return;
    }

    // Verify store exists
    const store = await Store.findById(storeId);
    if (!store) {
      responseUtils.notFoundResponse(res, 'Store not found');
      return;
    }

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      responseUtils.notFoundResponse(res, 'Product not found');
      return;
    }

    // Verify store product exists
    const storeProduct = await StoreProduct.findOne({
      storeId,
      productId,
    });
    if (!storeProduct) {
      responseUtils.badRequestResponse(res, `Store product not found. Please create the store product first.`);
      return;
    }

    // For variant-specific stock, verify variant exists in store product
    if (!usesSharedStock) {
      const variant = storeProduct.variants.find((v) => v.sku === variantSku);
      if (!variant) {
        responseUtils.badRequestResponse(res, `Variant with SKU ${variantSku} not found in store product. Please add the variant to the store product first.`);
        return;
      }
    }

    // Create inventory batch
    const batchData: any = {
      storeId,
      productId,
      initialQuantity,
      availableQuantity: initialQuantity, // Initially same as initialQuantity
      costPrice,
      usesSharedStock,
      status,
    };

    // Add variantSku only for variant-specific stock
    if (!usesSharedStock && variantSku) {
      batchData.variantSku = variantSku;
    }

    // Add baseUnit for shared stock
    if (usesSharedStock && baseUnit) {
      batchData.baseUnit = baseUnit;
    }

    // Add optional fields
    if (batchNumber) batchData.batchNumber = batchNumber;
    if (supplier) batchData.supplier = supplier;
    if (purchaseDate) batchData.purchaseDate = new Date(purchaseDate);
    if (expiryDate) batchData.expiryDate = new Date(expiryDate);
    if (notes) batchData.notes = notes;

    const batch = new InventoryBatch(batchData);
    await batch.save();

    // Update StoreProduct stock
    if (usesSharedStock) {
      await updateStoreProductStockForShared(storeId, productId);
    } else if (variantSku) {
      await updateStoreProductStock(storeId, productId, variantSku);
    }

    await batch.populate('storeId', 'name location');
    await batch.populate('productId', 'name images');

    responseUtils.createdResponse(res, 'Inventory batch created successfully', { batch });
  } catch (error: any) {
    getLogger().error('Create inventory batch error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to create inventory batch');
  }
};

// Update inventory batch
export const updateInventoryBatch = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid inventory batch ID');
      return;
    }

    const batch = await InventoryBatch.findById(id);
    if (!batch) {
      responseUtils.notFoundResponse(res, 'Inventory batch not found');
      return;
    }

    const {
      initialQuantity,
      availableQuantity,
      costPrice,
      batchNumber,
      supplier,
      purchaseDate,
      expiryDate,
      notes,
      status,
    } = req.body;

    // Update initialQuantity (and adjust availableQuantity if needed)
    if (initialQuantity !== undefined) {
      if (typeof initialQuantity !== 'number' || initialQuantity < 0) {
        responseUtils.badRequestResponse(res, 'Initial quantity must be a positive number');
        return;
      }
      const diff = initialQuantity - batch.initialQuantity;
      batch.initialQuantity = initialQuantity;
      // Adjust availableQuantity by the difference
      batch.availableQuantity = Math.max(0, batch.availableQuantity + diff);
    }

    // Update availableQuantity (cannot exceed initialQuantity)
    if (availableQuantity !== undefined) {
      if (typeof availableQuantity !== 'number' || availableQuantity < 0) {
        responseUtils.badRequestResponse(res, 'Available quantity must be a positive number');
        return;
      }
      if (availableQuantity > batch.initialQuantity) {
        responseUtils.badRequestResponse(res, 'Available quantity cannot exceed initial quantity');
        return;
      }
      batch.availableQuantity = availableQuantity;
    }

    if (costPrice !== undefined) {
      if (typeof costPrice !== 'number' || costPrice < 0) {
        responseUtils.badRequestResponse(res, 'Cost price must be a positive number');
        return;
      }
      batch.costPrice = costPrice;
    }

    if (batchNumber !== undefined) batch.batchNumber = batchNumber;
    if (supplier !== undefined) batch.supplier = supplier;
    if (purchaseDate !== undefined) batch.purchaseDate = purchaseDate ? new Date(purchaseDate) : undefined;
    if (expiryDate !== undefined) batch.expiryDate = expiryDate ? new Date(expiryDate) : undefined;
    if (notes !== undefined) batch.notes = notes;
    if (status !== undefined) {
      const validStatuses = ['active', 'expired', 'depleted', 'cancelled'];
      if (!validStatuses.includes(status)) {
        responseUtils.badRequestResponse(res, `Status must be one of: ${validStatuses.join(', ')}`);
        return;
      }
      batch.status = status;
    }

    await batch.save();

    // Update StoreProduct stock
    if (batch.usesSharedStock) {
      await updateStoreProductStockForShared(batch.storeId, batch.productId);
    } else if (batch.variantSku) {
      await updateStoreProductStock(batch.storeId, batch.productId, batch.variantSku);
    }

    await batch.populate('storeId', 'name location');
    await batch.populate('productId', 'name images');

    responseUtils.successResponse(res, 'Inventory batch updated successfully', { batch });
  } catch (error: any) {
    getLogger().error('Update inventory batch error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to update inventory batch');
  }
};

// Delete inventory batch
export const deleteInventoryBatch = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid inventory batch ID');
      return;
    }

    const batch = await InventoryBatch.findById(id);
    if (!batch) {
      responseUtils.notFoundResponse(res, 'Inventory batch not found');
      return;
    }

    const { storeId, productId, variantSku, usesSharedStock } = batch;

    await InventoryBatch.findByIdAndDelete(id);

    // Update StoreProduct stock
    if (usesSharedStock) {
      await updateStoreProductStockForShared(storeId, productId);
    } else if (variantSku) {
      await updateStoreProductStock(storeId, productId, variantSku);
    }

    responseUtils.successResponse(res, 'Inventory batch deleted successfully');
  } catch (error) {
    getLogger().error('Delete inventory batch error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete inventory batch');
  }
};

// Get batches by store and product
export const getBatchesByStoreAndProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { storeId, productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(storeId) || !mongoose.Types.ObjectId.isValid(productId)) {
      responseUtils.badRequestResponse(res, 'Valid store ID and product ID are required');
      return;
    }

    const batches = await InventoryBatch.find({ storeId, productId })
      .populate('storeId', 'name')
      .populate('productId', 'name')
      .sort({ createdAt: 1 }) // FIFO order
      .lean();

    responseUtils.successResponse(res, 'Batches retrieved successfully', { batches });
  } catch (error) {
    getLogger().error('Get batches by store and product error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve batches');
  }
};

// Helper function to update StoreProduct variant availability from inventory batches (variant-specific stock)
async function updateStoreProductStock(
  storeId: mongoose.Types.ObjectId,
  productId: mongoose.Types.ObjectId,
  variantSku: string
): Promise<void> {
  try {
    // Calculate total available stock from all active batches for this store/product/variant
    const batches = await InventoryBatch.find({
      storeId,
      productId,
      variantSku,
      status: 'active',
    });

    const totalStock = batches.reduce((sum, batch) => {
      // Only count non-expired batches
      const isExpired = batch.expiryDate && new Date() > batch.expiryDate;
      return sum + (isExpired ? 0 : batch.availableQuantity);
    }, 0);

    // Update variant's isAvailable based on stock
    await StoreProduct.findOneAndUpdate(
      { storeId, productId, 'variants.sku': variantSku },
      { $set: { 'variants.$.isAvailable': totalStock > 0 } },
      { new: true }
    );
  } catch (error) {
    getLogger().error('Error updating StoreProduct variant availability:', error);
    // Don't throw - this is a background update
  }
}

// Helper function to update StoreProduct variant availability for shared stock products
async function updateStoreProductStockForShared(
  storeId: mongoose.Types.ObjectId,
  productId: mongoose.Types.ObjectId
): Promise<void> {
  try {
    // Calculate total available stock from all active shared stock batches
    const batches = await InventoryBatch.find({
      storeId,
      productId,
      usesSharedStock: true,
      status: 'active',
    });

    const totalStock = batches.reduce((sum, batch) => {
      // Only count non-expired batches
      const isExpired = batch.expiryDate && new Date() > batch.expiryDate;
      return sum + (isExpired ? 0 : batch.availableQuantity);
    }, 0);

    // Get store product to update all variants
    const storeProduct = await StoreProduct.findOne({ storeId, productId });
    if (!storeProduct) return;

    // Update all variants' isAvailable based on total shared stock
    // Variants are already plain objects, so we can map them directly
    const updatedVariants = storeProduct.variants.map((variant) => ({
      sku: variant.sku,
      size: variant.size,
      unit: variant.unit,
      mrp: variant.mrp,
      sellingPrice: variant.sellingPrice,
      discount: variant.discount,
      isAvailable: totalStock > 0,
    }));

    storeProduct.variants = updatedVariants as any;
    await storeProduct.save();
  } catch (error) {
    getLogger().error('Error updating StoreProduct shared stock availability:', error);
    // Don't throw - this is a background update
  }
}

// InventoryBatch controller object
export const inventoryBatchController = {
  getAllInventoryBatches,
  getInventoryBatchById,
  createInventoryBatch,
  updateInventoryBatch,
  deleteInventoryBatch,
  getBatchesByStoreAndProduct,
};

