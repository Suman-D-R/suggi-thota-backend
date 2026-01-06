// Product controller
import { Response } from 'express';
import { Product } from '../models/product.model';
import { Category } from '../models/category.model';
import { responseUtils } from '../utils/response';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { s3Config } from '../config/aws';
import { s3Delete } from '../utils/s3Delete';
import mongoose from 'mongoose';

// Helper function to get dummy category/subcategory names
const getDummyCategoryName = (id: string): string | null => {
  const dummyCategories: { [key: string]: string } = {
    'fruits-id': 'Fruits',
    'vegetables-id': 'Vegetables',
    'dairy-eggs-id': 'Dairy & Eggs',
    'grains-cereals-id': 'Grains & Cereals',
    'meat-poultry-id': 'Meat & Poultry',
    'seafood-id': 'Seafood',
    'citrus-fruits-id': 'Citrus Fruits',
    'tropical-fruits-id': 'Tropical Fruits',
    'berries-id': 'Berries',
    'apples-pears-id': 'Apples & Pears',
    'leafy-greens-id': 'Leafy Greens',
    'root-vegetables-id': 'Root Vegetables',
    'cruciferous-id': 'Cruciferous',
    'allium-id': 'Allium',
    'milk-id': 'Milk',
    'cheese-id': 'Cheese',
    'yogurt-id': 'Yogurt',
    'eggs-id': 'Eggs',
    'rice-id': 'Rice',
    'wheat-products-id': 'Wheat Products',
    'oats-breakfast-id': 'Oats & Breakfast',
    'chicken-id': 'Chicken',
    'beef-id': 'Beef',
    'pork-id': 'Pork',
    'lamb-goat-id': 'Lamb & Goat',
    'fresh-fish-id': 'Fresh Fish',
    'shellfish-id': 'Shellfish',
    'smoked-fish-id': 'Smoked Fish',
  };
  return dummyCategories[id] || null;
};

// Helper function to conditionally populate categories
const populateCategories = async (products: any[]): Promise<any[]> => {
  // Separate products with real ObjectIds and dummy IDs
  const realIdProducts: any[] = [];
  const dummyIdProducts: any[] = [];

  for (const product of products) {
    const hasDummyCategory = product.category && typeof product.category === 'string' && product.category.endsWith('-id');

    if (hasDummyCategory) {
      dummyIdProducts.push(product);
    } else {
      realIdProducts.push(product);
    }
  }

  // Populate real ObjectId products normally
  let populatedRealProducts: any[] = [];
  if (realIdProducts.length > 0) {
    populatedRealProducts = await Product.populate(realIdProducts, [
      { path: 'category', select: 'name' }
    ]);
  }

  // Handle dummy ID products
  const populatedDummyProducts: any[] = dummyIdProducts.map(product => {
    const productObj = product.toObject ? product.toObject() : product;

    if (productObj.category && typeof productObj.category === 'string' && productObj.category.endsWith('-id')) {
      productObj.category = {
        _id: productObj.category,
        name: getDummyCategoryName(productObj.category)
      };
    }

    return productObj;
  });

  return [...populatedRealProducts, ...populatedDummyProducts];
};

// Helper function to extract S3 key from image URL
const extractS3KeyFromUrl = (imageUrl: string): string | null => {
  try {
    // Expected URL format: https://bucket-name.s3.region.amazonaws.com/key
    const url = new URL(imageUrl);
    const key = url.pathname.substring(1); // Remove leading slash
    return key;
  } catch (error) {
    getLogger().error('Error extracting S3 key from URL:', error);
    return null;
  }
};

// Helper function to delete old images from S3
const deleteOldImagesFromS3 = async (imageUrls: string[]): Promise<void> => {
  const deletePromises = imageUrls
    .map(extractS3KeyFromUrl)
    .filter((key): key is string => key !== null)
    .map(key => s3Delete.deleteFromS3(key));

  try {
    await Promise.all(deletePromises);
    getLogger().info(`Deleted ${deletePromises.length} old images from S3`);
  } catch (error) {
    getLogger().error('Error deleting old images from S3:', error);
    // Don't throw error - we don't want to fail the update if deletion fails
  }
};

// Get all products (with pagination and filters)
export const getAllProducts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const filter: any = {};
    
    // Filter by category
    if (req.query.category) {
      const categoryId = req.query.category as string;
      filter.category = categoryId; // Now accepts both ObjectId and dummy strings
    }

    // Filter by search
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    // Populate categories (handles both real and dummy IDs)
    const populatedProducts = await populateCategories(products);

    responseUtils.paginatedResponse(
      res,
      'Products retrieved successfully',
      populatedProducts,
      page,
      limit,
      total
    );
  } catch (error) {
    getLogger().error('Get all products error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve products');
  }
};

// Get single product by ID
export const getProductById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid product ID');
      return;
    }

    const product = await Product.findById(id);

    if (!product) {
      responseUtils.notFoundResponse(res, 'Product not found');
      return;
    }

    // Populate categories (handles both real and dummy IDs)
    const populatedProducts = await populateCategories([product]);
    const populatedProduct = populatedProducts[0];

    responseUtils.successResponse(res, 'Product retrieved successfully', { product: populatedProduct });
  } catch (error) {
    getLogger().error('Get product by ID error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve product');
  }
};

// Create new product
export const createProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      name,
      category: categoryRaw,
      description,
      images: imagesFromBody,
    } = req.body;

    // Handle category - if it's an array (from FormData), take the first value
    const category = Array.isArray(categoryRaw) ? categoryRaw[0] : categoryRaw;

    // Get uploaded image URLs from multer
    let images: string[] = [];
    if (req.files && Array.isArray(req.files)) {
      images = req.files.map((file: any) => {
        // Use key property if available (multer-s3 v3 provides this)
        if (file.key) {
          return `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${file.key}`;
        }
        // If location is provided and is an HTTPS URL, use it
        if (file.location && file.location.startsWith('https://')) {
          return file.location;
        }
        // If location is S3 protocol, extract key and construct HTTPS URL
        if (file.location && file.location.startsWith('s3://')) {
          const key = file.location.replace(`s3://${s3Config.bucketName}/`, '');
          return `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${key}`;
        }
        // Fallback to file.path for local development
        return file.path;
      });
    }

    // Use images from body if no files uploaded
    if (images.length === 0 && imagesFromBody) {
      images = Array.isArray(imagesFromBody) ? imagesFromBody : [imagesFromBody];
    }

    // Validate images
    if (!images || images.length === 0) {
      responseUtils.badRequestResponse(res, 'At least one image is required');
      return;
    }

    // Validate category exists
    // Allow dummy IDs for testing (IDs ending with '-id')
    const isDummyId = typeof category === 'string' && category.endsWith('-id');
    if (!isDummyId && !mongoose.Types.ObjectId.isValid(category)) {
      responseUtils.badRequestResponse(res, 'Invalid category ID');
      return;
    }

    if (!isDummyId) {
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        responseUtils.notFoundResponse(res, 'Category not found');
        return;
      }
    }

    // Create product
    const productData: any = {
      name,
      category,
      images,
    };

    if (description !== undefined && description !== null && description !== '') {
      productData.description = description;
    }

    const product = new Product(productData);

    await product.save();

    // Populate categories (handles both real and dummy IDs)
    const populatedProducts = await populateCategories([product]);
    const finalProduct = populatedProducts[0];

    responseUtils.createdResponse(res, 'Product created successfully', { product: finalProduct });
  } catch (error: any) {
    getLogger().error('Create product error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      responseUtils.conflictResponse(res, `${field} already exists`);
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to create product');
  }
};

// Update product
export const updateProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid product ID');
      return;
    }

    const product = await Product.findById(id);
    if (!product) {
      responseUtils.notFoundResponse(res, 'Product not found');
      return;
    }

    const {
      name,
      category: categoryRaw,
      description,
      images: imagesFromBody,
    } = req.body;

    // Handle category - if it's an array (from FormData), take the first value
    const category = Array.isArray(categoryRaw) ? categoryRaw[0] : categoryRaw;

    // Get uploaded image URLs from multer (if any new files uploaded)
    let newImages: string[] = [];
    if (req.files && Array.isArray(req.files)) {
      newImages = req.files.map((file: any) => {
        // Use key property if available (multer-s3 v3 provides this)
        if (file.key) {
          return `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${file.key}`;
        }
        // If location is provided and is an HTTPS URL, use it
        if (file.location && file.location.startsWith('https://')) {
          return file.location;
        }
        // If location is S3 protocol, extract key and construct HTTPS URL
        if (file.location && file.location.startsWith('s3://')) {
          const key = file.location.replace(`s3://${s3Config.bucketName}/`, '');
          return `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${key}`;
        }
        // Fallback to file.path for local development
        return file.path;
      });
    }

    // Validate category if provided
    if (category) {
      const isDummyId = typeof category === 'string' && category.endsWith('-id');
      if (!isDummyId && !mongoose.Types.ObjectId.isValid(category)) {
        responseUtils.badRequestResponse(res, 'Invalid category ID');
        return;
      }
      if (!isDummyId) {
        const categoryExists = await Category.findById(category);
        if (!categoryExists) {
          responseUtils.notFoundResponse(res, 'Category not found');
          return;
        }
      }
      product.category = category;
    }

    // Update fields
    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    
    // Update images only if new files were uploaded
    if (newImages.length > 0) {
      // Delete old images from S3 before updating
      if (product.images && product.images.length > 0) {
        await deleteOldImagesFromS3(product.images);
      }
      product.images = newImages;
    } else if (imagesFromBody !== undefined) {
      // Update images from body if provided
      const updatedImages = Array.isArray(imagesFromBody) ? imagesFromBody : [imagesFromBody];
      if (updatedImages.length === 0) {
        responseUtils.badRequestResponse(res, 'At least one image is required');
        return;
      }
      product.images = updatedImages;
    }

    await product.save();

    // Populate categories (handles both real and dummy IDs)
    const populatedProducts = await populateCategories([product]);
    const finalProduct = populatedProducts[0];

    responseUtils.successResponse(res, 'Product updated successfully', { product: finalProduct });
  } catch (error: any) {
    getLogger().error('Update product error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      responseUtils.conflictResponse(res, `${field} already exists`);
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to update product');
  }
};

// Delete product
export const deleteProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid product ID');
      return;
    }

    const product = await Product.findById(id);
    if (!product) {
      responseUtils.notFoundResponse(res, 'Product not found');
      return;
    }

    // Hard delete - permanently remove the product
    // Delete images from S3 before removing the product
    if (product.images && product.images.length > 0) {
      await deleteOldImagesFromS3(product.images);
    }

    await Product.findByIdAndDelete(id);

    responseUtils.successResponse(res, 'Product deleted successfully');
  } catch (error) {
    getLogger().error('Delete product error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete product');
  }
};

// Hard delete product (permanent)
export const hardDeleteProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid product ID');
      return;
    }

    const product = await Product.findById(id);
    if (!product) {
      responseUtils.notFoundResponse(res, 'Product not found');
      return;
    }

    // Delete images from S3 before removing the product
    if (product.images && product.images.length > 0) {
      await deleteOldImagesFromS3(product.images);
    }

    // Permanently delete the product
    await Product.findByIdAndDelete(id);

    responseUtils.successResponse(res, 'Product permanently deleted');
  } catch (error) {
    getLogger().error('Hard delete product error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete product');
  }
};

// Get products stats (total count)
export const getProductsStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const total = await Product.countDocuments();

    responseUtils.successResponse(res, 'Products count retrieved successfully', {
      total
    });
  } catch (error) {
    getLogger().error('Get products count error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve products count');
  }
};

// Get products for a location (finds nearby store and returns store products with stock)
export const getProductsByLocation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const lng = parseFloat(req.query.lng as string);
    const lat = parseFloat(req.query.lat as string);
    const maxDistance = parseFloat(req.query.maxDistance as string) || 10; // km
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const category = req.query.category as string;
    const search = req.query.search as string;
    const isFeatured = req.query.isFeatured === 'true';

    if (isNaN(lng) || isNaN(lat)) {
      responseUtils.badRequestResponse(res, 'Valid lng and lat query parameters are required');
      return;
    }

    // Find nearby stores
    const { Store } = require('../models/store.model');
    const { InventoryBatch } = require('../models/inventoryBatch.model');
    const stores = await Store.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat],
          },
          $maxDistance: maxDistance * 1000, // Convert km to meters
        },
      },
      isActive: true,
    }).lean();

    if (!stores || stores.length === 0) {
      responseUtils.successResponse(res, 'No stores available at this location', { 
        products: [],
        store: null,
        hasStore: false 
      });
      return;
    }

    // Use the nearest store (first result from $near query)
    const nearestStore = stores[0];
    const storeId = nearestStore._id;

    // Get store products for this store with populated product data
    const { StoreProduct } = require('../models/storeProduct.model');
    const storeProductFilter: any = {
      storeId: storeId,
      isActive: true,
    };
    
    // Filter by isFeatured if provided (isFeatured is on StoreProduct, not Product)
    if (isFeatured !== undefined) {
      storeProductFilter.isFeatured = isFeatured;
    }
    
    const storeProducts = await StoreProduct.find(storeProductFilter)
      .populate('productId', 'name images category description')
      .lean();

    if (!storeProducts || storeProducts.length === 0) {
      responseUtils.successResponse(res, 'No products available at this store', {
        products: [],
        store: {
          _id: nearestStore._id,
          name: nearestStore.name,
          location: nearestStore.location,
        },
        hasStore: true,
      });
      return;
    }

    // Get all product IDs from store products
    const productIds = storeProducts.map((sp: any) => {
      const productId = sp.productId._id || sp.productId;
      return productId instanceof mongoose.Types.ObjectId ? productId : new mongoose.Types.ObjectId(productId);
    });

    // Get all inventory batches for these products in this store
    const inventoryBatches = await InventoryBatch.find({
      storeId: storeId,
      productId: { $in: productIds },
      status: 'active',
    }).lean();

    // Filter products by category if provided
    let filteredStoreProducts = storeProducts;
    if (category) {
      filteredStoreProducts = storeProducts.filter((sp: any) => {
        const product = sp.productId;
        if (!product) return false;
        const productCategory = product.category;
        if (typeof productCategory === 'string') {
          return productCategory === category || (productCategory.endsWith('-id') && category.endsWith('-id'));
        }
        return productCategory && productCategory._id && productCategory._id.toString() === category;
      });
    }

    // Filter by search if provided
    if (search) {
      filteredStoreProducts = filteredStoreProducts.filter((sp: any) => {
        const product = sp.productId;
        if (!product) return false;
        return product.name && product.name.toLowerCase().includes(search.toLowerCase());
      });
    }

    // Note: isFeatured filtering is now done in the initial StoreProduct query above

    // Apply pagination
    const total = filteredStoreProducts.length;
    const paginatedStoreProducts = filteredStoreProducts.slice(skip, skip + limit);

    // Helper function to calculate stock for a variant
    const calculateVariantStock = (productId: mongoose.Types.ObjectId, variantSku: string): number => {
      const productIdStr = productId.toString();
      
      // Get batches for this product
      const productBatches = inventoryBatches.filter((batch: any) => {
        const batchProductId = batch.productId instanceof mongoose.Types.ObjectId 
          ? batch.productId.toString() 
          : String(batch.productId);
        return batchProductId === productIdStr;
      });

      // Check if product uses shared stock
      const hasSharedStock = productBatches.some((batch: any) => batch.usesSharedStock === true);
      
      if (hasSharedStock) {
        // Shared stock: Sum all active shared stock batches
        const sharedBatches = productBatches.filter((batch: any) => {
          const isExpired = batch.expiryDate && new Date(batch.expiryDate) < new Date();
          return batch.usesSharedStock === true && batch.status === 'active' && !isExpired;
        });
        
        return sharedBatches.reduce((sum: number, batch: any) => {
          return sum + (batch.availableQuantity || 0);
        }, 0);
      } else {
        // Non-shared stock: Match by variantSku
        const variantBatches = productBatches.filter((batch: any) => {
          const isExpired = batch.expiryDate && new Date(batch.expiryDate) < new Date();
          return batch.variantSku === variantSku && batch.status === 'active' && !isExpired;
        });
        
        return variantBatches.reduce((sum: number, batch: any) => {
          return sum + (batch.availableQuantity || 0);
        }, 0);
      }
    };

    // Enrich products with pricing from StoreProduct and stock from InventoryBatch
    const enrichedProducts = paginatedStoreProducts.map((storeProduct: any) => {
      const product = storeProduct.productId;
      const productId = product._id || product;
      const productIdObj = productId instanceof mongoose.Types.ObjectId 
        ? productId 
        : new mongoose.Types.ObjectId(productId);

      // Enrich each variant with stock information
      const enrichedVariants = storeProduct.variants.map((variant: any) => {
        const stock = calculateVariantStock(productIdObj, variant.sku);
        const isOutOfStock = stock <= 0;

        return {
          sku: variant.sku,
          size: variant.size,
          unit: variant.unit,
          originalPrice: variant.mrp,
          sellingPrice: variant.sellingPrice,
          discount: variant.discount,
          stock: stock,
          isAvailable: variant.isAvailable && !isOutOfStock,
          isOutOfStock: isOutOfStock,
        };
      });

      // Get the first available variant for backward compatibility
      const firstVariant = enrichedVariants.find((v: any) => v.isAvailable) || enrichedVariants[0];
      const totalStock = enrichedVariants.reduce((sum: number, v: any) => sum + v.stock, 0);

      return {
        _id: productId,
        name: product.name,
        category: product.category,
        description: product.description,
        images: product.images || [],
        variants: enrichedVariants,
        // Backward compatibility fields
        originalPrice: firstVariant?.originalPrice || 0,
        sellingPrice: firstVariant?.sellingPrice || 0,
        discount: firstVariant?.discount || 0,
        size: firstVariant?.size || 0,
        unit: firstVariant?.unit || '',
        stock: totalStock,
        isAvailable: enrichedVariants.some((v: any) => v.isAvailable),
        isOutOfStock: totalStock <= 0,
        // Store product specific fields
        isFeatured: storeProduct.isFeatured || false,
        isActive: storeProduct.isActive !== false,
      };
    });

    // Populate categories
    const populatedProducts = await populateCategories(enrichedProducts);

    const totalPages = Math.ceil(total / limit);
    const meta = {
      page,
      limit,
      total,
      totalPages,
    };

    responseUtils.successResponse(
      res,
      'Products retrieved successfully',
      {
        products: populatedProducts,
        store: {
          _id: nearestStore._id,
          name: nearestStore.name,
          location: nearestStore.location,
        },
        hasStore: true,
      },
      200,
      meta
    );
  } catch (error) {
    getLogger().error('Get products by location error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve products for location');
  }
};

// Product controller object
export const productController = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  hardDeleteProduct,
  getProductsStats,
  getProductsByLocation,
};
