// Seed categories script
import mongoose from 'mongoose';
import { Category } from '../models/category.model';
import { connectDB, disconnectDB } from '../config/db';

const categories = [
  // Main Categories
  {
    name: 'Fruits',
    description: 'Fresh and seasonal fruits',
    slug: 'fruits',
    sortOrder: 1,
    subcategories: [
      { name: 'Citrus Fruits', description: 'Oranges, lemons, limes', slug: 'citrus-fruits', sortOrder: 1 },
      { name: 'Tropical Fruits', description: 'Mangoes, pineapples, bananas', slug: 'tropical-fruits', sortOrder: 2 },
      { name: 'Berries', description: 'Strawberries, blueberries, raspberries', slug: 'berries', sortOrder: 3 },
      { name: 'Apples & Pears', description: 'Red apples, green apples, pears', slug: 'apples-pears', sortOrder: 4 },
    ],
  },
  {
    name: 'Vegetables',
    description: 'Fresh vegetables and leafy greens',
    slug: 'vegetables',
    sortOrder: 2,
    subcategories: [
      { name: 'Leafy Greens', description: 'Spinach, lettuce, kale', slug: 'leafy-greens', sortOrder: 1 },
      { name: 'Root Vegetables', description: 'Potatoes, carrots, beets', slug: 'root-vegetables', sortOrder: 2 },
      { name: 'Cruciferous', description: 'Broccoli, cauliflower, cabbage', slug: 'cruciferous', sortOrder: 3 },
      { name: 'Allium', description: 'Onions, garlic, shallots', slug: 'allium', sortOrder: 4 },
    ],
  },
  {
    name: 'Dairy & Eggs',
    description: 'Milk, cheese, eggs and dairy products',
    slug: 'dairy-eggs',
    sortOrder: 3,
    subcategories: [
      { name: 'Milk', description: 'Cow milk, goat milk, plant-based milk', slug: 'milk', sortOrder: 1 },
      { name: 'Cheese', description: 'Cheddar, mozzarella, feta', slug: 'cheese', sortOrder: 2 },
      { name: 'Yogurt', description: 'Greek yogurt, regular yogurt', slug: 'yogurt', sortOrder: 3 },
      { name: 'Eggs', description: 'Chicken eggs, duck eggs', slug: 'eggs', sortOrder: 4 },
    ],
  },
  {
    name: 'Grains & Cereals',
    description: 'Rice, wheat, oats and grains',
    slug: 'grains-cereals',
    sortOrder: 4,
    subcategories: [
      { name: 'Rice', description: 'Basmati rice, brown rice, white rice', slug: 'rice', sortOrder: 1 },
      { name: 'Wheat Products', description: 'Whole wheat flour, bread, pasta', slug: 'wheat-products', sortOrder: 2 },
      { name: 'Oats & Breakfast', description: 'Oatmeal, cereals, granola', slug: 'oats-breakfast', sortOrder: 3 },
    ],
  },
  {
    name: 'Meat & Poultry',
    description: 'Fresh meat and poultry products',
    slug: 'meat-poultry',
    sortOrder: 5,
    subcategories: [
      { name: 'Chicken', description: 'Whole chicken, chicken breast, thighs', slug: 'chicken', sortOrder: 1 },
      { name: 'Beef', description: 'Ground beef, steak cuts, ribs', slug: 'beef', sortOrder: 2 },
      { name: 'Pork', description: 'Pork chops, bacon, sausages', slug: 'pork', sortOrder: 3 },
      { name: 'Lamb & Goat', description: 'Lamb meat, goat meat', slug: 'lamb-goat', sortOrder: 4 },
    ],
  },
  {
    name: 'Seafood',
    description: 'Fresh fish and seafood',
    slug: 'seafood',
    sortOrder: 6,
    subcategories: [
      { name: 'Fresh Fish', description: 'Salmon, tuna, cod, tilapia', slug: 'fresh-fish', sortOrder: 1 },
      { name: 'Shellfish', description: 'Shrimp, crab, lobster, mussels', slug: 'shellfish', sortOrder: 2 },
      { name: 'Smoked Fish', description: 'Smoked salmon, herring', slug: 'smoked-fish', sortOrder: 3 },
    ],
  },
];

async function seedCategories() {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log('Connected to MongoDB');

    // Clear existing categories
    await Category.deleteMany({});
    console.log('Cleared existing categories');

    // Create categories with subcategories
    for (const categoryData of categories) {
      // Create main category
      const mainCategory = new Category({
        name: categoryData.name,
        description: categoryData.description,
        slug: categoryData.slug,
        sortOrder: categoryData.sortOrder,
        isActive: true,
      });

      await mainCategory.save();
      console.log(`Created main category: ${categoryData.name}`);

      // Create subcategories
      const subcategoryIds: mongoose.Types.ObjectId[] = [];
      for (const subData of categoryData.subcategories) {
        const subcategory = new Category({
          name: subData.name,
          description: subData.description,
          slug: subData.slug,
          parentCategory: mainCategory._id,
          sortOrder: subData.sortOrder,
          isActive: true,
        });

        await subcategory.save();
        subcategoryIds.push(subcategory._id);
        console.log(`Created subcategory: ${subData.name} under ${categoryData.name}`);
      }

      // Update main category with subcategories
      mainCategory.subcategories = subcategoryIds;
      await mainCategory.save();
    }

    console.log('Categories seeded successfully!');
    console.log(`Created ${categories.length} main categories with their subcategories`);

  } catch (error) {
    console.error('Error seeding categories:', error);
  } finally {
    await disconnectDB();
    console.log('Disconnected from MongoDB');
  }
}

// Run the seeding function
if (require.main === module) {
  seedCategories();
}

export { seedCategories };
