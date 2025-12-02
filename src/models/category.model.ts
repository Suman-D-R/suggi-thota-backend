// Category model
import mongoose, { Document, Schema, Model } from 'mongoose';

export interface ICategory extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  image?: string;
  icon?: string;
  parentCategory?: mongoose.Types.ObjectId;
  subcategories: mongoose.Types.ObjectId[];
  isActive: boolean;
  sortOrder: number;

  // SEO fields
  slug: string;
  metaTitle?: string;
  metaDescription?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Virtuals
  productCount?: number;
}

// Model interface with static methods
export interface ICategoryModel extends Model<ICategory> {
  findActive(): mongoose.Query<ICategory[], ICategory>;
  findBySlug(slug: string): mongoose.Query<ICategory | null, ICategory>;
  findMainCategories(): mongoose.Query<ICategory[], ICategory>;
  findSubcategories(parentId: string): mongoose.Query<ICategory[], ICategory>;
}

// Category schema
const categorySchema = new Schema<ICategory>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    image: {
      type: String,
    },
    icon: {
      type: String,
    },
    parentCategory: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    subcategories: [{
      type: Schema.Types.ObjectId,
      ref: 'Category',
    }],
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },

    // SEO fields
    slug: {
      type: String,
      required: true,
      unique: true,
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
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
categorySchema.index({ parentCategory: 1 });
categorySchema.index({ isActive: 1 });
categorySchema.index({ sortOrder: 1 });
categorySchema.index({ createdAt: -1 });

// Virtual for product count
categorySchema.virtual('productCount', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'category',
  count: true,
});

// Pre-save middleware to generate slug
categorySchema.pre('save', function (next) {
  const category = this as ICategory;

  if (category.isModified('name') && !category.slug) {
    category.slug = category.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  next();
});

// Static methods
categorySchema.statics.findActive = function () {
  return this.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
};

categorySchema.statics.findBySlug = function (slug: string) {
  return this.findOne({ slug, isActive: true });
};

categorySchema.statics.findMainCategories = function () {
  return this.find({ parentCategory: null, isActive: true }).sort({ sortOrder: 1 });
};

categorySchema.statics.findSubcategories = function (parentId: string) {
  return this.find({ parentCategory: parentId, isActive: true }).sort({ sortOrder: 1 });
};

// Instance methods
categorySchema.methods.getFullPath = async function (): Promise<string> {
  const path = [this.name];
  let currentCategory = this;

  while (currentCategory.parentCategory) {
    const parent = await mongoose.model('Category').findById(currentCategory.parentCategory);
    if (parent) {
      path.unshift(parent.name);
      currentCategory = parent;
    } else {
      break;
    }
  }

  return path.join(' > ');
};

categorySchema.methods.getAllDescendants = async function (): Promise<ICategory[]> {
  const descendants: ICategory[] = [];

  const findDescendants = async (categoryId: mongoose.Types.ObjectId) => {
    const subs = await mongoose.model('Category').find({ parentCategory: categoryId });
    for (const sub of subs) {
      descendants.push(sub);
      await findDescendants(sub._id);
    }
  };

  await findDescendants(this._id);
  return descendants;
};

// Export the model
export const Category = mongoose.model<ICategory, ICategoryModel>('Category', categorySchema);
export default Category;

