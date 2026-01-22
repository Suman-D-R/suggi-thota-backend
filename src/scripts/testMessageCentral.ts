// Test script to send OTP via MessageCentral Verification API
import dotenv from 'dotenv';
dotenv.config();

const MESSAGE_CENTRAL_VERIFICATION_API_URL = 'https://cpaas.messagecentral.com/verification/v3/send';
const AUTH_KEY = process.env.MESSAGE_CENTRAL_AUTH_KEY || '';
const CUSTOMER_ID = process.env.MESSAGE_CENTRAL_CUSTOMER_ID || '';
const PHONE_NUMBER = '9902696211';

async function sendOTP() {
  try {
    if (!AUTH_KEY || !CUSTOMER_ID) {
      console.error('❌ ERROR: MESSAGE_CENTRAL_AUTH_KEY and MESSAGE_CENTRAL_CUSTOMER_ID must be set in .env file');
      console.log('\nPlease add to your .env file:');
      console.log('MESSAGE_CENTRAL_AUTH_KEY=your_auth_key_here');
      console.log('MESSAGE_CENTRAL_CUSTOMER_ID=your_customer_id_here');
      return;
    }

    console.log(`\n🚀 Testing MessageCentral Verification API`);
    console.log(`📱 Phone: ${PHONE_NUMBER}`);
    console.log(`🔑 Auth Key: ${AUTH_KEY.substring(0, 20)}...`);
    console.log(`🔑 Customer ID: ${CUSTOMER_ID}`);
    console.log(`\nℹ️  Note: MessageCentral will generate and send OTP automatically\n`);

    // MessageCentral Verification API parameters
    const params = new URLSearchParams({
      countryCode: '91',
      customerId: CUSTOMER_ID,
      flowType: 'SMS',
      mobileNumber: PHONE_NUMBER,
    });

    const url = `${MESSAGE_CENTRAL_VERIFICATION_API_URL}?${params.toString()}`;

    console.log('📤 Request URL:', url.replace(AUTH_KEY, '***'));
    console.log('📤 Method: POST');
    console.log('📤 Headers: { authToken: "***" }');
    console.log('\n⏳ Sending request...\n');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'authToken': AUTH_KEY,
      },
    });

    const responseData = await response.json() as any;

    console.log('📥 Response Status:', response.status);
    console.log('📥 Response Data:', JSON.stringify(responseData, null, 2));

    // Check for success - MessageCentral returns responseCode: 200 and message: "SUCCESS"
    const isSuccess = response.ok && (
      responseData.responseCode === 200 || 
      responseData.message === 'SUCCESS' ||
      responseData.verificationId || 
      responseData.verification_id ||
      responseData.data?.verificationId
    );

    if (isSuccess) {
      const verificationId = responseData.verificationId || responseData.verification_id || responseData.data?.verificationId;
      console.log('\n✅ SUCCESS! OTP sent successfully!');
      console.log(`📱 Check your phone ${PHONE_NUMBER} for OTP`);
      console.log(`🔑 Verification ID: ${verificationId}`);
      console.log(`\n💡 Use this verificationId to validate the OTP when user enters it.`);
    } else {
      console.log('\n❌ FAILED!');
      console.log('Error:', responseData.message || responseData.error || 'Unknown error');
    }
  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause);
    }
    console.error('Stack:', error.stack);
  }
}

// Run the test
sendOTP();

