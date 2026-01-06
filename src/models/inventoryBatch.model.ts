// InventoryBatch model
import mongoose, { Schema, Document } from 'mongoose';

export type BatchStatus = 'active' | 'expired' | 'depleted' | 'cancelled';

export interface IInventoryBatch extends Document {
  storeId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  
  // Variant SKU - required for variant-specific stock (e.g., rice packages)
  // Optional for shared stock products (e.g., vegetables sold by weight)
  variantSku?: string;

  // Stock management
  initialQuantity: number; // Original quantity when batch was created
  availableQuantity: number; // Current available quantity (decreases with orders)
  costPrice: number; // Cost price per unit

  // Stock type: variant-specific (false) or shared stock (true)
  // Variant-specific: Each variant has separate batches (e.g., rice 1kg, 5kg bags)
  // Shared stock: One batch serves all variants, stock shared across variants (e.g., vegetables)
  usesSharedStock: boolean;
  
  // For shared stock: base unit for quantity tracking (e.g., 'kg', 'g')
  baseUnit?: 'kg' | 'g' | 'ml' | 'liter' | 'piece' | 'pack';

  // Batch metadata for store owners
  batchNumber?: string; // Batch/GRN number for tracking
  supplier?: string; // Supplier name
  purchaseDate?: Date; // Date of purchase
  expiryDate?: Date; // Expiry date (if applicable)
  notes?: string; // Additional notes/comments

  // Status tracking
  status: BatchStatus; // active, expired, depleted, cancelled

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const inventoryBatchSchema = new Schema<IInventoryBatch>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },

    variantSku: {
      type: String,
      required: function(this: IInventoryBatch) {
        return !this.usesSharedStock;
      },
    },

    initialQuantity: {
      type: Number,
      required: true,
      min: 0,
    },

    availableQuantity: {
      type: Number,
      required: true,
      min: 0,
      default: function(this: IInventoryBatch) {
        return this.initialQuantity;
      },
    },

    costPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    usesSharedStock: {
      type: Boolean,
      default: false,
    },

    baseUnit: {
      type: String,
      enum: ['kg', 'g', 'ml', 'liter', 'piece', 'pack'],
      required: function(this: IInventoryBatch) {
        return this.usesSharedStock === true;
      },
    },

    batchNumber: {
      type: String,
      trim: true,
    },

    supplier: {
      type: String,
      trim: true,
    },

    purchaseDate: {
      type: Date,
      default: Date.now,
    },

    expiryDate: {
      type: Date,
    },

    notes: {
      type: String,
      trim: true,
    },

    status: {
      type: String,
      enum: ['active', 'expired', 'depleted', 'cancelled'],
      default: 'active',
    },
  },
  { timestamps: true }
);

// Indexes for efficient queries
inventoryBatchSchema.index({ storeId: 1, productId: 1 });
inventoryBatchSchema.index({ storeId: 1, productId: 1, variantSku: 1 });
inventoryBatchSchema.index({ storeId: 1, productId: 1, status: 1 });
inventoryBatchSchema.index({ status: 1, expiryDate: 1 }); // For finding expired batches
inventoryBatchSchema.index({ batchNumber: 1 }); // For batch number lookup

// Virtual to check if batch is expired
inventoryBatchSchema.virtual('isExpired').get(function(this: IInventoryBatch) {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

// Virtual to check if batch is available (not depleted/expired/cancelled)
inventoryBatchSchema.virtual('isAvailable').get(function(this: IInventoryBatch) {
  const isExpired = this.expiryDate && new Date() > this.expiryDate;
  return this.status === 'active' && this.availableQuantity > 0 && !isExpired;
});

// Pre-save hook to update status based on quantity and expiry
inventoryBatchSchema.pre('save', function(next) {
  // Update status to depleted if available quantity is 0
  if (this.availableQuantity <= 0 && this.status === 'active') {
    this.status = 'depleted';
  }

  // Update status to expired if expiry date has passed
  const isExpired = this.expiryDate && new Date() > this.expiryDate;
  if (isExpired && this.status === 'active') {
    this.status = 'expired';
  }

  next();
});

// Method to check if batch has sufficient quantity
inventoryBatchSchema.methods.hasSufficientQuantity = function(requiredQuantity: number): boolean {
  return this.status === 'active' && this.availableQuantity >= requiredQuantity && !this.isExpired;
};

export const InventoryBatch = mongoose.model<IInventoryBatch>(
  'InventoryBatch',
  inventoryBatchSchema
);
export default InventoryBatch;

