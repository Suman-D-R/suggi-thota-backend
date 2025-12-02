// Product model
import mongoose, { Document, Schema } from 'mongoose';

export interface IProduct extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  category: mongoose.Types.ObjectId | string;
  subcategory?: mongoose.Types.ObjectId | string;

  // Pricing
  price: number;
  originalPrice?: number;
  discount?: number;
  cost?: number; // Total product cost for profit/loss tracking

  // Inventory
  stock: number;
  minStock: number;
  maxStock: number;
  sku: string;
  barcode?: string;

  // Images
  images: string[];
  thumbnail?: string;

  // Product details
  brand?: string;
  weight?: number;
  unit: 'kg' | 'g' | 'liter' | 'ml' | 'piece' | 'pack' | 'dozen';
  nutritionalInfo?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
  };

  // Tags and attributes
  tags: string[];
  attributes: Map<string, string>;

  // Status
  isActive: boolean;
  isFeatured: boolean;
  isOutOfStock: boolean;

  // SEO (optional - for future web integration)
  slug?: string;
  metaTitle?: string;
  metaDescription?: string;

  // Ratings and reviews
  averageRating: number;
  totalReviews: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Virtuals
  isOnSale?: boolean;
  discountPercentage?: number;
  categoryName?: string;
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
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
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
    subcategory: {
      type: Schema.Types.Mixed,
      ref: 'Category',
      validate: {
        validator: function(value: any) {
          if (!value) return true; // Allow null/undefined
          // Allow ObjectId or dummy strings ending with '-id'
          if (value instanceof mongoose.Types.ObjectId) return true;
          if (typeof value === 'string') {
            return value.endsWith('-id') || mongoose.Types.ObjectId.isValid(value);
          }
          return false;
        },
        message: 'Subcategory must be a valid ObjectId or dummy ID ending with "-id"'
      }
    },

    // Pricing
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    originalPrice: {
      type: Number,
      min: 0,
    },
    discount: {
      type: Number,
      min: 0,
      max: 100,
    },
    cost: {
      type: Number,
      min: 0,
    },

    // Inventory
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    minStock: {
      type: Number,
      min: 0,
      default: 5,
    },
    maxStock: {
      type: Number,
      min: 0,
    },
    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    barcode: {
      type: String,
      unique: true,
      sparse: true,
    },

    // Images
    images: [{
      type: String,
    }],
    thumbnail: {
      type: String,
    },

    // Product details
    brand: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    weight: {
      type: Number,
      min: 0,
    },
    unit: {
      type: String,
      enum: ['kg', 'g', 'liter', 'ml', 'piece', 'pack', 'dozen'],
      required: true,
    },
    nutritionalInfo: {
      calories: { type: Number, min: 0 },
      protein: { type: Number, min: 0 },
      carbs: { type: Number, min: 0 },
      fat: { type: Number, min: 0 },
      fiber: { type: Number, min: 0 },
    },

    // Tags and attributes
    tags: [{
      type: String,
      trim: true,
      lowercase: true,
    }],
    attributes: {
      type: Map,
      of: String,
      default: new Map(),
    },

    // Status
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isOutOfStock: {
      type: Boolean,
      default: false,
    },

    // SEO (optional - for future web integration)
    slug: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    metaTitle: {
      type: String,
      maxlength: 60,
    },
    metaDescription: {
      type: String,
      maxlength: 160,
    },

    // Ratings
    averageRating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0,
    },
    totalReviews: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
productSchema.index({ name: 'text', description: 'text' });
productSchema.index({ category: 1 });
productSchema.index({ subcategory: 1 });
productSchema.index({ price: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ isOutOfStock: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ averageRating: -1 });
productSchema.index({ createdAt: -1 });

// Virtuals
productSchema.virtual('isOnSale').get(function () {
  return this.discount && this.discount > 0;
});

productSchema.virtual('discountPercentage').get(function () {
  if (this.discount && this.originalPrice) {
    return Math.round((this.discount / this.originalPrice) * 100);
  }
  return 0;
});

productSchema.virtual('categoryName', {
  ref: 'Category',
  localField: 'category',
  foreignField: '_id',
  justOne: true,
  options: { select: 'name' },
});

// Pre-save middleware
productSchema.pre('save', function (next) {
  const product = this as IProduct;

  // Generate slug if not provided (for web integration)
  if (product.isModified('name') && !product.slug) {
    product.slug = product.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Update out of stock status
  product.isOutOfStock = product.stock <= 0;

  // Set thumbnail from first image if not set
  if (product.images.length > 0 && !product.thumbnail) {
    product.thumbnail = product.images[0];
  }

  next();
});

// Static methods
productSchema.statics.findActive = function () {
  return this.find({ isActive: true, isOutOfStock: false });
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

productSchema.statics.findBySlug = function (slug: string) {
  return this.findOne({ slug, isActive: true });
};

productSchema.statics.findFeatured = function () {
  return this.find({ isFeatured: true, isActive: true, isOutOfStock: false });
};

productSchema.statics.findOnSale = function () {
  return this.find({
    discount: { $gt: 0 },
    isActive: true,
    isOutOfStock: false
  });
};

productSchema.statics.searchProducts = function (query: string) {
  return this.find({
    $text: { $search: query },
    isActive: true,
  });
};

// Instance methods
productSchema.methods.updateStock = async function (quantity: number): Promise<void> {
  this.stock = Math.max(0, this.stock + quantity);
  this.isOutOfStock = this.stock <= 0;
  await this.save();
};

productSchema.methods.isLowStock = function (): boolean {
  return this.stock <= this.minStock;
};

productSchema.methods.getPrice = function (): number {
  return this.price;
};

productSchema.methods.getDiscountedPrice = function (): number {
  if (this.discount && this.originalPrice) {
    return this.originalPrice - (this.originalPrice * this.discount / 100);
  }
  return this.price;
};

// Export the model
export const Product = mongoose.model<IProduct>('Product', productSchema);
export default Product;

