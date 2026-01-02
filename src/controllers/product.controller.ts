// Product controller
import { Response } from 'express';
import { Product } from '../models/product.model';
import { Category } from '../models/category.model';
import { responseUtils } from '../utils/response';
import { enrichProducts, enrichProduct } from '../utils/productEnrichment';
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

    // Filter by status
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
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

    // Enrich products with batch data (pricing, stock, discount)
    const enrichedProducts = await enrichProducts(populatedProducts);

    // Ensure enriched fields are included in response (explicitly map to ensure serialization)
    const productsWithEnrichment = enrichedProducts.map((product: any) => ({
      ...product,
      discount: product.discount ?? 0,
      stock: product.stock ?? 0,
      originalPrice: product.originalPrice ?? 0,
      sellingPrice: product.sellingPrice ?? 0,
      averageCostPerQuantity: product.averageCostPerQuantity ?? 0,
      size: product.size ?? 0,
    }));

    responseUtils.paginatedResponse(
      res,
      'Products retrieved successfully',
      productsWithEnrichment,
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

    // Enrich product with batch data (pricing, stock, discount)
    const enrichedProduct = await enrichProduct(populatedProduct);

    // Ensure enriched fields are included in response (explicitly map to ensure serialization)
    const productWithEnrichment = {
      ...enrichedProduct,
      discount: enrichedProduct.discount ?? 0,
      stock: enrichedProduct.stock ?? 0,
      originalPrice: enrichedProduct.originalPrice ?? 0,
      sellingPrice: enrichedProduct.sellingPrice ?? 0,
      averageCostPerQuantity: enrichedProduct.averageCostPerQuantity ?? 0,
      size: enrichedProduct.size ?? 0,
    };

    responseUtils.successResponse(res, 'Product retrieved successfully', { product: productWithEnrichment });
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
      size,
      unit,
      variants: variantsRaw,
      images: imagesFromBody,
      attributes,
      isActive,
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

    // Parse variants if provided
    let parsedVariants: Array<{ size: number; unit: 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen' }> = [];
    if (variantsRaw) {
      try {
        const variantsData = typeof variantsRaw === 'string' ? JSON.parse(variantsRaw) : variantsRaw;
        if (Array.isArray(variantsData) && variantsData.length > 0) {
          parsedVariants = variantsData.map((v: any) => {
            const unit = v.unit as string;
            if (!['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'].includes(unit)) {
              throw new Error('Invalid unit');
            }
            return {
              size: parseFloat(v.size),
              unit: unit as 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen',
            };
          });
          // Validate variants
          for (const variant of parsedVariants) {
            if (isNaN(variant.size) || variant.size <= 0) {
              responseUtils.badRequestResponse(res, 'All variant sizes must be positive numbers');
              return;
            }
          }
        }
      } catch (error) {
        responseUtils.badRequestResponse(res, 'Invalid variants format');
        return;
      }
    }

    // Validate size (for backward compatibility) or variants
    if (parsedVariants.length === 0) {
      if (!size || isNaN(parseFloat(size as any)) || parseFloat(size as any) <= 0) {
        responseUtils.badRequestResponse(res, 'Either size/unit or variants array is required');
        return;
      }
      if (!unit || !['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'].includes(unit)) {
        responseUtils.badRequestResponse(res, 'Valid unit is required');
        return;
      }
    }

    // Parse attributes if it's a JSON string (from FormData)
    let parsedAttributes = attributes;
    if (typeof attributes === 'string') {
      try {
        parsedAttributes = JSON.parse(attributes);
      } catch (error) {
        parsedAttributes = {};
      }
    }
    // Ensure attributes is always a Map/object
    if (!parsedAttributes || typeof parsedAttributes !== 'object') {
      parsedAttributes = {};
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
      attributes: parsedAttributes,
      isActive: isActive !== undefined ? isActive : true,
    };

    // Set variants if provided, otherwise use size/unit for backward compatibility
    if (parsedVariants.length > 0) {
      productData.variants = parsedVariants;
      // Set size/unit from first variant for backward compatibility
      productData.size = parsedVariants[0].size;
      productData.unit = parsedVariants[0].unit;
    } else {
      productData.size = parseFloat(size as any);
      productData.unit = unit;
      // Pre-save hook will create variant from size/unit
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
      size,
      unit,
      variants: variantsRaw,
      images: imagesFromBody,
      attributes,
      isActive,
    } = req.body;

    // Handle category - if it's an array (from FormData), take the first value
    const category = Array.isArray(categoryRaw) ? categoryRaw[0] : categoryRaw;

    // Parse variants if provided
    let parsedVariants: Array<{ size: number; unit: 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen' }> | undefined = undefined;
    if (variantsRaw !== undefined) {
      try {
        const variantsData = typeof variantsRaw === 'string' ? JSON.parse(variantsRaw) : variantsRaw;
        if (Array.isArray(variantsData) && variantsData.length > 0) {
          parsedVariants = variantsData.map((v: any) => {
            const unit = v.unit as string;
            if (!['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'].includes(unit)) {
              throw new Error('Invalid unit');
            }
            return {
              size: parseFloat(v.size),
              unit: unit as 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen',
            };
          });
          // Validate variants
          for (const variant of parsedVariants) {
            if (isNaN(variant.size) || variant.size <= 0) {
              responseUtils.badRequestResponse(res, 'All variant sizes must be positive numbers');
              return;
            }
          }
        } else if (Array.isArray(variantsData) && variantsData.length === 0) {
          responseUtils.badRequestResponse(res, 'At least one variant is required');
          return;
        }
      } catch (error) {
        responseUtils.badRequestResponse(res, 'Invalid variants format');
        return;
      }
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

    // Parse attributes if it's a JSON string (from FormData)
    let parsedAttributes = attributes;
    if (typeof attributes === 'string') {
      try {
        parsedAttributes = JSON.parse(attributes);
      } catch (error) {
        parsedAttributes = undefined;
      }
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
    if (category !== undefined) {
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
    // Handle variants update
    if (parsedVariants !== undefined) {
      product.variants = parsedVariants;
      // Update size/unit from first variant for backward compatibility
      if (parsedVariants.length > 0) {
        product.size = parsedVariants[0].size;
        product.unit = parsedVariants[0].unit;
      }
    } else {
      // Handle size/unit update for backward compatibility
      if (size !== undefined) {
        const parsedSize = parseFloat(size as any);
        if (isNaN(parsedSize) || parsedSize <= 0) {
          responseUtils.badRequestResponse(res, 'Size must be a positive number');
          return;
        }
        product.size = parsedSize;
        // If variants exist, update first variant or create one
        if (product.variants && product.variants.length > 0) {
          product.variants[0].size = parsedSize;
        }
      }
      if (unit !== undefined) {
        product.unit = unit;
        // If variants exist, update first variant or create one
        if (product.variants && product.variants.length > 0) {
          product.variants[0].unit = unit;
        }
      }
    }
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
    if (parsedAttributes !== undefined) {
      if (!parsedAttributes || typeof parsedAttributes !== 'object') {
        responseUtils.badRequestResponse(res, 'Attributes must be a valid object');
        return;
      }
      product.attributes = parsedAttributes;
    }
    if (isActive !== undefined) product.isActive = isActive;

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

    // Soft delete - set isActive to false
    product.isActive = false;
    await product.save();

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

// Get products stats (total and active counts)
export const getProductsStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [total, active] = await Promise.all([
      Product.countDocuments(),
      Product.countDocuments({ isActive: true })
    ]);

    responseUtils.successResponse(res, 'Products count retrieved successfully', {
      total,
      active
    });
  } catch (error) {
    getLogger().error('Get products count error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve products count');
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
};
