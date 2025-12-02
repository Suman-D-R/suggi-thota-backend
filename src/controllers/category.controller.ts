// Category controller
import { Response } from 'express';
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
import mongoose from 'mongoose';
import { s3Config } from '../config/aws';

// Get all categories
export const getAllCategories = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { includeInactive } = req.query;
    const filter: any = {};

    if (includeInactive !== 'true') {
      filter.isActive = true;
    }

    const categories = await Category.find(filter)
      .populate('parentCategory', 'name')
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    responseUtils.successResponse(res, 'Categories retrieved successfully', { categories });
  } catch (error) {
    getLogger().error('Get all categories error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve categories');
  }
};

// Get main categories (parent categories)
export const getMainCategories = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const categories = await Category.findMainCategories().lean();

    responseUtils.successResponse(res, 'Main categories retrieved successfully', { categories });
  } catch (error) {
    getLogger().error('Get main categories error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve main categories');
  }
};

// Get subcategories by parent
export const getSubcategories = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { parentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(parentId)) {
      responseUtils.badRequestResponse(res, 'Invalid parent category ID');
      return;
    }

    const subcategories = await Category.findSubcategories(parentId).lean();

    responseUtils.successResponse(res, 'Subcategories retrieved successfully', { subcategories });
  } catch (error) {
    getLogger().error('Get subcategories error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve subcategories');
  }
};

// Get single category by ID
export const getCategoryById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid category ID');
      return;
    }

    const category = await Category.findById(id)
      .populate('parentCategory', 'name')
      .populate('subcategories', 'name');

    if (!category) {
      responseUtils.notFoundResponse(res, 'Category not found');
      return;
    }

    responseUtils.successResponse(res, 'Category retrieved successfully', { category });
  } catch (error) {
    getLogger().error('Get category by ID error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve category');
  }
};

// Create new category
export const createCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      name,
      description,
      image,
      icon,
      parentCategory,
      sortOrder,
      isActive,
      slug,
      metaTitle,
      metaDescription,
    } = req.body;

    // Get uploaded image URL from multer (single file upload)
    let imageUrl = image; // Default to provided image URL
    if (req.file) {
      const file = req.file as any;
      // Use key property if available (multer-s3 v3 provides this)
      if (file.key) {
        imageUrl = `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${file.key}`;
      }
      // If location is provided and is an HTTPS URL, use it
      else if (file.location && file.location.startsWith('https://')) {
        imageUrl = file.location;
      }
      // If location is S3 protocol, extract key and construct HTTPS URL
      else if (file.location && file.location.startsWith('s3://')) {
        const key = file.location.replace(`s3://${s3Config.bucketName}/`, '');
        imageUrl = `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${key}`;
      }
      // Fallback to file.path for local development
      else if (file.path) {
        imageUrl = file.path;
      }
    }

    // Validate required fields
    if (!name) {
      responseUtils.badRequestResponse(res, 'Category name is required');
      return;
    }

    // Validate parent category if provided
    if (parentCategory && !mongoose.Types.ObjectId.isValid(parentCategory)) {
      responseUtils.badRequestResponse(res, 'Invalid parent category ID');
      return;
    }

    // Check if parent category exists and is not a subcategory itself
    if (parentCategory) {
      const parent = await Category.findById(parentCategory);
      if (!parent) {
        responseUtils.notFoundResponse(res, 'Parent category not found');
        return;
      }
      if (parent.parentCategory) {
        responseUtils.badRequestResponse(res, 'Cannot create subcategory of a subcategory');
        return;
      }
    }

    // Generate slug if not provided
    let finalSlug = slug;
    if (!finalSlug) {
      finalSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    // Check if slug already exists
    const existingCategory = await Category.findOne({ slug: finalSlug });
    if (existingCategory) {
      responseUtils.conflictResponse(res, 'Category with this slug already exists');
      return;
    }

    // Create category
    const category = new Category({
      name,
      description,
      image: imageUrl,
      icon,
      parentCategory: parentCategory || null,
      sortOrder: sortOrder || 0,
      isActive: isActive !== undefined ? isActive : true,
      slug: finalSlug,
      metaTitle,
      metaDescription,
    });

    await category.save();

    // If this is a subcategory, add it to parent's subcategories array
    if (parentCategory) {
      await Category.findByIdAndUpdate(parentCategory, {
        $addToSet: { subcategories: category._id }
      });
    }

    // Populate parent category info
    const populatedCategory = await Category.findById(category._id)
      .populate('parentCategory', 'name');

    responseUtils.createdResponse(res, 'Category created successfully', { category: populatedCategory });
  } catch (error: any) {
    getLogger().error('Create category error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      responseUtils.conflictResponse(res, `${field} already exists`);
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to create category');
  }
};

// Update category
export const updateCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid category ID');
      return;
    }

    const category = await Category.findById(id);
    if (!category) {
      responseUtils.notFoundResponse(res, 'Category not found');
      return;
    }

    const {
      name,
      description,
      image,
      icon,
      parentCategory,
      sortOrder,
      isActive,
      slug,
      metaTitle,
      metaDescription,
    } = req.body;

    // Get uploaded image URL from multer (single file upload)
    // If a new file is uploaded, use it; otherwise keep existing image or use provided URL
    let imageUrl = image;
    if (req.file) {
      const file = req.file as any;
      // Use key property if available (multer-s3 v3 provides this)
      if (file.key) {
        imageUrl = `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${file.key}`;
      }
      // If location is provided and is an HTTPS URL, use it
      else if (file.location && file.location.startsWith('https://')) {
        imageUrl = file.location;
      }
      // If location is S3 protocol, extract key and construct HTTPS URL
      else if (file.location && file.location.startsWith('s3://')) {
        const key = file.location.replace(`s3://${s3Config.bucketName}/`, '');
        imageUrl = `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${key}`;
      }
      // Fallback to file.path for local development
      else if (file.path) {
        imageUrl = file.path;
      }
    } else if (image === undefined || image === '') {
      // If no file uploaded and no image provided, keep existing image
      imageUrl = category.image;
    }

    // Validate parent category if provided
    if (parentCategory !== undefined) {
      if (parentCategory && !mongoose.Types.ObjectId.isValid(parentCategory)) {
        responseUtils.badRequestResponse(res, 'Invalid parent category ID');
        return;
      }

      // Prevent circular references and invalid hierarchies
      if (parentCategory) {
        const parent = await Category.findById(parentCategory);
        if (!parent) {
          responseUtils.notFoundResponse(res, 'Parent category not found');
          return;
        }
        if (parent.parentCategory) {
          responseUtils.badRequestResponse(res, 'Cannot set subcategory as parent');
          return;
        }
        // Prevent category from being its own parent
        if (parentCategory === id) {
          responseUtils.badRequestResponse(res, 'Category cannot be its own parent');
          return;
        }
        // Prevent circular references in existing hierarchy
        const descendants = await (category as any).getAllDescendants();
        if (descendants.some((desc: any) => desc._id.toString() === parentCategory)) {
          responseUtils.badRequestResponse(res, 'Cannot move category under its own descendant');
          return;
        }
      }
    }

    // Check slug uniqueness if changed
    if (slug && slug !== category.slug) {
      const existingCategory = await Category.findOne({ slug });
      if (existingCategory) {
        responseUtils.conflictResponse(res, 'Category with this slug already exists');
        return;
      }
      category.slug = slug;
    }

    // Handle parent category change
    if (parentCategory !== undefined && parentCategory !== category.parentCategory?.toString()) {
      // Remove from old parent's subcategories
      if (category.parentCategory) {
        await Category.findByIdAndUpdate(category.parentCategory, {
          $pull: { subcategories: category._id }
        });
      }

      // Add to new parent's subcategories
      if (parentCategory) {
        await Category.findByIdAndUpdate(parentCategory, {
          $addToSet: { subcategories: category._id }
        });
      }

      category.parentCategory = parentCategory || null;
    }

    // Update fields
    if (name !== undefined) category.name = name;
    if (description !== undefined) category.description = description;
    if (imageUrl !== undefined) category.image = imageUrl;
    if (icon !== undefined) category.icon = icon;
    if (sortOrder !== undefined) category.sortOrder = sortOrder;
    if (isActive !== undefined) category.isActive = isActive;
    if (metaTitle !== undefined) category.metaTitle = metaTitle;
    if (metaDescription !== undefined) category.metaDescription = metaDescription;

    await category.save();

    // Populate updated category
    const populatedCategory = await Category.findById(category._id)
      .populate('parentCategory', 'name')
      .populate('subcategories', 'name');

    responseUtils.successResponse(res, 'Category updated successfully', { category: populatedCategory });
  } catch (error: any) {
    getLogger().error('Update category error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      responseUtils.conflictResponse(res, `${field} already exists`);
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to update category');
  }
};

// Delete category (soft delete)
export const deleteCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid category ID');
      return;
    }

    const category = await Category.findById(id);
    if (!category) {
      responseUtils.notFoundResponse(res, 'Category not found');
      return;
    }

    // Check if category has subcategories
    if (category.subcategories && category.subcategories.length > 0) {
      responseUtils.badRequestResponse(res, 'Cannot delete category with subcategories. Please delete or reassign subcategories first.');
      return;
    }

    // Soft delete - set isActive to false
    category.isActive = false;
    await category.save();

    // Remove from parent's subcategories array
    if (category.parentCategory) {
      await Category.findByIdAndUpdate(category.parentCategory, {
        $pull: { subcategories: category._id }
      });
    }

    responseUtils.successResponse(res, 'Category deleted successfully');
  } catch (error) {
    getLogger().error('Delete category error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete category');
  }
};

// Hard delete category (permanent)
export const hardDeleteCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid category ID');
      return;
    }

    const category = await Category.findById(id);
    if (!category) {
      responseUtils.notFoundResponse(res, 'Category not found');
      return;
    }

    // Check if category has subcategories
    if (category.subcategories && category.subcategories.length > 0) {
      responseUtils.badRequestResponse(res, 'Cannot delete category with subcategories. Please delete subcategories first.');
      return;
    }

    // Remove from parent's subcategories array
    if (category.parentCategory) {
      await Category.findByIdAndUpdate(category.parentCategory, {
        $pull: { subcategories: category._id }
      });
    }

    // Permanently delete the category
    await Category.findByIdAndDelete(id);

    responseUtils.successResponse(res, 'Category permanently deleted');
  } catch (error) {
    getLogger().error('Hard delete category error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete category');
  }
};

// Category controller object
export const categoryController = {
  getAllCategories,
  getMainCategories,
  getSubcategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  hardDeleteCategory,
};
