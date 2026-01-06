// Store controller
import { Response } from 'express';
import { Store } from '../models/store.model';
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

// Get all stores
export const getAllStores = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    const [stores, total] = await Promise.all([
      Store.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Store.countDocuments(filter),
    ]);

    responseUtils.paginatedResponse(
      res,
      'Stores retrieved successfully',
      stores,
      page,
      limit,
      total
    );
  } catch (error) {
    getLogger().error('Get all stores error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve stores');
  }
};

// Get store by ID
export const getStoreById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid store ID');
      return;
    }

    const store = await Store.findById(id);

    if (!store) {
      responseUtils.notFoundResponse(res, 'Store not found');
      return;
    }

    responseUtils.successResponse(res, 'Store retrieved successfully', { store });
  } catch (error) {
    getLogger().error('Get store by ID error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve store');
  }
};

// Create store
export const createStore = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, location, serviceRadiusKm, isActive } = req.body;

    if (!name) {
      responseUtils.badRequestResponse(res, 'Store name is required');
      return;
    }

    if (!location || !location.coordinates || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) {
      responseUtils.badRequestResponse(res, 'Valid location coordinates [lng, lat] are required');
      return;
    }

    const [lng, lat] = location.coordinates;
    if (typeof lng !== 'number' || typeof lat !== 'number') {
      responseUtils.badRequestResponse(res, 'Location coordinates must be numbers');
      return;
    }

    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      responseUtils.badRequestResponse(res, 'Invalid coordinates: lng must be -180 to 180, lat must be -90 to 90');
      return;
    }

    const storeData: any = {
      name,
      location: {
        type: 'Point',
        coordinates: [lng, lat],
      },
      serviceRadiusKm: serviceRadiusKm || 5,
      isActive: isActive !== undefined ? isActive : true,
    };

    const store = new Store(storeData);
    await store.save();

    responseUtils.createdResponse(res, 'Store created successfully', { store });
  } catch (error: any) {
    getLogger().error('Create store error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      responseUtils.conflictResponse(res, `${field} already exists`);
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to create store');
  }
};

// Update store
export const updateStore = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid store ID');
      return;
    }

    const store = await Store.findById(id);
    if (!store) {
      responseUtils.notFoundResponse(res, 'Store not found');
      return;
    }

    const { name, location, serviceRadiusKm, isActive } = req.body;

    if (name !== undefined) store.name = name;

    if (location !== undefined) {
      if (!location.coordinates || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) {
        responseUtils.badRequestResponse(res, 'Valid location coordinates [lng, lat] are required');
        return;
      }

      const [lng, lat] = location.coordinates;
      if (typeof lng !== 'number' || typeof lat !== 'number') {
        responseUtils.badRequestResponse(res, 'Location coordinates must be numbers');
        return;
      }

      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        responseUtils.badRequestResponse(res, 'Invalid coordinates: lng must be -180 to 180, lat must be -90 to 90');
        return;
      }

      store.location = {
        type: 'Point',
        coordinates: [lng, lat],
      };
    }

    if (serviceRadiusKm !== undefined) {
      if (typeof serviceRadiusKm !== 'number' || serviceRadiusKm < 0) {
        responseUtils.badRequestResponse(res, 'Service radius must be a positive number');
        return;
      }
      store.serviceRadiusKm = serviceRadiusKm;
    }

    if (isActive !== undefined) store.isActive = isActive;

    await store.save();

    responseUtils.successResponse(res, 'Store updated successfully', { store });
  } catch (error: any) {
    getLogger().error('Update store error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      responseUtils.conflictResponse(res, `${field} already exists`);
      return;
    }
    responseUtils.internalServerErrorResponse(res, 'Failed to update store');
  }
};

// Delete store
export const deleteStore = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid store ID');
      return;
    }

    const store = await Store.findById(id);
    if (!store) {
      responseUtils.notFoundResponse(res, 'Store not found');
      return;
    }

    // Soft delete - set isActive to false
    store.isActive = false;
    await store.save();

    responseUtils.successResponse(res, 'Store deleted successfully');
  } catch (error) {
    getLogger().error('Delete store error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete store');
  }
};

// Find stores near a location (public route - no auth required)
export const findStoresNearby = async (req: any, res: Response): Promise<void> => {
  try {
    const lng = parseFloat(req.query.lng as string);
    const lat = parseFloat(req.query.lat as string);
    const maxDistance = parseFloat(req.query.maxDistance as string) || 10; // km

    if (isNaN(lng) || isNaN(lat)) {
      responseUtils.badRequestResponse(res, 'Valid lng and lat query parameters are required');
      return;
    }

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

    responseUtils.successResponse(res, 'Nearby stores retrieved successfully', { stores });
  } catch (error) {
    getLogger().error('Find stores nearby error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to find nearby stores');
  }
};

// Store controller object
export const storeController = {
  getAllStores,
  getStoreById,
  createStore,
  updateStore,
  deleteStore,
  findStoresNearby,
};

