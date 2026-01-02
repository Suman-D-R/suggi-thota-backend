# Vitura Backend API

A production-ready backend API for the Vitura grocery delivery application, built with Node.js, Express, TypeScript, and MongoDB.

## 🚀 Features

### Authentication & Authorization
- **OTP-based Authentication**: Phone/email OTP login and registration
- **Password Authentication**: Traditional email/phone + password login
- **Google OAuth**: Google Sign-In integration
- **JWT Tokens**: Access and refresh token implementation
- **Role-based Access Control**: User, Admin, and Delivery Partner roles

### User Management
- User profiles with comprehensive information
- Address management with delivery preferences
- Order history and statistics
- Account management (password change, profile updates)

### Core Business Features
- **Product Management**: Complete CRUD operations with inventory tracking
- **Category Management**: Hierarchical product categories
- **Shopping Cart**: Persistent cart with item management
- **Order Management**: Full order lifecycle with status tracking
- **Delivery Tracking**: Real-time delivery status updates
- **Payment Integration**: Razorpay payment gateway

### Communication Services
- **Email Notifications**: Welcome emails, order confirmations, password resets
- **Phone Authentication**: OTP via Firebase Phone Authentication
- **WhatsApp Integration**: Business messaging for order updates
- **Push Notifications**: Firebase Cloud Messaging integration

### Security & Performance
- **Rate Limiting**: API rate limiting to prevent abuse
- **Input Validation**: Comprehensive request validation
- **File Upload**: Secure file uploads with AWS S3 integration
- **Error Handling**: Centralized error handling with proper HTTP status codes
- **Logging**: Winston-based logging system
- **Security Headers**: Helmet.js for security headers

## 🛠️ Technology Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **File Storage**: AWS S3
- **Email**: Nodemailer
- **Phone Authentication**: Firebase Phone Authentication
- **Push Notifications**: Firebase Cloud Messaging
- **Payment**: Razorpay
- **Validation**: Express Validator
- **Security**: Helmet, CORS, Rate Limiting
- **Logging**: Winston

## 📁 Project Structure

```
src/
├── config/           # Configuration files
│   ├── aws.ts       # AWS S3 configuration
│   ├── db.ts        # MongoDB connection
│   ├── env.ts       # Environment variables
│   ├── firebase.ts  # Firebase configuration
│   └── firebase.ts  # Firebase configuration (Phone Auth, Push Notifications)
├── constants/        # Application constants
│   ├── authTypes.ts # Authentication types and OTP config
│   └── roles.ts     # User roles
├── controllers/      # Route controllers
│   ├── auth.controller.ts    # Authentication logic
│   └── user.controller.ts    # User management
├── middlewares/      # Express middlewares
│   ├── auth.middleware.ts     # JWT authentication
│   ├── admin.middleware.ts    # Admin role checks
│   ├── validate.middleware.ts # Request validation
│   ├── rateLimit.middleware.ts # Rate limiting
│   ├── upload.middleware.ts   # File upload handling
│   └── error.middleware.ts    # Error handling
├── models/          # MongoDB models
│   ├── user.model.ts       # User schema
│   ├── product.model.ts    # Product schema
│   ├── category.model.ts   # Category schema
│   ├── cart.model.ts       # Shopping cart schema
│   ├── order.model.ts      # Order schema
│   ├── address.model.ts    # Address schema
│   └── delivery.model.ts   # Delivery schema
├── routes/         # API routes
│   ├── auth.routes.ts  # Authentication routes
│   └── user.routes.ts  # User management routes
├── services/       # Business logic services
│   ├── email.service.ts       # Email notifications
│   ├── sms.service.ts         # SMS notifications
│   ├── whatsapp.service.ts    # WhatsApp messaging
│   ├── payment.service.ts     # Payment processing
│   ├── googleAuth.service.ts  # Google OAuth
│   └── notification.service.ts # Combined notifications
├── utils/          # Utility functions
│   ├── jwt.ts              # JWT token utilities
│   ├── otpGenerator.ts     # OTP generation
│   ├── response.ts         # API response utilities
│   ├── s3Upload.ts         # S3 file upload utilities
│   ├── s3Delete.ts         # S3 file deletion utilities
│   ├── tokenGenerator.ts   # Token generation (legacy)
│   ├── validators.ts       # Request validation rules
│   └── logger.ts           # Logging utility
├── app.ts         # Express app configuration
└── server.ts      # Server entry point
```

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- MongoDB (v4.4 or higher)
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd vitura-exp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   ```

   Configure your environment variables in `.env`:
   ```env
   # Server
   NODE_ENV=development
   PORT=3000

   # Database
   MONGODB_URI=mongodb://localhost:27017/vitura

   # JWT
   JWT_SECRET=your-super-secret-jwt-key
   JWT_REFRESH_SECRET=your-refresh-secret-key

   # AWS S3
   AWS_ACCESS_KEY_ID=your-aws-access-key
   AWS_SECRET_ACCESS_KEY=your-aws-secret-key
   AWS_REGION=us-east-1
   S3_BUCKET_NAME=your-s3-bucket

   # Firebase (for Phone Authentication and Push Notifications)
   FIREBASE_PROJECT_ID=your-firebase-project-id
   FIREBASE_PRIVATE_KEY=your-firebase-private-key
   FIREBASE_CLIENT_EMAIL=your-firebase-client-email

   # Email
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-email-password

   # Google OAuth
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret

   # Firebase
   FIREBASE_PROJECT_ID=your-firebase-project
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
   FIREBASE_CLIENT_EMAIL=your-service-account@email.com

   # Razorpay
   RAZORPAY_KEY_ID=your-razorpay-key
   RAZORPAY_KEY_SECRET=your-razorpay-secret
   ```

4. **Start MongoDB**
   ```bash
   # Using local MongoDB
   mongod

   # Or using Docker
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   ```

5. **Run the application**
   ```bash
   # Development mode
   npm run dev

   # Production build
   npm run build
   npm start
   ```

## 📡 API Endpoints

### Authentication Routes (`/api/auth`)
- `POST /send-otp` - Send OTP for login/registration
- `POST /verify-otp` - Verify OTP and authenticate
- `POST /register` - Register with password
- `POST /login` - Login with password
- `POST /google-login` - Google OAuth login
- `GET /google-auth-url` - Get Google OAuth URL
- `POST /refresh-token` - Refresh access token
- `POST /logout` - Logout user

### User Routes (`/api/users`) - *Requires Authentication*
- `GET /profile` - Get user profile
- `PUT /profile` - Update user profile
- `PUT /change-password` - Change password
- `GET /addresses` - Get user addresses
- `GET /orders` - Get user orders
- `GET /stats` - Get user statistics
- `DELETE /account` - Delete user account

### Admin Routes (`/api/users/admin`) - *Requires Admin Role*
- `GET /users` - Get all users (paginated)
- `PUT /users/:userId/role` - Update user role

## 🔐 Authentication

The API uses JWT (JSON Web Token) based authentication with the following flow:

1. **OTP Authentication**:
   ```
   POST /api/auth/send-otp
   {
     "phone": "+919876543210"
   }

   POST /api/auth/verify-otp
   {
     "phone": "+919876543210",
     "otp": "123456"
   }
   ```

2. **Password Authentication**:
   ```
   POST /api/auth/register
   {
     "name": "John Doe",
     "phone": "+919876543210",
     "password": "securepassword"
   }

   POST /api/auth/login
   {
     "phone": "+919876543210",
     "password": "securepassword"
   }
   ```

3. **Google OAuth**:
   ```
   GET /api/auth/google-auth-url
   POST /api/auth/google-login
   {
     "idToken": "google-id-token"
   }
   ```

## 📊 API Response Format

All API responses follow a consistent format:

**Success Response**:
```json
{
  "success": true,
  "message": "Operation successful",
  "data": {
    // Response data
  },
  "meta": {
    // Pagination info (if applicable)
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "message": "Error message",
  "error": "ERROR_CODE",
  "errors": ["Detailed error messages"]
}
```

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run linting
npm run lint

# Run linting with auto-fix
npm run lint:fix
```

## 🚀 Deployment

### Environment Variables for Production
Ensure all production environment variables are properly set:

- Set `NODE_ENV=production`
- Use strong, unique secrets for JWT
- Configure production database URL
- Set up production AWS S3 bucket
- Configure production email/SMS services

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### PM2 Deployment
```bash
npm install -g pm2
pm2 start dist/server.js --name "vitura-api"
```

## 🔒 Security Features

- **JWT Authentication** with access/refresh tokens
- **Rate Limiting** to prevent abuse
- **Input Validation** and sanitization
- **CORS** configuration for cross-origin requests
- **Helmet** for security headers
- **File Upload Validation** with type and size limits
- **Password Hashing** with bcrypt
- **OTP Security** with expiration and attempt limits

## 📈 Monitoring & Logging

- **Winston Logger** with different log levels
- **Morgan** for HTTP request logging
- **Error Tracking** with detailed error responses
- **Health Check** endpoint at `/health`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

This project is licensed under the ISC License.

## 📞 Support

For support and questions, please contact the development team or create an issue in the repository.

---

**Built with ❤️ for Vitura - Fresh groceries delivered to your doorstep!**