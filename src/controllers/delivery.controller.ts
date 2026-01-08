// Delivery controller
import { Request, Response } from 'express';
import { User } from '../models/user.model';
import { Store } from '../models/store.model';
import { Delivery } from '../models/delivery.model';
import { responseUtils } from '../utils/response';
import { logger } from '../utils/logger';
import { USER_ROLES } from '../constants/roles';
import { AUTH_METHODS } from '../constants/authTypes';
import mongoose from 'mongoose';

/**
 * Create a delivery agent account (Admin only)
 * Agent ID will be the phone number
 */
export const createDeliveryAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, phone, email, password, storeId } = req.body;

    // Validate required fields
    if (!name || !phone || !password || !storeId) {
      responseUtils.badRequestResponse(res, 'Name, phone, password, and store are required');
      return;
    }

    // Validate phone format (should be in international format)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone)) {
      responseUtils.badRequestResponse(res, 'Invalid phone number format. Please use international format (e.g., +919876543210)');
      return;
    }

    // Validate email if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        responseUtils.badRequestResponse(res, 'Invalid email format');
        return;
      }
    }

    // Validate password length
    if (password.length < 6) {
      responseUtils.badRequestResponse(res, 'Password must be at least 6 characters long');
      return;
    }

    // Check if store exists and is active
    const store = await Store.findById(storeId);
    if (!store) {
      responseUtils.notFoundResponse(res, 'Store not found');
      return;
    }

    if (!store.isActive) {
      responseUtils.badRequestResponse(res, 'Cannot assign agent to inactive store');
      return;
    }

    // Check if user with this phone already exists
    const existingUser = await User.findOne({
      $or: [
        { phone },
        ...(email ? [{ email: email.toLowerCase() }] : []),
      ],
    });

    if (existingUser) {
      responseUtils.conflictResponse(res, 'A user with this phone or email already exists');
      return;
    }

    // Create delivery agent
    const deliveryAgent = new User({
      name: name.trim(),
      phone,
      email: email?.toLowerCase(),
      password,
      role: USER_ROLES.DELIVERY_PARTNER,
      authMethod: AUTH_METHODS.PASSWORD,
      isVerified: true,
      isActive: true,
    });

    await deliveryAgent.save();

    logger.info(`Delivery agent created: ${deliveryAgent._id}, phone: ${phone}, store: ${store.name}`);

    responseUtils.createdResponse(res, 'Delivery agent created successfully', {
      agent: {
        id: deliveryAgent._id,
        name: deliveryAgent.name,
        phone: deliveryAgent.phone,
        email: deliveryAgent.email,
        role: deliveryAgent.role,
        agentId: deliveryAgent.phone, // Agent ID is phone number
        store: {
          id: store._id,
          name: store.name,
        },
      },
    });
  } catch (error) {
    logger.error('Create delivery agent error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to create delivery agent');
  }
};

/**
 * Get all delivery agents (Admin only)
 */
export const getAllDeliveryAgents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 10, search, isActive } = req.query;

    const query: any = { role: USER_ROLES.DELIVERY_PARTNER };

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Search by name, phone, or email
    if (search && typeof search === 'string') {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const agents = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    const total = await User.countDocuments(query);

    responseUtils.successResponse(res, 'Delivery agents retrieved successfully', {
      agents,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  } catch (error) {
    logger.error('Get delivery agents error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve delivery agents');
  }
};

/**
 * Get delivery agent by ID (Admin only)
 */
export const getDeliveryAgentById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid agent ID');
      return;
    }

    const agent = await User.findOne({
      _id: id,
      role: USER_ROLES.DELIVERY_PARTNER,
    }).select('-password');

    if (!agent) {
      responseUtils.notFoundResponse(res, 'Delivery agent not found');
      return;
    }

    // Get agent stats
    const deliveryStats = await Delivery.aggregate([
      { $match: { deliveryPartner: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: null,
          totalDeliveries: { $sum: 1 },
          completedDeliveries: {
            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] },
          },
          averageRating: { $avg: '$customerRating' },
        },
      },
    ]);

    const stats = deliveryStats[0] || {
      totalDeliveries: 0,
      completedDeliveries: 0,
      averageRating: 0,
    };

    responseUtils.successResponse(res, 'Delivery agent retrieved successfully', {
      agent,
      stats,
    });
  } catch (error) {
    logger.error('Get delivery agent error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve delivery agent');
  }
};

/**
 * Update delivery agent (Admin only)
 */
export const updateDeliveryAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, email, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid agent ID');
      return;
    }

    const agent = await User.findOne({
      _id: id,
      role: USER_ROLES.DELIVERY_PARTNER,
    });

    if (!agent) {
      responseUtils.notFoundResponse(res, 'Delivery agent not found');
      return;
    }

    // Update fields
    if (name) agent.name = name.trim();
    if (email !== undefined) {
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          responseUtils.badRequestResponse(res, 'Invalid email format');
          return;
        }
        agent.email = email.toLowerCase();
      } else {
        agent.email = undefined;
      }
    }
    if (isActive !== undefined) agent.isActive = isActive;

    await agent.save();

    logger.info(`Delivery agent updated: ${agent._id}`);

    responseUtils.successResponse(res, 'Delivery agent updated successfully', {
      agent: {
        id: agent._id,
        name: agent.name,
        phone: agent.phone,
        email: agent.email,
        role: agent.role,
        isActive: agent.isActive,
      },
    });
  } catch (error) {
    logger.error('Update delivery agent error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to update delivery agent');
  }
};

/**
 * Delete delivery agent (Admin only - soft delete)
 */
export const deleteDeliveryAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid agent ID');
      return;
    }

    const agent = await User.findOne({
      _id: id,
      role: USER_ROLES.DELIVERY_PARTNER,
    });

    if (!agent) {
      responseUtils.notFoundResponse(res, 'Delivery agent not found');
      return;
    }

    // Check if agent has active deliveries
    const activeDeliveries = await Delivery.countDocuments({
      deliveryPartner: id,
      status: { $in: ['assigned', 'picked_up', 'in_transit'] },
    });

    if (activeDeliveries > 0) {
      responseUtils.badRequestResponse(
        res,
        `Cannot delete agent with ${activeDeliveries} active deliveries. Please reassign or complete them first.`
      );
      return;
    }

    // Soft delete - set isActive to false
    agent.isActive = false;
    await agent.save();

    logger.info(`Delivery agent deleted (soft): ${agent._id}`);

    responseUtils.successResponse(res, 'Delivery agent deleted successfully');
  } catch (error) {
    logger.error('Delete delivery agent error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete delivery agent');
  }
};

export const deliveryController = {
  createDeliveryAgent,
  getAllDeliveryAgents,
  getDeliveryAgentById,
  updateDeliveryAgent,
  deleteDeliveryAgent,
};

