// Hero Banner controller
import { Response } from 'express';
import { HeroBanner } from '../models/heroBanner.model';
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

// Helper function to extract S3 key from image URL
const extractS3KeyFromUrl = (imageUrl: string): string | null => {
  try {
    const url = new URL(imageUrl);
    const key = url.pathname.substring(1); // Remove leading slash
    return key;
  } catch (error) {
    getLogger().error('Error extracting S3 key from URL:', error);
    return null;
  }
};

// Get all hero banners (public - returns only active ones)
export const getAllHeroBanners = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const includeInactive = req.query.includeInactive === 'true' && req.user?.role === 'admin';
    const storeId = req.query.storeId as string | undefined;
    
    const filter: any = {};
    if (!includeInactive) {
      filter.isActive = true;
    }
    
    // Filter by storeId if provided
    if (storeId) {
      if (mongoose.Types.ObjectId.isValid(storeId)) {
        filter.storeId = new mongoose.Types.ObjectId(storeId);
      } else {
        responseUtils.badRequestResponse(res, 'Invalid store ID');
        return;
      }
    }

    const banners = await HeroBanner.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    responseUtils.successResponse(res, 'Hero banners retrieved successfully', { banners });
  } catch (error) {
    getLogger().error('Get all hero banners error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve hero banners');
  }
};

// Get active hero banners (public endpoint)
export const getActiveHeroBanners = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const storeId = req.query.storeId as string | undefined;
    
    const filter: any = { isActive: true };
    
    // Filter by storeId if provided
    if (storeId) {
      if (mongoose.Types.ObjectId.isValid(storeId)) {
        filter.storeId = new mongoose.Types.ObjectId(storeId);
      } else {
        responseUtils.badRequestResponse(res, 'Invalid store ID');
        return;
      }
    }
    
    const banners = await HeroBanner.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    responseUtils.successResponse(res, 'Active hero banners retrieved successfully', { banners });
  } catch (error) {
    getLogger().error('Get active hero banners error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve active hero banners');
  }
};

// Get single hero banner by ID
export const getHeroBannerById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid hero banner ID');
      return;
    }

    const banner = await HeroBanner.findById(id);

    if (!banner) {
      responseUtils.notFoundResponse(res, 'Hero banner not found');
      return;
    }

    responseUtils.successResponse(res, 'Hero banner retrieved successfully', { banner });
  } catch (error) {
    getLogger().error('Get hero banner by ID error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve hero banner');
  }
};

// Create new hero banner
export const createHeroBanner = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      title,
      subtitle,
      backgroundColor,
      icon,
      link,
      isActive,
      sortOrder,
      storeId,
    } = req.body;

    // Get uploaded image URL from multer (if any)
    let image: string | undefined;
    if (req.file) {
      const file = req.file as any;
      // Use key property if available (multer-s3 v3 provides this)
      if (file.key) {
        image = `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${file.key}`;
      }
      // If location is provided and is an HTTPS URL, use it
      else if (file.location && file.location.startsWith('https://')) {
        image = file.location;
      }
      // If location is S3 protocol, extract key and construct HTTPS URL
      else if (file.location && file.location.startsWith('s3://')) {
        const key = file.location.replace(`s3://${s3Config.bucketName}/`, '');
        image = `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${key}`;
      }
      // Fallback to file.path for local development
      else {
        image = file.path;
      }
    }

    // Validate that either icon or image is provided
    if (!icon && !image) {
      responseUtils.badRequestResponse(res, 'Either icon or image must be provided');
      return;
    }
    
    // Validate storeId if provided
    let storeObjectId: mongoose.Types.ObjectId | undefined;
    if (storeId) {
      if (!mongoose.Types.ObjectId.isValid(storeId)) {
        responseUtils.badRequestResponse(res, 'Invalid store ID');
        return;
      }
      storeObjectId = new mongoose.Types.ObjectId(storeId);
    }

    // Create hero banner
    const banner = new HeroBanner({
      title,
      subtitle,
      backgroundColor: backgroundColor || '#4CAF50',
      icon,
      image,
      link,
      storeId: storeObjectId,
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder || 0,
    });

    await banner.save();

    responseUtils.createdResponse(res, 'Hero banner created successfully', { banner });
  } catch (error: any) {
    getLogger().error('Create hero banner error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      responseUtils.conflictResponse(res, `${field} already exists`);
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to create hero banner');
  }
};

// Update hero banner
export const updateHeroBanner = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid hero banner ID');
      return;
    }

    const banner = await HeroBanner.findById(id);
    if (!banner) {
      responseUtils.notFoundResponse(res, 'Hero banner not found');
      return;
    }

    const {
      title,
      subtitle,
      backgroundColor,
      icon,
      link,
      isActive,
      sortOrder,
      storeId,
    } = req.body;

    // Get uploaded image URL from multer (if any new file uploaded)
    let newImage: string | undefined;
    if (req.file) {
      const file = req.file as any;
      // Use key property if available (multer-s3 v3 provides this)
      if (file.key) {
        newImage = `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${file.key}`;
      }
      // If location is provided and is an HTTPS URL, use it
      else if (file.location && file.location.startsWith('https://')) {
        newImage = file.location;
      }
      // If location is S3 protocol, extract key and construct HTTPS URL
      else if (file.location && file.location.startsWith('s3://')) {
        const key = file.location.replace(`s3://${s3Config.bucketName}/`, '');
        newImage = `https://${s3Config.bucketName}.s3.${s3Config.region}.amazonaws.com/${key}`;
      }
      // Fallback to file.path for local development
      else {
        newImage = file.path;
      }

      // Delete old image from S3 before updating
      if (banner.image) {
        const oldImageKey = extractS3KeyFromUrl(banner.image);
        if (oldImageKey) {
          try {
            await s3Delete.deleteFromS3(oldImageKey);
            getLogger().info(`Deleted old hero banner image from S3: ${oldImageKey}`);
          } catch (error) {
            getLogger().error('Error deleting old image from S3:', error);
            // Don't throw error - we don't want to fail the update if deletion fails
          }
        }
      }
    }

    // Validate storeId if provided
    if (storeId !== undefined) {
      if (storeId === '' || storeId === null) {
        banner.storeId = undefined;
      } else {
        if (!mongoose.Types.ObjectId.isValid(storeId)) {
          responseUtils.badRequestResponse(res, 'Invalid store ID');
          return;
        }
        banner.storeId = new mongoose.Types.ObjectId(storeId);
      }
    }
    
    // Update fields
    if (title !== undefined) banner.title = title;
    if (subtitle !== undefined) banner.subtitle = subtitle;
    if (backgroundColor !== undefined) banner.backgroundColor = backgroundColor;
    if (icon !== undefined) banner.icon = icon;
    if (newImage !== undefined) {
      banner.image = newImage;
      // Clear icon if image is provided
      if (newImage) {
        banner.icon = undefined;
      }
    }
    if (link !== undefined) banner.link = link;
    if (isActive !== undefined) banner.isActive = isActive;
    if (sortOrder !== undefined) banner.sortOrder = sortOrder;

    // Validate that either icon or image is provided
    if (!banner.icon && !banner.image) {
      responseUtils.badRequestResponse(res, 'Either icon or image must be provided');
      return;
    }

    await banner.save();

    responseUtils.successResponse(res, 'Hero banner updated successfully', { banner });
  } catch (error: any) {
    getLogger().error('Update hero banner error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      responseUtils.conflictResponse(res, `${field} already exists`);
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to update hero banner');
  }
};

// Delete hero banner (soft delete)
export const deleteHeroBanner = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid hero banner ID');
      return;
    }

    const banner = await HeroBanner.findById(id);
    if (!banner) {
      responseUtils.notFoundResponse(res, 'Hero banner not found');
      return;
    }

    // Soft delete - set isActive to false
    banner.isActive = false;
    await banner.save();

    responseUtils.successResponse(res, 'Hero banner deleted successfully');
  } catch (error) {
    getLogger().error('Delete hero banner error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete hero banner');
  }
};

// Get banners by store ID
export const getBannersByStore = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { storeId } = req.params;
    const includeInactive = req.query.includeInactive === 'true' && req.user?.role === 'admin';

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      responseUtils.badRequestResponse(res, 'Invalid store ID');
      return;
    }

    const filter: any = {
      storeId: new mongoose.Types.ObjectId(storeId),
    };
    
    if (!includeInactive) {
      filter.isActive = true;
    }

    const banners = await HeroBanner.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    responseUtils.successResponse(res, 'Store banners retrieved successfully', { banners });
  } catch (error) {
    getLogger().error('Get banners by store error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve store banners');
  }
};

// Hard delete hero banner (permanent)
export const hardDeleteHeroBanner = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid hero banner ID');
      return;
    }

    const banner = await HeroBanner.findById(id);
    if (!banner) {
      responseUtils.notFoundResponse(res, 'Hero banner not found');
      return;
    }

    // Delete image from S3 before removing the banner
    if (banner.image) {
      const imageKey = extractS3KeyFromUrl(banner.image);
      if (imageKey) {
        try {
          await s3Delete.deleteFromS3(imageKey);
          getLogger().info(`Deleted hero banner image from S3: ${imageKey}`);
        } catch (error) {
          getLogger().error('Error deleting image from S3:', error);
          // Don't throw error - we don't want to fail the deletion if S3 deletion fails
        }
      }
    }

    // Permanently delete the banner
    await HeroBanner.findByIdAndDelete(id);

    responseUtils.successResponse(res, 'Hero banner permanently deleted');
  } catch (error) {
    getLogger().error('Hard delete hero banner error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete hero banner');
  }
};

// Hero Banner controller object
export const heroBannerController = {
  getAllHeroBanners,
  getActiveHeroBanners,
  getHeroBannerById,
  getBannersByStore,
  createHeroBanner,
  updateHeroBanner,
  deleteHeroBanner,
  hardDeleteHeroBanner,
};

