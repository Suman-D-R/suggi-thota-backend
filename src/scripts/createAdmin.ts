// Script to create an admin user
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db';
import { User } from '../models/user.model';
import { USER_ROLES } from '../constants/roles';
import { AUTH_METHODS } from '../constants/authTypes';
import { logger } from '../utils/logger';

const createAdmin = async () => {
  try {
    // Connect to database
    await connectDB();

    // Default admin credentials (can be changed via environment variables)
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@vitura.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminName = process.env.ADMIN_NAME || 'Admin User';
    const adminPhone = process.env.ADMIN_PHONE || '+919999999999';

    // Check if admin already exists
    const existingAdmin = await User.findOne({
      $or: [
        { email: adminEmail.toLowerCase() },
        { phone: adminPhone },
      ],
      role: USER_ROLES.ADMIN,
    });

    if (existingAdmin) {
      logger.info('Admin user already exists');
      console.log('✅ Admin user already exists');
      console.log(`   Email: ${existingAdmin.email || 'N/A'}`);
      console.log(`   Phone: ${existingAdmin.phone || 'N/A'}`);
      console.log(`   Name: ${existingAdmin.name}`);
      
      // Option to update password
      if (process.argv.includes('--update-password')) {
        existingAdmin.password = adminPassword;
        await existingAdmin.save();
        logger.info('Admin password updated');
        console.log('✅ Admin password updated');
      }
      
      await disconnectDB();
      return;
    }

    // Create admin user
    const admin = new User({
      name: adminName,
      email: adminEmail.toLowerCase(),
      phone: adminPhone,
      password: adminPassword,
      role: USER_ROLES.ADMIN,
      authMethod: AUTH_METHODS.PASSWORD,
      isVerified: true,
      isActive: true,
    });

    await admin.save();

    logger.info('Admin user created successfully');
    console.log('✅ Admin user created successfully');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Phone: ${adminPhone}`);
    console.log(`   Password: ${adminPassword}`);
    console.log(`   Name: ${adminName}`);

    await disconnectDB();
    process.exit(0);
  } catch (error) {
    logger.error('Error creating admin user:', error);
    console.error('❌ Error creating admin user:', error);
    await disconnectDB();
    process.exit(1);
  }
};

// Run the script
createAdmin();

