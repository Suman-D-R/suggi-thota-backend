# How to Start the Backend Server

## Quick Start

1. **Navigate to backend directory:**
   ```bash
   cd suggi-thota-exp
   ```

2. **Install dependencies (if not already done):**
   ```bash
   npm install
   ```

3. **Make sure MongoDB is running:**
   ```bash
   # Check if MongoDB is running
   # If not, start it:
   mongod
   # Or use Docker:
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   ```

4. **Start the server:**
   ```bash
   npm run dev
   ```

   You should see:
   ```
   ✅ Server is running on port 3000
   🚀 Server is running on port 3000
   ```

## Troubleshooting

### Port Already in Use
If you see `EADDRINUSE` error:
```bash
# Kill the process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use a different port
PORT=3001 npm run dev
```

### MongoDB Connection Error
Make sure MongoDB is running:
```bash
# Check MongoDB status
mongosh --eval "db.adminCommand('ping')"
```

### Missing Environment Variables
Create a `.env` file in `suggi-thota-exp/` directory with at minimum:
```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/suggi-thota
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-refresh-secret-key
```

## Test the Server

Once running, test the health endpoint:
```bash
curl http://localhost:3000/health
```

You should get:
```json
{
  "success": true,
  "message": "Server is healthy",
  "timestamp": "...",
  "environment": "development"
}
```

## Test OTP Endpoint

```bash
curl -X POST http://localhost:3000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+919555555555"}'
```

In development mode, the OTP will be logged to the console (not sent via SMS).

