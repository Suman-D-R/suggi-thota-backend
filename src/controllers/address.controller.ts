// Address controller
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Address, IAddress } from '../models/address.model';
import { responseUtils } from '../utils/response';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};

// Helper function to format address string
function formatAddress(addr: IAddress): string {
  const parts = [
    addr.apartment && `${addr.apartment},`,
    addr.street,
    addr.landmark && `(${addr.landmark})`,
    addr.city,
    addr.state,
    addr.pincode,
    addr.country,
  ].filter(Boolean);
  return parts.join(', ');
}

// Get user's addresses
export const getAddresses = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    const addresses = await Address.findUserAddresses(userId);

    responseUtils.successResponse(res, 'Addresses retrieved successfully', {
      addresses: addresses.map((addr) => ({
        id: addr._id.toString(),
        type: addr.type,
        label: addr.label || addr.type,
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
        coordinates: addr.coordinates,
        deliveryInstructions: addr.deliveryInstructions,
        // Format full address for display
        address: formatAddress(addr),
        createdAt: addr.createdAt,
        updatedAt: addr.updatedAt,
      })),
    });
  } catch (error) {
    getLogger().error('Get addresses error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve addresses');
  }
};

// Get address by ID
export const getAddressById = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid address ID');
      return;
    }

    const address = await Address.findOne({
      _id: id,
      user: userId,
      isActive: true,
    });

    if (!address) {
      responseUtils.notFoundResponse(res, 'Address not found');
      return;
    }

    responseUtils.successResponse(res, 'Address retrieved successfully', {
      address: {
        id: address._id.toString(),
        type: address.type,
        label: address.label || address.type,
        street: address.street,
        apartment: address.apartment,
        landmark: address.landmark,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        country: address.country,
        isDefault: address.isDefault,
        contactName: address.contactName,
        contactPhone: address.contactPhone,
        coordinates: address.coordinates,
        deliveryInstructions: address.deliveryInstructions,
        address: formatAddress(address),
        createdAt: address.createdAt,
        updatedAt: address.updatedAt,
      },
    });
  } catch (error) {
    getLogger().error('Get address by ID error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to retrieve address');
  }
};

// Create new address
export const createAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const {
      type,
      label,
      street,
      apartment,
      landmark,
      city,
      state,
      pincode,
      country,
      contactName,
      contactPhone,
      coordinates,
      deliveryInstructions,
      isDefault,
    } = req.body;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    // Validate required fields
    if (!street || !city || !state) {
      responseUtils.badRequestResponse(
        res,
        'Street, city, and state are required'
      );
      return;
    }

    if (!contactName || !contactPhone) {
      responseUtils.badRequestResponse(
        res,
        'Contact name and phone are required'
      );
      return;
    }

    // Validate type
    const validTypes = ['home', 'work', 'other'];
    if (type && !validTypes.includes(type)) {
      responseUtils.badRequestResponse(
        res,
        `Invalid address type. Must be one of: ${validTypes.join(', ')}`
      );
      return;
    }

    // If setting as default, unset other default addresses
    if (isDefault) {
      await Address.updateMany(
        { user: userId },
        { isDefault: false }
      );
    }

    // Create new address
    const address = new Address({
      user: userId,
      type: type || 'home',
      label: label || type || 'Home',
      street: street.trim(),
      apartment: apartment?.trim(),
      landmark: landmark?.trim(),
      city: city.trim(),
      state: state.trim(),
      pincode: pincode?.trim() || '',
      country: country?.trim() || 'India',
      contactName: contactName.trim(),
      contactPhone: contactPhone.trim(),
      coordinates: coordinates
        ? {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
          }
        : undefined,
      deliveryInstructions: deliveryInstructions?.trim(),
      isDefault: isDefault || false,
      isActive: true,
    });

    await address.save();

    getLogger().info(`Address created for user ${userId}: ${address._id}`);

    responseUtils.successResponse(
      res,
      'Address created successfully',
      {
        address: {
          id: address._id.toString(),
          type: address.type,
          label: address.label || address.type,
          street: address.street,
          apartment: address.apartment,
          landmark: address.landmark,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          country: address.country,
          isDefault: address.isDefault,
          contactName: address.contactName,
          contactPhone: address.contactPhone,
          coordinates: address.coordinates,
          deliveryInstructions: address.deliveryInstructions,
          address: formatAddress(address),
          createdAt: address.createdAt,
          updatedAt: address.updatedAt,
        },
      },
      201
    );
  } catch (error: any) {
    getLogger().error('Create address error:', error);
    responseUtils.internalServerErrorResponse(
      res,
      error.message || 'Failed to create address'
    );
  }
};

// Update address
export const updateAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;
    const {
      type,
      label,
      street,
      apartment,
      landmark,
      city,
      state,
      pincode,
      country,
      contactName,
      contactPhone,
      coordinates,
      deliveryInstructions,
      isDefault,
    } = req.body;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid address ID');
      return;
    }

    const address = await Address.findOne({
      _id: id,
      user: userId,
      isActive: true,
    });

    if (!address) {
      responseUtils.notFoundResponse(res, 'Address not found');
      return;
    }

    // Validate type if provided
    if (type) {
      const validTypes = ['home', 'work', 'other'];
      if (!validTypes.includes(type)) {
        responseUtils.badRequestResponse(
          res,
          `Invalid address type. Must be one of: ${validTypes.join(', ')}`
        );
        return;
      }
      address.type = type;
    }

    // Update fields
    if (label !== undefined) address.label = label?.trim() || address.type;
    if (street !== undefined) address.street = street.trim();
    if (apartment !== undefined) address.apartment = apartment?.trim();
    if (landmark !== undefined) address.landmark = landmark?.trim();
    if (city !== undefined) address.city = city.trim();
    if (state !== undefined) address.state = state.trim();
    if (pincode !== undefined) address.pincode = pincode.trim();
    if (country !== undefined) address.country = country.trim();
    if (contactName !== undefined) address.contactName = contactName.trim();
    if (contactPhone !== undefined) address.contactPhone = contactPhone.trim();
    if (coordinates !== undefined) {
      address.coordinates = coordinates
        ? {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
          }
        : undefined;
    }
    if (deliveryInstructions !== undefined) {
      address.deliveryInstructions = deliveryInstructions?.trim();
    }

    // Handle default address
    if (isDefault === true && !address.isDefault) {
      // Unset other default addresses
      await Address.updateMany(
        { user: userId, _id: { $ne: address._id } },
        { isDefault: false }
      );
      address.isDefault = true;
    } else if (isDefault === false) {
      address.isDefault = false;
    }

    await address.save();

    getLogger().info(`Address updated for user ${userId}: ${address._id}`);

    responseUtils.successResponse(res, 'Address updated successfully', {
      address: {
        id: address._id.toString(),
        type: address.type,
        label: address.label || address.type,
        street: address.street,
        apartment: address.apartment,
        landmark: address.landmark,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        country: address.country,
        isDefault: address.isDefault,
        contactName: address.contactName,
        contactPhone: address.contactPhone,
        coordinates: address.coordinates,
        deliveryInstructions: address.deliveryInstructions,
        address: formatAddress(address),
        createdAt: address.createdAt,
        updatedAt: address.updatedAt,
      },
    });
  } catch (error: any) {
    getLogger().error('Update address error:', error);
    responseUtils.internalServerErrorResponse(
      res,
      error.message || 'Failed to update address'
    );
  }
};

// Delete address (soft delete)
export const deleteAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid address ID');
      return;
    }

    const address = await Address.findOne({
      _id: id,
      user: userId,
      isActive: true,
    });

    if (!address) {
      responseUtils.notFoundResponse(res, 'Address not found');
      return;
    }

    // Soft delete
    address.isActive = false;
    await address.save();

    // If this was the default address, set another as default
    if (address.isDefault) {
      const anotherAddress = await Address.findOne({
        user: userId,
        isActive: true,
        _id: { $ne: address._id },
      }).sort({ createdAt: -1 });

      if (anotherAddress) {
        anotherAddress.isDefault = true;
        await anotherAddress.save();
      }
    }

    getLogger().info(`Address deleted for user ${userId}: ${address._id}`);

    responseUtils.successResponse(res, 'Address deleted successfully');
  } catch (error) {
    getLogger().error('Delete address error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to delete address');
  }
};

// Set address as default
export const setDefaultAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    if (!userId) {
      responseUtils.unauthorizedResponse(res, 'User not authenticated');
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      responseUtils.badRequestResponse(res, 'Invalid address ID');
      return;
    }

    const address = await Address.findOne({
      _id: id,
      user: userId,
      isActive: true,
    });

    if (!address) {
      responseUtils.notFoundResponse(res, 'Address not found');
      return;
    }

    // Use the model method to set as default
    await address.setAsDefault();

    getLogger().info(`Address set as default for user ${userId}: ${address._id}`);

    responseUtils.successResponse(res, 'Address set as default successfully', {
      address: {
        id: address._id.toString(),
        type: address.type,
        label: address.label || address.type,
        street: address.street,
        apartment: address.apartment,
        landmark: address.landmark,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        country: address.country,
        isDefault: address.isDefault,
        contactName: address.contactName,
        contactPhone: address.contactPhone,
        coordinates: address.coordinates,
        deliveryInstructions: address.deliveryInstructions,
        address: formatAddress(address),
        createdAt: address.createdAt,
        updatedAt: address.updatedAt,
      },
    });
  } catch (error) {
    getLogger().error('Set default address error:', error);
    responseUtils.internalServerErrorResponse(res, 'Failed to set default address');
  }
};

// Address controller object
export const addressController = {
  getAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};
