// AWS configuration
import { S3Client } from '@aws-sdk/client-s3';
import { envConfig } from './env';

// S3 client configuration using AWS SDK v3
export const s3 = new S3Client({
  region: envConfig.AWS_REGION,
  credentials: {
    accessKeyId: envConfig.AWS_ACCESS_KEY_ID!,
    secretAccessKey: envConfig.AWS_SECRET_ACCESS_KEY!,
  },
});

// S3 bucket configuration
export const s3Config = {
  bucketName: envConfig.S3_BUCKET_NAME,
  region: envConfig.AWS_REGION,
  // ACL removed - bucket doesn't allow ACLs, uses bucket policy instead
  signedUrlExpiry: 3600, // 1 hour in seconds
};

// CloudFront configuration (if using CDN)
export const cloudFrontConfig = {
  distributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
  domain: process.env.CLOUDFRONT_DOMAIN,
};

// SES configuration for emails (alternative to nodemailer)
export const sesConfig = {
  region: envConfig.AWS_REGION,
};

// Export AWS services
export const awsConfig = {
  s3,
  s3Config,
  cloudFrontConfig,
  sesConfig,
};

