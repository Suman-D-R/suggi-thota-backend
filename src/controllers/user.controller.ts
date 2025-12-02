// User management controller
import { Response } from 'express';
import { User } from '../models/user.model';
import { Address } from '../models/address.model';
import { Order } from '../models/order.model';
import { responseUtils } from '../utils/response';
import { AUTH_METHODS } from '../constants/authTypes';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

// Get user profile
export const getProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      responseUtils.notFoundResponse(res, 'User not found');
      return;
    }

    responseUtils.successResponse(res, 'Profile retrieved successfully', {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        authMethod: user.authMethod,
        profileImage: user.profileImage,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (error) {
    getLogger().error('Get profile error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to get profile');
  }
};

// Update user profile
export const updateProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, email, phone, dateOfBirth, gender, profileImage } = req.body;

    // Get current user to check authMethod
    const currentUser = await User.findById(req.user.userId);

    if (!currentUser) {
      responseUtils.notFoundResponse(res, 'User not found');
      return;
    }

    const updateData: any = {};

    // Always allow updating these fields
    if (name !== undefined) updateData.name = name.trim();
    if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    if (gender !== undefined) updateData.gender = gender;
    if (profileImage !== undefined) updateData.profileImage = profileImage;

    // Restrict email/phone based on authMethod
    if (email !== undefined) {
      // If Google login, don't allow email change
      if (currentUser.authMethod === AUTH_METHODS.GOOGLE) {
        responseUtils.badRequestResponse(
          res,
          'Email cannot be changed for Google login accounts'
        );
        return;
      }
      // Allow email update for other auth methods
      if (email) {
        updateData.email = email.toLowerCase().trim();
      } else {
        updateData.email = null;
      }
    }

    if (phone !== undefined) {
      // If OTP login, don't allow phone change
      if (currentUser.authMethod === AUTH_METHODS.OTP) {
        responseUtils.badRequestResponse(
          res,
          'Phone number cannot be changed for phone number login accounts'
        );
        return;
      }
      // Allow phone update for other auth methods
      if (phone) {
        updateData.phone = phone.trim();
      } else {
        updateData.phone = null;
      }
    }

    // Check for duplicate email if updating email
    if (updateData.email && updateData.email !== currentUser.email) {
      const existingUser = await User.findByEmail(updateData.email);
      if (existingUser && existingUser._id.toString() !== req.user.userId) {
        responseUtils.conflictResponse(res, 'Email already exists');
        return;
      }
    }

    // Check for duplicate phone if updating phone
    if (updateData.phone && updateData.phone !== currentUser.phone) {
      const existingUser = await User.findByPhone(updateData.phone);
      if (existingUser && existingUser._id.toString() !== req.user.userId) {
        responseUtils.conflictResponse(res, 'Phone number already exists');
        return;
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!user) {
      responseUtils.notFoundResponse(res, 'User not found');
      return;
    }

    getLogger().info(`User profile updated: ${req.user.userId}`);

    responseUtils.successResponse(res, 'Profile updated successfully', {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        authMethod: user.authMethod,
        profileImage: user.profileImage,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    getLogger().error('Update profile error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to update profile');
  }
};

// Change password
export const changePassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.userId);

    if (!user) {
      responseUtils.notFoundResponse(res, 'User not found');
      return;
    }

    if (!user.password) {
      responseUtils.badRequestResponse(res, 'Password not set for this account');
      return;
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);

    if (!isCurrentPasswordValid) {
      responseUtils.badRequestResponse(res, 'Current password is incorrect');
      return;
    }

    // Update password
    user.password = newPassword;
    await user.save();

    responseUtils.successResponse(res, 'Password changed successfully');
  } catch (error) {
    getLogger().error('Change password error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to change password');
  }
};

// Get user addresses
export const getAddresses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const addresses = await Address.findUserAddresses(req.user.userId);

    responseUtils.successResponse(res, 'Addresses retrieved successfully', {
      addresses: addresses.map(addr => ({
        id: addr._id,
        type: addr.type,
        label: addr.label,
        street: addr.street,
        apartment: addr.apartment,
        landmark: addr.landmark,
        city: addr.city,
        state: addr.state,
        pincode: addr.pincode,
        country: addr.country,
        isDefault: addr.isDefault,
        contactName: addr.contactName,
        contactPhone: addr.contactPhone,
      })),
    });
  } catch (error) {
    getLogger().error('Get addresses error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to get addresses');
  }
};

// Get user orders
export const getOrders = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const orders = await Order.findUserOrders(req.user.userId, page, limit);
    const totalOrders = await Order.countDocuments({ user: req.user.userId });

    responseUtils.paginatedResponse(
      res,
      'Orders retrieved successfully',
      orders.map(order => ({
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        total: order.total,
        createdAt: order.createdAt,
        estimatedDeliveryTime: order.estimatedDeliveryTime,
        items: order.items.map(item => ({
          productId: item.product,
          name: (item.product as any)?.name,
          quantity: item.quantity,
          price: item.price,
          total: item.total,
        })),
      })),
      page,
      limit,
      totalOrders
    );
  } catch (error) {
    getLogger().error('Get orders error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to get orders');
  }
};

// Get user statistics
export const getUserStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user.userId;

    // Get order statistics
    const orderStats = await Order.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$total' },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
          },
        }
      }
    ]);

    const stats = orderStats[0] || {
      totalOrders: 0,
      totalSpent: 0,
      pendingOrders: 0,
      completedOrders: 0,
    };

    // Get address count
    const addressCount = await Address.countDocuments({
      user: userId,
      isActive: true,
    });

    responseUtils.successResponse(res, 'User statistics retrieved successfully', {
      stats: {
        totalOrders: stats.totalOrders,
        totalSpent: stats.totalSpent,
        pendingOrders: stats.pendingOrders,
        completedOrders: stats.completedOrders,
        savedAddresses: addressCount,
      },
    });
  } catch (error) {
    getLogger().error('Get user stats error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to get user statistics');
  }
};

// Delete user account (soft delete)
export const deleteAccount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      responseUtils.notFoundResponse(res, 'User not found');
      return;
    }

    // Check if user has pending orders
    const pendingOrders = await Order.countDocuments({
      user: req.user.userId,
      status: { $in: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'] },
    });

    if (pendingOrders > 0) {
      responseUtils.badRequestResponse(
        res,
        'Cannot delete account with pending orders. Please complete or cancel all orders first.'
      );
      return;
    }

    // Soft delete - deactivate account
    user.isActive = false;
    await user.save();

    responseUtils.successResponse(res, 'Account deleted successfully');
  } catch (error) {
    getLogger().error('Delete account error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete account');
  }
};

// Admin: Get all users (paginated)
export const getAllUsers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;

    const query: any = { isActive: true };

    if (search) {
      query.$or = [
        { name: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
        { phone: new RegExp(search, 'i') },
      ];
    }

    const users = await User.find(query)
      .select('-password -otp -otpExpiresAt -otpAttempts')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const totalUsers = await User.countDocuments(query);

    responseUtils.paginatedResponse(
      res,
      'Users retrieved successfully',
      users.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      })),
      page,
      limit,
      totalUsers
    );
  } catch (error) {
    getLogger().error('Get all users error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to get users');
  }
};

// Admin: Update user role
export const updateUserRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true, runValidators: true }
    );

    if (!user) {
      responseUtils.notFoundResponse(res, 'User not found');
      return;
    }

    responseUtils.successResponse(res, 'User role updated successfully', {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    getLogger().error('Update user role error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to update user role');
  }
};

// User controller object
export const userController = {
  getProfile,
  updateProfile,
  changePassword,
  getAddresses,
  getOrders,
  getUserStats,
  deleteAccount,
  getAllUsers,
  updateUserRole,
};

