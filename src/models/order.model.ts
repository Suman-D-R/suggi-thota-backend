// Order model
import mongoose, { Document, Schema } from 'mongoose';

export interface IBatchSplit {
  batch: mongoose.Types.ObjectId;
  quantity: number;
  sellingPrice: number;
  costPrice: number;
}

export interface IOrderItem {
  product: mongoose.Types.ObjectId;
  quantity: number;
  price: number; // Price at the time of order
  total: number;
  size?: number; // Variant size
  unit?: string; // Variant unit
  variantSku?: string; // Variant SKU
  batchSplits?: IBatchSplit[]; // Batch allocation details for this item
}

export interface IOrder extends Document {
  _id: mongoose.Types.ObjectId;
  orderNumber: string;
  user: mongoose.Types.ObjectId;
  storeId: mongoose.Types.ObjectId;
  items: IOrderItem[];
  deliveryAddress: mongoose.Types.ObjectId;

  // Pricing
  subtotal: number;
  deliveryFee: number;
  tax: number;
  discount: number;
  total: number;

  // Status
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'refunded';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';

  // Payment
  paymentMethod: 'cod' | 'online' | 'wallet';
  paymentId?: string;
  transactionId?: string;

  // Delivery
  deliveryPartner?: mongoose.Types.ObjectId;
  estimatedDeliveryTime?: Date;
  actualDeliveryTime?: Date;

  // Special instructions
  deliveryInstructions?: string;
  orderNotes?: string;

  // Cancellation
  cancelledAt?: Date;
  cancelReason?: string;
  refundedAt?: Date;
  refundAmount?: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Methods
  calculateTotal(): number;
  canBeCancelled(): boolean;
  canBeModified(): boolean;
}

// Static methods interface
export interface IOrderModel extends mongoose.Model<IOrder> {
  findUserOrders(userId: string, page?: number, limit?: number): Promise<IOrder[]>;
  findByOrderNumber(orderNumber: string): Promise<IOrder | null>;
  findByStatus(status: string, page?: number, limit?: number): Promise<IOrder[]>;
  getOrderStats(startDate?: Date, endDate?: Date): Promise<any[]>;
}

// Batch split sub-schema
const batchSplitSchema = new Schema<IBatchSplit>(
  {
    batch: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryBatch',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    costPrice: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

// Order item sub-schema
const orderItemSchema = new Schema<IOrderItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    size: {
      type: Number,
      min: 0,
    },
    unit: {
      type: String,
      enum: ['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'],
    },
    batchSplits: [batchSplitSchema],
  },
  { _id: false }
);

// Order schema
const orderSchema = new Schema<IOrder>(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
    },
    items: [orderItemSchema],
    deliveryAddress: {
      type: Schema.Types.ObjectId,
      ref: 'Address',
      required: true,
    },

    // Pricing
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },

    // Status
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'],
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },

    // Payment
    paymentMethod: {
      type: String,
      enum: ['cod', 'online', 'wallet'],
      required: true,
    },
    paymentId: {
      type: String,
    },
    transactionId: {
      type: String,
    },

    // Delivery
    deliveryPartner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    estimatedDeliveryTime: {
      type: Date,
    },
    actualDeliveryTime: {
      type: Date,
    },

    // Special instructions
    deliveryInstructions: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    orderNotes: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // Cancellation
    cancelledAt: {
      type: Date,
    },
    cancelReason: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    refundedAt: {
      type: Date,
    },
    refundAmount: {
      type: Number,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ deliveryPartner: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'items.product': 1 });

// Pre-save middleware
orderSchema.pre('save', function (next) {
  const order = this as IOrder;

  // Generate order number if not provided
  if (!order.orderNumber) {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    order.orderNumber = `ORD-${timestamp}-${random}`;
  }

  // Calculate total if not provided
  if (!order.total) {
    order.total = order.calculateTotal();
  }

  // Set estimated delivery time for new orders
  if (order.isNew && !order.estimatedDeliveryTime) {
    const deliveryTime = new Date();
    deliveryTime.setHours(deliveryTime.getHours() + 2); // 2 hours from now
    order.estimatedDeliveryTime = deliveryTime;
  }

  next();
});

// Instance methods
orderSchema.methods.calculateTotal = function (): number {
  const itemTotal = this.items.reduce((sum: number, item: IOrderItem) => sum + item.total, 0);
  return itemTotal + this.deliveryFee + this.tax - this.discount;
};

orderSchema.methods.canBeCancelled = function (): boolean {
  const cancellableStatuses = ['pending', 'confirmed'];
  return cancellableStatuses.includes(this.status);
};

orderSchema.methods.canBeModified = function (): boolean {
  const modifiableStatuses = ['pending'];
  return modifiableStatuses.includes(this.status);
};

// Virtual for order age in hours
orderSchema.virtual('orderAgeHours').get(function () {
  const now = new Date();
  const created = this.createdAt;
  const diffMs = now.getTime() - created.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60));
});

// Virtual for delivery time
orderSchema.virtual('deliveryTime').get(function () {
  return this.actualDeliveryTime || this.estimatedDeliveryTime;
});

// Static methods
orderSchema.statics.findUserOrders = function (userId: string, page: number = 1, limit: number = 10) {
  return this.find({ user: userId })
    .populate('items.product')
    .populate('deliveryAddress')
    .populate('deliveryPartner', 'name phone')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
};

orderSchema.statics.findByOrderNumber = function (orderNumber: string) {
  return this.findOne({ orderNumber: orderNumber.toUpperCase() })
    .populate('items.product')
    .populate('deliveryAddress')
    .populate('deliveryPartner', 'name phone');
};

orderSchema.statics.findByStatus = function (status: string, page: number = 1, limit: number = 10) {
  return this.find({ status })
    .populate('user', 'name phone')
    .populate('items.product')
    .populate('deliveryAddress')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
};

orderSchema.statics.getOrderStats = function (startDate?: Date, endDate?: Date) {
  const matchStage: any = {};
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
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$total' },
        pendingOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
        },
        deliveredOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
        },
        cancelledOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
        },
      }
    }
  ]);
};

// Export the model
export const Order = mongoose.model<IOrder, IOrderModel>('Order', orderSchema);
export default Order;

