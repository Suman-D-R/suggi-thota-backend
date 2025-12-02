// Delivery model
import mongoose, { Document, Schema } from 'mongoose';

export interface IDeliveryLocation {
  latitude: number;
  longitude: number;
  timestamp: Date;
  address?: string;
}

export interface IDelivery extends Document {
  _id: mongoose.Types.ObjectId;
  order: mongoose.Types.ObjectId;
  deliveryPartner: mongoose.Types.ObjectId;

  // Status
  status: 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'failed' | 'returned';
  deliveryNotes?: string;

  // Timing
  assignedAt: Date;
  pickedUpAt?: Date;
  deliveredAt?: Date;
  estimatedDeliveryTime: Date;

  // Location tracking
  currentLocation?: IDeliveryLocation;
  deliveryPath: IDeliveryLocation[];

  // Customer feedback
  customerRating?: number;
  customerFeedback?: string;

  // Issues and resolution
  issues?: string[];
  resolution?: string;

  // Photos (proof of delivery)
  pickupPhoto?: string;
  deliveryPhoto?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Methods
  updateLocation(latitude: number, longitude: number, address?: string): Promise<void>;
  markAsPickedUp(): Promise<void>;
  markAsDelivered(rating?: number, feedback?: string): Promise<void>;
  addIssue(issue: string): Promise<void>;
}

// Delivery location sub-schema
const deliveryLocationSchema = new Schema<IDeliveryLocation>(
  {
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    address: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

// Delivery schema
const deliverySchema = new Schema<IDelivery>(
  {
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
    },
    deliveryPartner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Status
    status: {
      type: String,
      enum: ['assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned'],
      default: 'assigned',
    },
    deliveryNotes: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // Timing
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    pickedUpAt: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
    estimatedDeliveryTime: {
      type: Date,
      required: true,
    },

    // Location tracking
    currentLocation: deliveryLocationSchema,
    deliveryPath: [deliveryLocationSchema],

    // Customer feedback
    customerRating: {
      type: Number,
      min: 1,
      max: 5,
    },
    customerFeedback: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // Issues and resolution
    issues: [{
      type: String,
      trim: true,
    }],
    resolution: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // Photos
    pickupPhoto: {
      type: String,
    },
    deliveryPhoto: {
      type: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
deliverySchema.index({ order: 1 }, { unique: true });
deliverySchema.index({ deliveryPartner: 1 });
deliverySchema.index({ status: 1 });
deliverySchema.index({ estimatedDeliveryTime: 1 });
deliverySchema.index({ deliveredAt: 1 });
deliverySchema.index({ 'currentLocation': '2dsphere' });

// Virtual for delivery duration
deliverySchema.virtual('deliveryDuration').get(function () {
  if (!this.pickedUpAt || !this.deliveredAt) return null;

  const durationMs = this.deliveredAt.getTime() - this.pickedUpAt.getTime();
  return Math.floor(durationMs / (1000 * 60)); // Duration in minutes
});

// Virtual for isDelayed
deliverySchema.virtual('isDelayed').get(function () {
  if (this.status === 'delivered') return false;

  const now = new Date();
  return now > this.estimatedDeliveryTime;
});

// Instance methods
deliverySchema.methods.updateLocation = async function (
  latitude: number,
  longitude: number,
  address?: string
): Promise<void> {
  const locationUpdate: IDeliveryLocation = {
    latitude,
    longitude,
    timestamp: new Date(),
    address,
  };

  this.currentLocation = locationUpdate;
  this.deliveryPath.push(locationUpdate);

  await this.save();
};

deliverySchema.methods.markAsPickedUp = async function (): Promise<void> {
  this.status = 'picked_up';
  this.pickedUpAt = new Date();
  await this.save();
};

deliverySchema.methods.markAsDelivered = async function (
  rating?: number,
  feedback?: string
): Promise<void> {
  this.status = 'delivered';
  this.deliveredAt = new Date();

  if (rating) this.customerRating = rating;
  if (feedback) this.customerFeedback = feedback;

  await this.save();
};

deliverySchema.methods.addIssue = async function (issue: string): Promise<void> {
  if (!this.issues) this.issues = [];
  this.issues.push(issue);
  await this.save();
};

// Static methods
deliverySchema.statics.findActiveDeliveries = function (deliveryPartnerId?: string) {
  const query: any = {
    status: { $in: ['assigned', 'picked_up', 'in_transit'] },
  };

  if (deliveryPartnerId) {
    query.deliveryPartner = deliveryPartnerId;
  }

  return this.find(query)
    .populate('order')
    .populate('deliveryPartner', 'name phone')
    .sort({ estimatedDeliveryTime: 1 });
};

deliverySchema.statics.findCompletedDeliveries = function (
  deliveryPartnerId?: string,
  page: number = 1,
  limit: number = 10
) {
  const query: any = {
    status: { $in: ['delivered', 'failed', 'returned'] },
  };

  if (deliveryPartnerId) {
    query.deliveryPartner = deliveryPartnerId;
  }

  return this.find(query)
    .populate('order')
    .sort({ deliveredAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
};

deliverySchema.statics.getDeliveryStats = function (deliveryPartnerId?: string, startDate?: Date, endDate?: Date) {
  const matchStage: any = {};
  if (deliveryPartnerId) matchStage.deliveryPartner = new mongoose.Types.ObjectId(deliveryPartnerId);
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = startDate;
    if (endDate) matchStage.createdAt.$lte = endDate;
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalDeliveries: { $sum: 1 },
        completedDeliveries: {
          $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
        },
        failedDeliveries: {
          $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
        },
        averageRating: { $avg: '$customerRating' },
        onTimeDeliveries: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'delivered'] },
                  { $lte: ['$deliveredAt', '$estimatedDeliveryTime'] }
                ]
              },
              1,
              0
            ]
          }
        },
      }
    }
  ]);
};

// Export the model
export const Delivery = mongoose.model<IDelivery>('Delivery', deliverySchema);
export default Delivery;

