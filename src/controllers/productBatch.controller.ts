// ProductBatch controller
import { Response } from 'express';
import { ProductBatch } from '../models/productBatch.model';
import { Product } from '../models/product.model';
import { responseUtils } from '../utils/response';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import mongoose from 'mongoose';

// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

// Get all batches for a product
export const getBatchesByProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      responseUtils.badRequestResponse(res, 'Invalid product ID');
      return;
    }

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      responseUtils.notFoundResponse(res, 'Product not found');
      return;
    }

    const batches = await ProductBatch.find({ product: productId })
      .sort({ createdAt: -1 })
      .lean();

    responseUtils.successResponse(res, 'Batches retrieved successfully', { batches });
  } catch (error) {
    getLogger().error('Get batches by product error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve batches');
  }
};

// Get single batch by ID
export const getBatchById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid batch ID');
      return;
    }

    const batch = await ProductBatch.findById(id).populate('product', 'name category brand unit');

    if (!batch) {
      responseUtils.notFoundResponse(res, 'Batch not found');
      return;
    }

    responseUtils.successResponse(res, 'Batch retrieved successfully', { batch });
  } catch (error) {
    getLogger().error('Get batch by ID error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve batch');
  }
};

// Create new batch
export const createBatch = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      product,
      batchCode,
      purchasedSize,
      purchasedUnit,
      totalCost,
      quantityPurchased,
      sellingVariants,
      expiryDate,
      supplier,
    } = req.body;

    // Validate product exists
    if (!mongoose.Types.ObjectId.isValid(product)) {
      responseUtils.badRequestResponse(res, 'Invalid product ID');
      return;
    }

    const productExists = await Product.findById(product);
    if (!productExists) {
      responseUtils.notFoundResponse(res, 'Product not found');
      return;
    }

    // Validate purchased fields
    if (purchasedSize === undefined || purchasedSize === null || isNaN(parseFloat(purchasedSize)) || parseFloat(purchasedSize) <= 0) {
      responseUtils.badRequestResponse(res, 'purchasedSize is required and must be a positive number');
      return;
    }
    if (!purchasedUnit || !['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'].includes(purchasedUnit)) {
      responseUtils.badRequestResponse(res, 'purchasedUnit is required and must be one of: kg, g, liter, ml, piece, pack, dozen');
      return;
    }
    if (totalCost === undefined || totalCost === null || isNaN(parseFloat(totalCost)) || parseFloat(totalCost) < 0) {
      responseUtils.badRequestResponse(res, 'totalCost is required and must be a non-negative number');
      return;
    }
    if (quantityPurchased === undefined || quantityPurchased === null || isNaN(parseFloat(quantityPurchased)) || parseFloat(quantityPurchased) <= 0) {
      responseUtils.badRequestResponse(res, 'quantityPurchased is required and must be a positive number');
      return;
    }

    // Validate sellingVariants array
    if (!sellingVariants || !Array.isArray(sellingVariants) || sellingVariants.length === 0) {
      responseUtils.badRequestResponse(res, 'sellingVariants is required and must be a non-empty array');
      return;
    }

    // Validate each selling variant
    // Note: Selling variants are independent and don't need to match product variants
    const validatedSellingVariants = sellingVariants.map((sv: any, index: number) => {
      if (!sv.sellingSize || isNaN(parseFloat(sv.sellingSize)) || parseFloat(sv.sellingSize) <= 0) {
        throw new Error(`sellingVariants[${index}].sellingSize is required and must be a positive number`);
      }
      if (!sv.sellingUnit || !['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'].includes(sv.sellingUnit)) {
        throw new Error(`sellingVariants[${index}].sellingUnit is required and must be one of: kg, g, liter, ml, piece, pack, dozen`);
      }
      if (!sv.originalPrice || isNaN(parseFloat(sv.originalPrice)) || parseFloat(sv.originalPrice) < 0) {
        throw new Error(`sellingVariants[${index}].originalPrice is required and must be a non-negative number`);
      }
      if (!sv.sellingPrice || isNaN(parseFloat(sv.sellingPrice)) || parseFloat(sv.sellingPrice) < 0) {
        throw new Error(`sellingVariants[${index}].sellingPrice is required and must be a non-negative number`);
      }
      if (sv.quantityAvailable === undefined || sv.quantityAvailable === null || isNaN(parseFloat(sv.quantityAvailable)) || parseFloat(sv.quantityAvailable) < 0) {
        throw new Error(`sellingVariants[${index}].quantityAvailable is required and must be a non-negative number`);
      }

      // Selling variants in batches are independent - they don't need to match product variants
      // This allows flexibility to sell different sizes/units from what's defined in the product

      return {
        sellingSize: parseFloat(sv.sellingSize),
        sellingUnit: sv.sellingUnit,
        originalPrice: parseFloat(sv.originalPrice),
        sellingPrice: parseFloat(sv.sellingPrice),
        discount: sv.discount ? parseFloat(sv.discount) : undefined,
        quantityAvailable: parseFloat(sv.quantityAvailable),
      };
    });

    // Create batch
    const batch = new ProductBatch({
      product,
      batchCode,
      purchasedSize: parseFloat(purchasedSize),
      purchasedUnit,
      totalCost: parseFloat(totalCost),
      quantityPurchased: parseFloat(quantityPurchased),
      sellingVariants: validatedSellingVariants,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      supplier,
    });

    await batch.save();

    const populatedBatch = await ProductBatch.findById(batch._id).populate('product', 'name category brand unit');

    responseUtils.createdResponse(res, 'Batch created successfully', { batch: populatedBatch });
  } catch (error: any) {
    getLogger().error('Create batch error:', error);
    if (error.name === 'ValidationError') {
      const firstError = Object.values(error.errors)[0] as any;
      responseUtils.badRequestResponse(res, firstError?.message || 'Validation error');
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to create batch');
  }
};

// Update batch
export const updateBatch = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      batchCode,
      purchasedSize,
      purchasedUnit,
      totalCost,
      quantityPurchased,
      sellingVariants,
      expiryDate,
      supplier,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid batch ID');
      return;
    }

    const batch = await ProductBatch.findById(id);
    if (!batch) {
      responseUtils.notFoundResponse(res, 'Batch not found');
      return;
    }

    // Validate purchased fields if provided
    if (purchasedSize !== undefined && (isNaN(parseFloat(purchasedSize)) || parseFloat(purchasedSize) <= 0)) {
      responseUtils.badRequestResponse(res, 'purchasedSize must be a positive number');
      return;
    }
    if (purchasedUnit !== undefined && !['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'].includes(purchasedUnit)) {
      responseUtils.badRequestResponse(res, 'purchasedUnit must be one of: kg, g, liter, ml, piece, pack, dozen');
      return;
    }
    if (totalCost !== undefined && (isNaN(parseFloat(totalCost)) || parseFloat(totalCost) < 0)) {
      responseUtils.badRequestResponse(res, 'totalCost must be a non-negative number');
      return;
    }
    if (quantityPurchased !== undefined && (isNaN(parseFloat(quantityPurchased)) || parseFloat(quantityPurchased) <= 0)) {
      responseUtils.badRequestResponse(res, 'quantityPurchased must be a positive number');
      return;
    }

    // Validate sellingVariants if provided
    if (sellingVariants !== undefined) {
      if (!Array.isArray(sellingVariants) || sellingVariants.length === 0) {
        responseUtils.badRequestResponse(res, 'sellingVariants must be a non-empty array');
        return;
      }

      // Validate each selling variant
      // Note: Selling variants are independent and don't need to match product variants
      const validatedSellingVariants = sellingVariants.map((sv: any, index: number) => {
        if (!sv.sellingSize || isNaN(parseFloat(sv.sellingSize)) || parseFloat(sv.sellingSize) <= 0) {
          throw new Error(`sellingVariants[${index}].sellingSize is required and must be a positive number`);
        }
        if (!sv.sellingUnit || !['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'].includes(sv.sellingUnit)) {
          throw new Error(`sellingVariants[${index}].sellingUnit is required and must be one of: kg, g, liter, ml, piece, pack, dozen`);
        }
        if (!sv.originalPrice || isNaN(parseFloat(sv.originalPrice)) || parseFloat(sv.originalPrice) < 0) {
          throw new Error(`sellingVariants[${index}].originalPrice is required and must be a non-negative number`);
        }
        if (!sv.sellingPrice || isNaN(parseFloat(sv.sellingPrice)) || parseFloat(sv.sellingPrice) < 0) {
          throw new Error(`sellingVariants[${index}].sellingPrice is required and must be a non-negative number`);
        }
        if (sv.quantityAvailable === undefined || sv.quantityAvailable === null || isNaN(parseFloat(sv.quantityAvailable)) || parseFloat(sv.quantityAvailable) < 0) {
          throw new Error(`sellingVariants[${index}].quantityAvailable is required and must be a non-negative number`);
        }

        // Selling variants in batches are independent - they don't need to match product variants
        // This allows flexibility to sell different sizes/units from what's defined in the product

        return {
          sellingSize: parseFloat(sv.sellingSize),
          sellingUnit: sv.sellingUnit,
          originalPrice: parseFloat(sv.originalPrice),
          sellingPrice: parseFloat(sv.sellingPrice),
          discount: sv.discount ? parseFloat(sv.discount) : undefined,
          quantityAvailable: parseFloat(sv.quantityAvailable),
        };
      });

      batch.sellingVariants = validatedSellingVariants;
    }

    // Update fields
    if (batchCode !== undefined) batch.batchCode = batchCode;
    if (purchasedSize !== undefined) batch.purchasedSize = parseFloat(purchasedSize);
    if (purchasedUnit !== undefined) batch.purchasedUnit = purchasedUnit;
    if (totalCost !== undefined) batch.totalCost = parseFloat(totalCost);
    if (quantityPurchased !== undefined) batch.quantityPurchased = parseFloat(quantityPurchased);
    if (expiryDate !== undefined) batch.expiryDate = expiryDate ? new Date(expiryDate) : undefined;
    if (supplier !== undefined) batch.supplier = supplier;

    await batch.save();

    const populatedBatch = await ProductBatch.findById(batch._id).populate('product', 'name category brand unit');

    responseUtils.successResponse(res, 'Batch updated successfully', { batch: populatedBatch });
  } catch (error: any) {
    getLogger().error('Update batch error:', error);
    if (error.name === 'ValidationError') {
      const firstError = Object.values(error.errors)[0] as any;
      responseUtils.badRequestResponse(res, firstError?.message || 'Validation error');
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to update batch');
  }
};

// Delete batch
export const deleteBatch = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid batch ID');
      return;
    }

    const batch = await ProductBatch.findById(id);
    if (!batch) {
      responseUtils.notFoundResponse(res, 'Batch not found');
      return;
    }

    await ProductBatch.findByIdAndDelete(id);

    responseUtils.successResponse(res, 'Batch deleted successfully');
  } catch (error) {
    getLogger().error('Delete batch error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete batch');
  }
};

// Get all batches (with pagination)
export const getAllBatches = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const filter: any = {};

    // Filter by product
    if (req.query.product) {
      filter.product = req.query.product;
    }

    const [batches, total] = await Promise.all([
      ProductBatch.find(filter)
        .populate('product', 'name category brand unit')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ProductBatch.countDocuments(filter),
    ]);

    responseUtils.paginatedResponse(
      res,
      'Batches retrieved successfully',
      batches,
      page,
      limit,
      total
    );
  } catch (error) {
    getLogger().error('Get all batches error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve batches');
  }
};

// Export controller object
export const productBatchController = {
  getAllBatches,
  getBatchesByProduct,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch,
};

