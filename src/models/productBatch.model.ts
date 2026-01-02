// ProductBatch model
import mongoose, { Document, Schema } from 'mongoose';

export interface ISellingVariant {
  sellingSize: number;
  sellingUnit: 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen';
  originalPrice: number; // Price per unit of sellingSize/sellingUnit
  sellingPrice: number; // Price per unit of sellingSize/sellingUnit
  discount?: number;
  quantityAvailable: number; // Quantity available for this selling variant
}

export interface IProductBatch extends Document {
  _id: mongoose.Types.ObjectId;
  product: mongoose.Types.ObjectId;
  batchCode?: string;
  // Purchased section (what was bought from supplier)
  purchasedSize: number;
  purchasedUnit: 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen';
  totalCost: number;
  quantityPurchased: number; // Quantity in purchasedSize/purchasedUnit
  // Selling variants array (multiple variants with different prices)
  sellingVariants: ISellingVariant[];
  expiryDate?: Date;
  supplier?: string;
  createdAt: Date;
}

// ProductBatch schema
const productBatchSchema = new Schema<IProductBatch>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    batchCode: {
      type: String,
      trim: true,
    },
    purchasedSize: {
      type: Number,
      required: true,
      min: 0,
    },
    purchasedUnit: {
      type: String,
      enum: ['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'],
      required: true,
    },
    totalCost: {
      type: Number,
      required: true,
      min: 0,
    },
    quantityPurchased: {
      type: Number,
      required: true,
      min: 0,
    },
    sellingVariants: {
      type: [
        {
          sellingSize: {
            type: Number,
            required: true,
            min: 0,
          },
          sellingUnit: {
            type: String,
            enum: ['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'],
            required: true,
          },
          originalPrice: {
            type: Number,
            required: true,
            min: 0,
          },
          sellingPrice: {
            type: Number,
            required: true,
            min: 0,
          },
          discount: {
            type: Number,
            min: 0,
          },
          quantityAvailable: {
            type: Number,
            required: true,
            min: 0,
          },
        },
      ],
      required: true,
      validate: {
        validator: function(value: ISellingVariant[]) {
          return Array.isArray(value) && value.length > 0;
        },
        message: 'At least one selling variant is required',
      },
    },
    expiryDate: {
      type: Date,
    },
    supplier: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
productBatchSchema.index({ product: 1 });
productBatchSchema.index({ batchCode: 1 });
productBatchSchema.index({ createdAt: -1 });
productBatchSchema.index({ expiryDate: 1 });
productBatchSchema.index({ 'sellingVariants.sellingSize': 1, 'sellingVariants.sellingUnit': 1 }); // Index for variant-based queries

// Export the model
export const ProductBatch = mongoose.model<IProductBatch>('ProductBatch', productBatchSchema);
export default ProductBatch;

