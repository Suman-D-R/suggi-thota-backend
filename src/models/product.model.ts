// Product model
import mongoose, { Document, Schema } from 'mongoose';

export interface IProductVariant {
  size: number;
  unit: 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen';
  originalPrice?: number; // Price per variant (enriched from batches)
  sellingPrice?: number; // Selling price per variant (enriched from batches)
  discount?: number; // Discount per variant (enriched from batches)
  stock?: number; // Stock available for this variant (enriched from batches)
  isOutOfStock?: boolean; // Whether this variant is out of stock (enriched from batches)
}

export interface IProduct extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  category: mongoose.Types.ObjectId | string;
  size: number; // Deprecated: kept for backward compatibility
  unit: 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen'; // Deprecated: kept for backward compatibility
  variants: IProductVariant[]; // New: array of size/unit combinations
  images: string[];
  attributes: Map<string, string>;
  isActive: boolean;
  averageCostPerQuantity?: number; // Auto-calculated from batches

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Product schema
const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    category: {
      type: Schema.Types.Mixed,
      ref: 'Category',
      required: true,
      validate: {
        validator: function(value: any) {
          // Allow ObjectId or dummy strings ending with '-id'
          if (value instanceof mongoose.Types.ObjectId) return true;
          if (typeof value === 'string') {
            return value.endsWith('-id') || mongoose.Types.ObjectId.isValid(value);
          }
          return false;
        },
        message: 'Category must be a valid ObjectId or dummy ID ending with "-id"'
      }
    },
    size: {
      type: Number,
      required: false, // Made optional for backward compatibility
      min: 0,
    },
    unit: {
      type: String,
      enum: ['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'],
      required: false, // Made optional for backward compatibility
    },
    variants: {
      type: [
        {
          size: {
            type: Number,
            required: true,
            min: 0,
          },
          unit: {
            type: String,
            enum: ['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'],
            required: true,
          },
        },
      ],
      default: [],
      validate: {
        validator: function(value: IProductVariant[]) {
          // At least one variant is required if size/unit are not provided
          if (!this.size || !this.unit) {
            return Array.isArray(value) && value.length > 0;
          }
          return true;
        },
        message: 'At least one variant is required when size/unit are not provided',
      },
    },
    images: {
      type: [String],
      required: true,
      validate: {
        validator: function(value: string[]) {
          return Array.isArray(value) && value.length > 0;
        },
        message: 'At least one image is required'
      }
    },
    attributes: {
      type: Map,
      of: String,
      required: true,
      default: new Map(),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    averageCostPerQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Pre-save hook: Ensure backward compatibility
productSchema.pre('save', function(next) {
  // If variants array is empty but size/unit are provided, create a variant from them
  if ((!this.variants || this.variants.length === 0) && this.size && this.unit) {
    this.variants = [{ size: this.size, unit: this.unit }];
  }
  // If variants exist but size/unit are not set, set them from the first variant
  if (this.variants && this.variants.length > 0 && (!this.size || !this.unit)) {
    this.size = this.variants[0].size;
    this.unit = this.variants[0].unit;
  }
  next();
});

// Indexes
productSchema.index({ name: 'text' });
productSchema.index({ category: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ createdAt: -1 });

// Static methods
productSchema.statics.findActive = function () {
  return this.find({ isActive: true });
};

productSchema.statics.findByCategory = function (categoryId: string) {
  // Handle both ObjectId and string category IDs
  const filter: any = { isActive: true };
  if (mongoose.Types.ObjectId.isValid(categoryId)) {
    filter.category = new mongoose.Types.ObjectId(categoryId);
  } else {
    filter.category = categoryId; // For dummy IDs
  }
  return this.find(filter);
};

productSchema.statics.searchProducts = function (query: string) {
  return this.find({
    $text: { $search: query },
    isActive: true,
  });
};

// Export the model
export const Product = mongoose.model<IProduct>('Product', productSchema);
export default Product;

