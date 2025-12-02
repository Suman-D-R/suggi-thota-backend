// Hero Banner model
import mongoose, { Document, Schema } from 'mongoose';

export interface IHeroBanner extends Document {
  _id: mongoose.Types.ObjectId;
  title: string;
  subtitle: string;
  backgroundColor: string;
  icon?: string;
  image?: string; // Optional image URL (alternative to icon)
  link?: string; // Optional link to navigate to
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

// Hero Banner schema
const heroBannerSchema = new Schema<IHeroBanner>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    subtitle: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    backgroundColor: {
      type: String,
      required: true,
      trim: true,
      default: '#4CAF50',
    },
    icon: {
      type: String,
      trim: true,
    },
    image: {
      type: String,
      trim: true,
    },
    link: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
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
heroBannerSchema.index({ isActive: 1, sortOrder: 1 });
heroBannerSchema.index({ createdAt: -1 });

// Static methods
heroBannerSchema.statics.findActive = function () {
  return this.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
};

// Export the model
export const HeroBanner = mongoose.model<IHeroBanner>('HeroBanner', heroBannerSchema);
export default HeroBanner;

