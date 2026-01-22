// StoreProduct model
import mongoose, { Schema, Document } from 'mongoose';

export interface IStoreProductVariant {
  sku: string; // unique per variant (ex: RICE-1KG)
  size: number;
  unit: 'kg' | 'g' | 'ml' | 'liter' | 'piece' | 'pack';
  mrp: number;
  sellingPrice: number;
  discount: number;
  isAvailable: boolean;
  maximumOrderLimit?: number;
}

export interface IStoreProduct extends Document {
  storeId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  variants: IStoreProductVariant[];
  isActive: boolean;
  isFeatured?: boolean;
}

const storeProductSchema = new Schema<IStoreProduct>(
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
    variants: [
      {
        sku: { type: String, required: true },
        size: { type: Number, required: true },
        unit: {
          type: String,
          enum: ['kg', 'g', 'ml', 'liter', 'piece', 'pack'],
          required: true,
        },
        mrp: { type: Number, required: true },
        sellingPrice: { type: Number, required: true },
        discount: { 
          type: Number, 
          default: 0,
          set: (value: number) => Math.round((value || 0) * 100) / 100, // Round to 2 decimal places
        },
        isAvailable: { type: Boolean, default: true },
        maximumOrderLimit: { type: Number, default: undefined },
      },
    ],
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Pre-save hook to ensure discount is always rounded to 2 decimal places
storeProductSchema.pre('save', function(next) {
  if (this.variants && Array.isArray(this.variants)) {
    this.variants = this.variants.map((variant: any) => {
      if (variant.discount !== undefined && variant.discount !== null) {
        variant.discount = Math.round(parseFloat(variant.discount) * 100) / 100;
      }
      return variant;
    });
  }
  next();
});

// Index for efficient queries
// Unique constraint: one product can only be added once per store
storeProductSchema.index({ storeId: 1, productId: 1 }, { unique: true });
storeProductSchema.index({ storeId: 1, isActive: 1 });
storeProductSchema.index({ storeId: 1, isFeatured: 1 });
storeProductSchema.index({ storeId: 1, isActive: 1, isFeatured: 1 });

export const StoreProduct = mongoose.model<IStoreProduct>(
  'StoreProduct',
  storeProductSchema
);
export default StoreProduct;

