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
      keywords: keywordsRaw,
    } = req.body;

    // Handle category - if it's an array (from FormData), take the first value
    const category = Array.isArray(categoryRaw) ? categoryRaw[0] : categoryRaw;

    // Handle keywords - can be string (comma-separated) or array
    let keywords: string[] = [];
    if (keywordsRaw) {
      if (typeof keywordsRaw === 'string') {
        // Parse comma-separated string or JSON string
        try {
          const parsed = JSON.parse(keywordsRaw);
          keywords = Array.isArray(parsed) ? parsed : keywordsRaw.split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
        } catch {
          // Not JSON, treat as comma-separated string
          keywords = keywordsRaw.split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
        }
      } else if (Array.isArray(keywordsRaw)) {
        keywords = keywordsRaw.map((k: string) => String(k).trim()).filter((k: string) => k.length > 0);
      }
    }

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

    if (keywords.length > 0) {
      productData.keywords = keywords;
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
      existingImages: existingImagesRaw,
      keywords: keywordsRaw,
    } = req.body;

    // Handle category - if it's an array (from FormData), take the first value
    const category = Array.isArray(categoryRaw) ? categoryRaw[0] : categoryRaw;

    // Handle keywords - can be string (comma-separated) or array
    if (keywordsRaw !== undefined) {
      let keywords: string[] = [];
      if (typeof keywordsRaw === 'string') {
        // Parse comma-separated string or JSON string
        try {
          const parsed = JSON.parse(keywordsRaw);
          keywords = Array.isArray(parsed) ? parsed : keywordsRaw.split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
        } catch {
          // Not JSON, treat as comma-separated string
          keywords = keywordsRaw.split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
        }
      } else if (Array.isArray(keywordsRaw)) {
        keywords = keywordsRaw.map((k: string) => String(k).trim()).filter((k: string) => k.length > 0);
      }
      // If keywordsRaw is empty string or empty array, set to empty array
      product.keywords = keywords;
    }

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
    } else if (existingImagesRaw !== undefined) {
      // Handle existing images sent as JSON string (when updating without new files)
      let existingImages: string[] = [];
      if (typeof existingImagesRaw === 'string') {
        try {
          const parsed = JSON.parse(existingImagesRaw);
          existingImages = Array.isArray(parsed) ? parsed : [];
        } catch {
          // Not valid JSON, treat as empty
          existingImages = [];
        }
      } else if (Array.isArray(existingImagesRaw)) {
        existingImages = existingImagesRaw;
      }
      
      if (existingImages.length === 0) {
        responseUtils.badRequestResponse(res, 'At least one image is required');
        return;
      }
      product.images = existingImages;
    } else if (imagesFromBody !== undefined) {
      // Update images from body if provided (fallback for other formats)
      const updatedImages = Array.isArray(imagesFromBody) ? imagesFromBody : [imagesFromBody];
      if (updatedImages.length === 0) {
        responseUtils.badRequestResponse(res, 'At least one image is required');
        return;
      }
      product.images = updatedImages;
    }
    // If none of the above, existing images are preserved (no update to images field)

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
          sku: variant.sku, // Keep sku for backward compatibility
          variantSku: variant.sku, // ⚠️ CRITICAL: Always use variantSku from StoreProduct, never construct it
          size: variant.size,
          unit: variant.unit,
          originalPrice: variant.mrp,
          sellingPrice: variant.sellingPrice,
          discount: variant.discount,
          stock: stock,
          isAvailable: variant.isAvailable && !isOutOfStock,
          isOutOfStock: isOutOfStock,
          maximumOrderLimit: variant.maximumOrderLimit,
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

// Location-based search API
// Returns 2 arrays: searchProducts (matching query) and relatedProducts (same category)
export const searchProductsByLocation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const lng = parseFloat(req.query.lng as string);
    const lat = parseFloat(req.query.lat as string);
    const maxDistance = parseFloat(req.query.maxDistance as string) || 10; // km
    const searchQuery = (req.query.q as string || req.query.search as string || '').trim().toLowerCase();
    const limit = parseInt(req.query.limit as string) || 20;

    if (isNaN(lng) || isNaN(lat)) {
      responseUtils.badRequestResponse(res, 'Valid lng and lat query parameters are required');
      return;
    }

    if (!searchQuery || searchQuery.length === 0) {
      responseUtils.badRequestResponse(res, 'Search query (q or search) is required');
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
        searchProducts: [],
        relatedProducts: [],
        store: null,
        hasStore: false,
      });
      return;
    }

    // Use the nearest store (first result from $near query)
    const nearestStore = stores[0];
    const storeId = nearestStore._id;

    // Get store products for this store with populated product data
    const { StoreProduct } = require('../models/storeProduct.model');
    const storeProducts = await StoreProduct.find({
      storeId: storeId,
      isActive: true,
    })
      .populate('productId', 'name images category description keywords')
      .lean();

    if (!storeProducts || storeProducts.length === 0) {
      responseUtils.successResponse(res, 'No products available at this store', {
        searchProducts: [],
        relatedProducts: [],
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

    // Helper function to calculate stock for a variant
    const calculateVariantStock = (productId: mongoose.Types.ObjectId, variantSku: string): number => {
      const productIdStr = productId.toString();
      
      const productBatches = inventoryBatches.filter((batch: any) => {
        const batchProductId = batch.productId instanceof mongoose.Types.ObjectId 
          ? batch.productId.toString() 
          : String(batch.productId);
        return batchProductId === productIdStr;
      });

      const hasSharedStock = productBatches.some((batch: any) => batch.usesSharedStock === true);
      
      if (hasSharedStock) {
        const sharedBatches = productBatches.filter((batch: any) => {
          const isExpired = batch.expiryDate && new Date(batch.expiryDate) < new Date();
          return batch.usesSharedStock === true && batch.status === 'active' && !isExpired;
        });
        
        return sharedBatches.reduce((sum: number, batch: any) => {
          return sum + (batch.availableQuantity || 0);
        }, 0);
      } else {
        const variantBatches = productBatches.filter((batch: any) => {
          const isExpired = batch.expiryDate && new Date(batch.expiryDate) < new Date();
          return batch.variantSku === variantSku && batch.status === 'active' && !isExpired;
        });
        
        return variantBatches.reduce((sum: number, batch: any) => {
          return sum + (batch.availableQuantity || 0);
        }, 0);
      }
    };

    // Smart search function - supports exact match, partial match, misspellings, keywords
    const matchesSearch = (product: any, query: string): boolean => {
      if (!product || !product.productId) return false;

      const productName = (product.productId.name || '').toLowerCase();
      const productDescription = (product.productId.description || '').toLowerCase();
      const keywords = (product.productId.keywords || []).map((k: string) => k.toLowerCase());

      // Exact match (highest priority)
      if (productName === query) return true;

      // Partial match in name
      if (productName.includes(query)) return true;

      // Keyword match
      if (keywords.some((keyword: string) => keyword.includes(query) || query.includes(keyword))) {
        return true;
      }

      // Partial match in description
      if (productDescription.includes(query)) return true;

      // Fuzzy match - check if query is contained in name (handles misspellings partially)
      const nameWords = productName.split(/\s+/);
      const queryWords = query.split(/\s+/);
      
      // Check if any query word matches any name word (handles partial matches)
      for (const queryWord of queryWords) {
        for (const nameWord of nameWords) {
          if (nameWord.includes(queryWord) || queryWord.includes(nameWord)) {
            return true;
          }
        }
      }

      return false;
    };

    // Filter products by search query
    const searchResults = storeProducts.filter((sp: any) => matchesSearch(sp, searchQuery));

    // Enrich products with pricing and stock information
    const enrichProduct = (storeProduct: any) => {
      const product = storeProduct.productId;
      const productId = product._id || product;
      const productIdObj = productId instanceof mongoose.Types.ObjectId 
        ? productId 
        : new mongoose.Types.ObjectId(productId);

      const enrichedVariants = storeProduct.variants.map((variant: any) => {
        const stock = calculateVariantStock(productIdObj, variant.sku);
        const isOutOfStock = stock <= 0;

        return {
          sku: variant.sku,
          variantSku: variant.sku,
          size: variant.size,
          unit: variant.unit,
          originalPrice: variant.mrp,
          sellingPrice: variant.sellingPrice,
          discount: variant.discount,
          stock: stock,
          availableQuantity: stock,
          isAvailable: variant.isAvailable && !isOutOfStock,
          isOutOfStock: isOutOfStock,
          maximumOrderLimit: variant.maximumOrderLimit,
        };
      });

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
        availableQuantity: totalStock,
        isAvailable: enrichedVariants.some((v: any) => v.isAvailable),
        isOutOfStock: totalStock <= 0,
        // Store product specific fields
        isFeatured: storeProduct.isFeatured || false,
        isActive: storeProduct.isActive !== false,
      };
    };

    // Enrich search results
    const searchProducts = searchResults
      .map(enrichProduct)
      .filter((p: any) => p.isAvailable) // Only return available products
      .slice(0, limit);

    // Get unique category IDs from search results
    const searchCategoryIds = new Set<string>();
    searchProducts.forEach((product: any) => {
      const categoryId = product.category;
      if (categoryId) {
        const categoryIdStr = typeof categoryId === 'string' 
          ? categoryId 
          : (categoryId._id ? categoryId._id.toString() : categoryId.toString());
        searchCategoryIds.add(categoryIdStr);
      }
    });

    // Get related products (same category, excluding search results)
    const searchProductIds = new Set(searchProducts.map((p: any) => p._id.toString()));
    const relatedStoreProducts = storeProducts
      .filter((sp: any) => {
        // Exclude products already in search results
        const productId = sp.productId._id || sp.productId;
        const productIdStr = productId instanceof mongoose.Types.ObjectId 
          ? productId.toString() 
          : String(productId);
        if (searchProductIds.has(productIdStr)) return false;

        // Check if product is in same category as search results
        const productCategory = sp.productId.category;
        if (!productCategory) return false;

        const categoryIdStr = typeof productCategory === 'string'
          ? productCategory
          : (productCategory._id ? productCategory._id.toString() : productCategory.toString());
        
        return searchCategoryIds.has(categoryIdStr);
      })
      .map(enrichProduct)
      .filter((p: any) => p.isAvailable) // Only return available products
      .slice(0, limit);

    // Populate categories
    const populatedSearchProducts = await populateCategories(searchProducts);
    const populatedRelatedProducts = await populateCategories(relatedStoreProducts);

    responseUtils.successResponse(
      res,
      'Search completed successfully',
      {
        searchProducts: populatedSearchProducts,
        relatedProducts: populatedRelatedProducts,
        store: {
          _id: nearestStore._id,
          name: nearestStore.name,
          location: nearestStore.location,
        },
        hasStore: true,
        query: searchQuery,
      }
    );
  } catch (error) {
    getLogger().error('Search products by location error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to search products');
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
  searchProductsByLocation,
};
