# Firebase Phone Authentication Setup Guide

## Overview
This backend uses Firebase Identity Toolkit REST API to send OTPs via SMS to real phone numbers.

## Required Setup

### 1. Firebase Console Configuration

1. **Enable Phone Authentication:**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Select your project
   - Navigate to **Authentication** → **Sign-in method**
   - Enable **Phone** provider
   - Configure reCAPTCHA settings:
     - For backend-only: Set reCAPTCHA to **"Invisible"** or **"Optional"**
     - This allows backend to send OTPs without client-side reCAPTCHA

2. **Get Firebase Web API Key:**
   - Go to **Project Settings** → **General**
   - Scroll to **Your apps** section
   - Find your **Web app** (or create one)
   - Copy the **Web API Key** (starts with `AIza...`)

3. **Configure Test Phone Numbers (Optional for Testing):**
   - Go to **Authentication** → **Sign-in method** → **Phone**
   - Add test phone numbers that don't require reCAPTCHA
   - Format: `+1234567890` (with country code)

### 2. Environment Variables

Add to your `.env` file:

```env
# Firebase Admin SDK (for token verification)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Firebase Web API Key (for REST API - REQUIRED for OTP)
FIREBASE_WEB_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Optional: reCAPTCHA token (if required)
# FIREBASE_RECAPTCHA_TOKEN=your-recaptcha-token
```

### 3. How It Works

1. **App sends phone number** → `POST /api/auth/send-otp` with `{ phoneNumber: "+919876543210" }`
2. **Backend calls Firebase REST API** → Firebase sends SMS with OTP code
3. **User receives SMS** → Contains 6-digit OTP code
4. **App sends OTP** → `POST /api/auth/verify-otp` with `{ phoneNumber: "+919876543210", otp: "123456" }`
5. **Backend verifies with Firebase** → Returns JWT tokens if valid

## API Endpoints

### Send OTP
```bash
POST /api/auth/send-otp
Content-Type: application/json

{
  "phoneNumber": "+919876543210"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP sent successfully to your phone number via Firebase SMS",
  "data": {
    "phoneNumber": "+91****543210",
    "expiresIn": 10
  }
}
```

### Verify OTP
```bash
POST /api/auth/verify-otp
Content-Type: application/json

{
  "phoneNumber": "+919876543210",
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "...",
      "name": "User-543210",
      "phone": "+919876543210",
      "isVerified": true
    },
    "tokens": {
      "accessToken": "...",
      "refreshToken": "..."
    }
  }
}
```

## Troubleshooting

### Error: "MISSING_RECAPTCHA_TOKEN"
- **Solution**: Configure reCAPTCHA as "Invisible" in Firebase Console
- Or use test phone numbers configured in Firebase Console

### Error: "INVALID_API_KEY"
- **Solution**: Check that `FIREBASE_WEB_API_KEY` is correct
- Get it from Firebase Console → Project Settings → General → Web API Key

### Error: "PHONE_NUMBER_NOT_VERIFIED"
- **Solution**: Ensure Phone Authentication is enabled in Firebase Console
- Check that the phone number format is correct (international format with +)

### OTP Not Received
- Check Firebase Console → Authentication → Users (should show verification attempts)
- Verify phone number format: Must include country code (e.g., +91 for India)
- Check Firebase quotas/limits in Console

## Testing

1. **Test Phone Numbers:**
   - Add test numbers in Firebase Console
   - These don't require reCAPTCHA
   - OTP is always `123456` for test numbers

2. **Real Phone Numbers:**
   - Requires proper Firebase configuration
   - May need reCAPTCHA setup
   - Will send real SMS (may incur costs)

## Cost Considerations

- Firebase Phone Auth has free tier: 10,000 verifications/month
- After that, charges apply per verification
- Check Firebase Console → Usage and Billing for details

