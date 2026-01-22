// StoreProduct controller
import { Response } from 'express';
import { StoreProduct } from '../models/storeProduct.model';
import { Store } from '../models/store.model';
import { Product } from '../models/product.model';
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

// Get all store products
export const getAllStoreProducts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (req.query.storeId) {
      filter.storeId = req.query.storeId;
    }

    if (req.query.productId) {
      filter.productId = req.query.productId;
    }

    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    const [storeProducts, total] = await Promise.all([
      StoreProduct.find(filter)
        .populate('storeId', 'name location')
        .populate('productId', 'name images')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      StoreProduct.countDocuments(filter),
    ]);

    responseUtils.paginatedResponse(
      res,
      'Store products retrieved successfully',
      storeProducts,
      page,
      limit,
      total
    );
  } catch (error) {
    getLogger().error('Get all store products error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve store products');
  }
};

// Get store product by ID
export const getStoreProductById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid store product ID');
      return;
    }

    const storeProduct = await StoreProduct.findById(id)
      .populate('storeId', 'name location')
      .populate('productId', 'name images');

    if (!storeProduct) {
      responseUtils.notFoundResponse(res, 'Store product not found');
      return;
    }

    responseUtils.successResponse(res, 'Store product retrieved successfully', { storeProduct });
  } catch (error) {
    getLogger().error('Get store product by ID error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve store product');
  }
};

// Create store product
export const createStoreProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { storeId, productId, variants: variantsRaw, isActive, isFeatured } = req.body;

    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      responseUtils.badRequestResponse(res, 'Valid store ID is required');
      return;
    }

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      responseUtils.badRequestResponse(res, 'Valid product ID is required');
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

    // Parse variants - they must include pricing information
    if (!variantsRaw || (typeof variantsRaw === 'string' && variantsRaw.trim() === '')) {
      responseUtils.badRequestResponse(res, 'At least one variant with pricing is required');
      return;
    }

    let parsedVariants: Array<{
      sku: string;
      size: number;
      unit: 'kg' | 'g' | 'ml' | 'liter' | 'piece' | 'pack';
      mrp: number;
      sellingPrice: number;
      discount: number;
      isAvailable: boolean;
      maximumOrderLimit?: number;
    }> = [];

    try {
      const variantsData = typeof variantsRaw === 'string' ? JSON.parse(variantsRaw) : variantsRaw;
      if (Array.isArray(variantsData) && variantsData.length > 0) {
        parsedVariants = variantsData.map((v: any) => {
          const unit = v.unit as string;
          if (!['kg', 'g', 'ml', 'liter', 'piece', 'pack'].includes(unit)) {
            throw new Error('Invalid unit');
          }
          
          if (v.sellingPrice === undefined || v.sellingPrice < 0) {
            throw new Error('Valid selling price is required for each variant');
          }
          
          if (v.mrp === undefined || v.mrp < 0) {
            throw new Error('Valid MRP is required for each variant');
          }

          return {
            sku: String(v.sku).trim(),
            size: parseFloat(v.size),
            unit: unit as 'kg' | 'g' | 'ml' | 'liter' | 'piece' | 'pack',
            mrp: parseFloat(v.mrp),
            sellingPrice: parseFloat(v.sellingPrice),
            discount: v.discount !== undefined ? Math.round(parseFloat(v.discount) * 100) / 100 : 0,
            isAvailable: v.isAvailable !== undefined ? v.isAvailable : true,
            maximumOrderLimit: v.maximumOrderLimit !== undefined && v.maximumOrderLimit !== null
              ? parseFloat(v.maximumOrderLimit)
              : undefined,
          };
        });
      } else {
        responseUtils.badRequestResponse(res, 'At least one variant is required');
        return;
      }
    } catch (error: any) {
      if (error.message.includes('Invalid') || error.message.includes('required')) {
        responseUtils.badRequestResponse(res, error.message || 'Invalid variants format');
        return;
      }
      responseUtils.badRequestResponse(res, 'Invalid variants format');
      return;
    }

    const storeProductData: any = {
      storeId,
      productId,
      variants: parsedVariants,
      isActive: isActive !== undefined ? isActive : true,
      isFeatured: isFeatured !== undefined ? isFeatured : false,
    };

    const storeProduct = new StoreProduct(storeProductData);
    await storeProduct.save();

    await storeProduct.populate('storeId', 'name location');
    await storeProduct.populate('productId', 'name images');

    responseUtils.createdResponse(res, 'Store product created successfully', { storeProduct });
  } catch (error: any) {
    getLogger().error('Create store product error:', error);
    if (error.code === 11000) {
      responseUtils.conflictResponse(res, 'This product variant already exists for this store');
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to create store product');
  }
};

// Update store product
export const updateStoreProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid store product ID');
      return;
    }

    const storeProduct = await StoreProduct.findById(id);
    if (!storeProduct) {
      responseUtils.notFoundResponse(res, 'Store product not found');
      return;
    }

    const { isActive, isFeatured, variants: variantsRaw } = req.body;

    if (isActive !== undefined) {
      storeProduct.isActive = isActive;
    }

    if (isFeatured !== undefined) {
      storeProduct.isFeatured = isFeatured;
    }

    // Parse and update variants if provided
    if (variantsRaw !== undefined) {
      try {
        const variantsData = typeof variantsRaw === 'string' ? JSON.parse(variantsRaw) : variantsRaw;
        if (Array.isArray(variantsData) && variantsData.length > 0) {
          storeProduct.variants = variantsData.map((v: any) => {
            const unit = v.unit as string;
            if (!['kg', 'g', 'ml', 'liter', 'piece', 'pack'].includes(unit)) {
              throw new Error('Invalid unit');
            }
            
            if (v.sellingPrice === undefined || v.sellingPrice < 0) {
              throw new Error('Valid selling price is required');
            }
            
            if (v.mrp === undefined || v.mrp < 0) {
              throw new Error('Valid MRP is required');
            }

            return {
              sku: String(v.sku).trim(),
              size: parseFloat(v.size),
              unit: unit as 'kg' | 'g' | 'ml' | 'liter' | 'piece' | 'pack',
              mrp: parseFloat(v.mrp),
              sellingPrice: parseFloat(v.sellingPrice),
              discount: v.discount !== undefined ? Math.round(parseFloat(v.discount) * 100) / 100 : 0,
              isAvailable: v.isAvailable !== undefined ? v.isAvailable : true,
              maximumOrderLimit: v.maximumOrderLimit !== undefined && v.maximumOrderLimit !== null
                ? parseFloat(v.maximumOrderLimit)
                : undefined,
            };
          });
        } else {
          responseUtils.badRequestResponse(res, 'At least one variant is required');
          return;
        }
      } catch (error: any) {
        if (error.message.includes('Invalid') || error.message.includes('required')) {
          responseUtils.badRequestResponse(res, error.message || 'Invalid variants format');
          return;
        }
        responseUtils.badRequestResponse(res, 'Invalid variants format');
        return;
      }
    }

    await storeProduct.save();

    await storeProduct.populate('storeId', 'name location');
    await storeProduct.populate('productId', 'name images');

    responseUtils.successResponse(res, 'Store product updated successfully', { storeProduct });
  } catch (error: any) {
    getLogger().error('Update store product error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to update store product');
  }
};

// Delete store product
export const deleteStoreProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid store product ID');
      return;
    }

    const storeProduct = await StoreProduct.findById(id);
    if (!storeProduct) {
      responseUtils.notFoundResponse(res, 'Store product not found');
      return;
    }

    await StoreProduct.findByIdAndDelete(id);

    responseUtils.successResponse(res, 'Store product deleted successfully');
  } catch (error) {
    getLogger().error('Delete store product error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete store product');
  }
};

// Get products for a store
export const getStoreProducts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { storeId } = req.params;

    // Handle "all" case to fetch products from all stores
    if (storeId === 'all') {
      const storeProducts = await StoreProduct.find({ isActive: true })
        .populate('productId', 'name images category')
        .lean();

      responseUtils.successResponse(res, 'Store products retrieved successfully', { storeProducts });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      responseUtils.badRequestResponse(res, 'Invalid store ID');
      return;
    }

    const storeProducts = await StoreProduct.find({ storeId, isActive: true })
      .populate('productId', 'name images category')
      .lean();

    responseUtils.successResponse(res, 'Store products retrieved successfully', { storeProducts });
  } catch (error) {
    getLogger().error('Get store products error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve store products');
  }
};

// StoreProduct controller object
export const storeProductController = {
  getAllStoreProducts,
  getStoreProductById,
  createStoreProduct,
  updateStoreProduct,
  deleteStoreProduct,
  getStoreProducts,
};
