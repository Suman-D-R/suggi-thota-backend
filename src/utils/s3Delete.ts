// S3 delete utility
import { deleteFromS3 } from './s3Upload';

// Re-export the delete function for backward compatibility
export const s3Delete = {
  deleteFromS3,
};

