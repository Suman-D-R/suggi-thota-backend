// Script to create geospatial index on Store model
import { connectDB, disconnectDB } from '../config/db';
import { Store } from '../models/store.model';
import { logger } from '../utils/logger';

async function createStoreIndex() {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log('Connected to MongoDB');

    // Check if index already exists
    const indexes = await Store.collection.indexes();
    const geoIndex = indexes.find((idx: any) => 
      idx.key && idx.key.location === '2dsphere'
    );

    if (geoIndex) {
      console.log('✅ Geospatial index already exists');
      console.log('   Index name:', geoIndex.name);
      logger.info('Geospatial index already exists');
    } else {
      // Create the geospatial index
      try {
        await Store.collection.createIndex({ location: '2dsphere' });
        console.log('✅ Geospatial index created successfully on stores collection');
        logger.info('Geospatial index created successfully on stores collection');
      } catch (error: any) {
        // If index already exists (race condition), that's fine
        if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
          console.log('✅ Geospatial index already exists');
          logger.info('Geospatial index already exists');
        } else {
          throw error;
        }
      }
    }

    // Verify the index exists (re-fetch to get updated list)
    const finalIndexes = await Store.collection.indexes();
    const finalGeoIndex = finalIndexes.find((idx: any) => 
      idx.key && idx.key.location === '2dsphere'
    );
    
    if (finalGeoIndex) {
      console.log('✅ Verified: Geospatial index exists');
      console.log('   Index name:', finalGeoIndex.name);
      console.log('   Index key:', JSON.stringify(finalGeoIndex.key));
    } else {
      console.log('⚠️  Warning: Could not verify geospatial index');
    }

  } catch (error) {
    console.error('❌ Error creating store index:', error);
    logger.error('Error creating store index:', error);
    throw error;
  } finally {
    await disconnectDB();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
if (require.main === module) {
  createStoreIndex()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export default createStoreIndex;

