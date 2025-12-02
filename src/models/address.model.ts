// Address model
import mongoose, { Document, Schema } from 'mongoose';

export interface IAddress extends Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  type: 'home' | 'work' | 'other';
  label?: string;

  // Address fields
  street: string;
  apartment?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;

  // Contact information
  contactName: string;
  contactPhone: string;

  // Location coordinates (for delivery optimization)
  coordinates?: {
    latitude: number;
    longitude: number;
  };

  // Status
  isDefault: boolean;
  isActive: boolean;

  // Delivery preferences
  deliveryInstructions?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  setAsDefault(): Promise<void>;
  deactivate(): Promise<void>;
  getDistanceFrom(longitude: number, latitude: number): number | null;
}

// Static methods interface
export interface IAddressModel extends mongoose.Model<IAddress> {
  findUserAddresses(userId: string): Promise<IAddress[]>;
  findDefaultAddress(userId: string): Promise<IAddress | null>;
  findByPincode(pincode: string): Promise<IAddress[]>;
  findNearbyAddresses(longitude: number, latitude: number, maxDistance?: number): Promise<IAddress[]>;
}

// Address schema
const addressSchema = new Schema<IAddress>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['home', 'work', 'other'],
      default: 'home',
    },
    label: {
      type: String,
      trim: true,
      maxlength: 50,
    },

    // Address fields
    street: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    apartment: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    landmark: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    state: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    pincode: {
      type: String,
      required: true,
      trim: true,
      maxlength: 10,
    },
    country: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
      default: 'India',
    },

    // Contact information
    contactName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    contactPhone: {
      type: String,
      required: true,
      trim: true,
    },

    // Location coordinates
    coordinates: {
      latitude: {
        type: Number,
        min: -90,
        max: 90,
      },
      longitude: {
        type: Number,
        min: -180,
        max: 180,
      },
    },

    // Status
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    // Delivery preferences
    deliveryInstructions: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
addressSchema.index({ user: 1 });
addressSchema.index({ user: 1, isDefault: 1 });
addressSchema.index({ user: 1, isActive: 1 });
addressSchema.index({ city: 1, state: 1 });
addressSchema.index({ pincode: 1 });
addressSchema.index({ 'coordinates': '2dsphere' });

// Pre-save middleware to ensure only one default address per user
addressSchema.pre('save', async function (next) {
  const address = this as IAddress;

  if (address.isDefault && address.isModified('isDefault')) {
    // Remove default flag from other addresses of the same user
    await mongoose.model('Address').updateMany(
      { user: address.user, _id: { $ne: address._id } },
      { isDefault: false }
    );
  }

  next();
});

// Virtual for full address
addressSchema.virtual('fullAddress').get(function () {
  const parts = [
    this.apartment && `${this.apartment},`,
    this.street,
    this.landmark && `(${this.landmark})`,
    this.city,
    this.state,
    this.pincode,
    this.country,
  ].filter(Boolean);

  return parts.join(', ');
});

// Static methods
addressSchema.statics.findUserAddresses = function (userId: string) {
  return this.find({ user: userId, isActive: true }).sort({ isDefault: -1, createdAt: -1 });
};

addressSchema.statics.findDefaultAddress = function (userId: string) {
  return this.findOne({ user: userId, isDefault: true, isActive: true });
};

addressSchema.statics.findByPincode = function (pincode: string) {
  return this.find({ pincode, isActive: true });
};

addressSchema.statics.findNearbyAddresses = function (longitude: number, latitude: number, maxDistance: number = 5000) {
  return this.find({
    coordinates: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
        $maxDistance: maxDistance, // in meters
      },
    },
    isActive: true,
  });
};

// Instance methods
addressSchema.methods.setAsDefault = async function (): Promise<void> {
  // Remove default flag from other addresses
  await mongoose.model('Address').updateMany(
    { user: this.user, _id: { $ne: this._id } },
    { isDefault: false }
  );

  this.isDefault = true;
  await this.save();
};

addressSchema.methods.deactivate = async function (): Promise<void> {
  this.isActive = false;
  await this.save();
};

addressSchema.methods.getDistanceFrom = function (longitude: number, latitude: number): number | null {
  if (!this.coordinates) return null;

  // Haversine formula for distance calculation
  const R = 6371; // Earth's radius in kilometers
  const dLat = (latitude - this.coordinates.latitude) * Math.PI / 180;
  const dLon = (longitude - this.coordinates.longitude) * Math.PI / 180;

  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(this.coordinates.latitude * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in kilometers

  return distance;
};

// Export the model
export const Address = mongoose.model<IAddress, IAddressModel>('Address', addressSchema);
export default Address;

