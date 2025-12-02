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
    const hasDummySubcategory = product.subcategory && typeof product.subcategory === 'string' && product.subcategory.endsWith('-id');

    if (hasDummyCategory || hasDummySubcategory) {
      dummyIdProducts.push(product);
    } else {
      realIdProducts.push(product);
    }
  }

  // Populate real ObjectId products normally
  let populatedRealProducts: any[] = [];
  if (realIdProducts.length > 0) {
    populatedRealProducts = await Product.populate(realIdProducts, [
      { path: 'category', select: 'name' },
      { path: 'subcategory', select: 'name' }
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

    if (productObj.subcategory && typeof productObj.subcategory === 'string' && productObj.subcategory.endsWith('-id')) {
      productObj.subcategory = {
        _id: productObj.subcategory,
        name: getDummyCategoryName(productObj.subcategory)
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
        { description: { $regex: req.query.search, $options: 'i' } },
        { sku: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    // Filter by status
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    if (req.query.isOutOfStock !== undefined) {
      filter.isOutOfStock = req.query.isOutOfStock === 'true';
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
      description,
      category,
      subcategory,
      price,
      originalPrice,
      discount,
      cost,
      stock,
      minStock,
      maxStock,
      sku,
      barcode,
      thumbnail,
      brand,
      weight,
      unit,
      nutritionalInfo,
      tags,
      attributes,
      isActive,
      isFeatured,
      slug,
      metaTitle,
      metaDescription,
    } = req.body;

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

    // Parse nutritionalInfo if it's a JSON string (from FormData)
    let parsedNutritionalInfo = nutritionalInfo;
    if (typeof nutritionalInfo === 'string') {
      try {
        parsedNutritionalInfo = JSON.parse(nutritionalInfo);
      } catch (error) {
        parsedNutritionalInfo = undefined;
      }
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

    // Validate subcategory if provided
    if (subcategory) {
      const isDummySubId = typeof subcategory === 'string' && subcategory.endsWith('-id');
      if (!isDummySubId && !mongoose.Types.ObjectId.isValid(subcategory)) {
        responseUtils.badRequestResponse(res, 'Invalid subcategory ID');
        return;
      }
      if (!isDummySubId) {
        const subcategoryExists = await Category.findById(subcategory);
        if (!subcategoryExists) {
          responseUtils.notFoundResponse(res, 'Subcategory not found');
          return;
        }
      }
    }

    // Check if SKU already exists
    const existingProduct = await Product.findOne({ sku: sku?.toUpperCase() });
    if (existingProduct) {
      responseUtils.conflictResponse(res, 'Product with this SKU already exists');
      return;
    }

    // Create product
    const product = new Product({
      name,
      description,
      category,
      subcategory,
      price,
      originalPrice,
      discount,
      cost,
      stock: stock || 0,
      minStock: minStock || 5,
      maxStock,
      sku: sku?.toUpperCase(),
      barcode,
      images,
      thumbnail,
      brand,
      weight,
      unit,
      nutritionalInfo: parsedNutritionalInfo,
      tags: tags || [],
      attributes: attributes || {},
      isActive: isActive !== undefined ? isActive : true,
      isFeatured: isFeatured || false,
      isOutOfStock: (stock || 0) <= 0,
      slug,
      metaTitle,
      metaDescription,
    });

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
      description,
      category,
      subcategory,
      price,
      originalPrice,
      discount,
      cost,
      stock,
      minStock,
      maxStock,
      sku,
      barcode,
      thumbnail,
      brand,
      weight,
      unit,
      nutritionalInfo,
      tags,
      attributes,
      isActive,
      isFeatured,
      slug,
      metaTitle,
      metaDescription,
    } = req.body;

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

    // Parse nutritionalInfo if it's a JSON string (from FormData)
    let parsedNutritionalInfo = nutritionalInfo;
    if (typeof nutritionalInfo === 'string') {
      try {
        parsedNutritionalInfo = JSON.parse(nutritionalInfo);
      } catch (error) {
        parsedNutritionalInfo = undefined;
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

    // Validate subcategory if provided
    if (subcategory !== undefined) {
      if (subcategory === null) {
        product.subcategory = undefined;
      } else {
        const isDummySubId = typeof subcategory === 'string' && subcategory.endsWith('-id');
        if (!isDummySubId && !mongoose.Types.ObjectId.isValid(subcategory)) {
          responseUtils.badRequestResponse(res, 'Invalid subcategory ID');
          return;
        }
        if (!isDummySubId) {
          const subcategoryExists = await Category.findById(subcategory);
          if (!subcategoryExists) {
            responseUtils.notFoundResponse(res, 'Subcategory not found');
            return;
          }
        }
        product.subcategory = subcategory;
      }
    }

    // Check SKU uniqueness if changed
    if (sku && sku.toUpperCase() !== product.sku) {
      const existingProduct = await Product.findOne({ sku: sku.toUpperCase() });
      if (existingProduct) {
        responseUtils.conflictResponse(res, 'Product with this SKU already exists');
        return;
      }
      product.sku = sku.toUpperCase();
    }

    // Update fields
    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    if (price !== undefined) product.price = price;
    if (originalPrice !== undefined) product.originalPrice = originalPrice;
    if (discount !== undefined) product.discount = discount;
    if (cost !== undefined) product.cost = cost;
    if (stock !== undefined) {
      product.stock = stock;
      product.isOutOfStock = stock <= 0;
    }
    if (minStock !== undefined) product.minStock = minStock;
    if (maxStock !== undefined) product.maxStock = maxStock;
    if (barcode !== undefined) product.barcode = barcode;
    // Update images only if new files were uploaded
    if (newImages.length > 0) {
      // Delete old images from S3 before updating
      if (product.images && product.images.length > 0) {
        await deleteOldImagesFromS3(product.images);
      }
      product.images = newImages;
    }
    if (thumbnail !== undefined) product.thumbnail = thumbnail;
    if (brand !== undefined) product.brand = brand;
    if (weight !== undefined) product.weight = weight;
    if (unit !== undefined) product.unit = unit;
    if (parsedNutritionalInfo !== undefined) product.nutritionalInfo = parsedNutritionalInfo;
    if (tags !== undefined) product.tags = tags;
    if (attributes !== undefined) product.attributes = attributes;
    if (isActive !== undefined) product.isActive = isActive;
    if (isFeatured !== undefined) product.isFeatured = isFeatured;
    if (slug !== undefined) product.slug = slug;
    if (metaTitle !== undefined) product.metaTitle = metaTitle;
    if (metaDescription !== undefined) product.metaDescription = metaDescription;

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
