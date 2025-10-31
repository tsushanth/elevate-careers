import admin from 'firebase-admin';
import db from '../db/index.js';

let firebaseInitialized = false;

// Initialize Firebase Admin
export function initializeFirebase() {
  if (firebaseInitialized) return;

  try {
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
      firebaseInitialized = true;
      console.log('Firebase initialized successfully');
    } else {
      console.warn('Firebase credentials not configured. Push notifications will be disabled.');
    }
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
}

// Send notification to all user's devices
export async function sendNotificationToUser(userId, notification) {
  if (!firebaseInitialized) {
    console.log('Firebase not initialized, skipping notification');
    return { success: false, error: 'Firebase not configured' };
  }

  try {
    // Get all devices for user with FCM tokens
    const result = await db.query(
      'SELECT fcm_token FROM devices WHERE user_id = $1 AND fcm_token IS NOT NULL',
      [userId]
    );

    if (result.rows.length === 0) {
      console.log('No devices with FCM tokens for user', userId);
      return { success: true, sent: 0 };
    }

    const tokens = result.rows.map(row => row.fcm_token);
    const message = {
      notification: {
        title: notification.title,
        body: notification.body
      },
      data: notification.data || {},
      tokens
    };

    const response = await admin.messaging().sendMulticast(message);

    console.log(`Sent ${response.successCount} notifications to user ${userId}`);

    // Remove invalid tokens
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
        }
      });

      if (failedTokens.length > 0) {
        await db.query(
          'UPDATE devices SET fcm_token = NULL WHERE fcm_token = ANY($1)',
          [failedTokens]
        );
        console.log(`Removed ${failedTokens.length} invalid FCM tokens`);
      }
    }

    return {
      success: true,
      sent: response.successCount,
      failed: response.failureCount
    };
  } catch (error) {
    console.error('Send notification error:', error);
    return { success: false, error: error.message };
  }
}

// Register device for notifications
export async function registerDevice(userId, deviceType, deviceName, fcmToken) {
  try {
    const result = await db.query(
      `INSERT INTO devices (user_id, device_type, device_name, fcm_token)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, device_type, device_name) 
       DO UPDATE SET fcm_token = $4, last_seen = CURRENT_TIMESTAMP
       RETURNING id`,
      [userId, deviceType, deviceName, fcmToken]
    );

    return { success: true, deviceId: result.rows[0].id };
  } catch (error) {
    console.error('Register device error:', error);
    throw error;
  }
}

export default {
  initializeFirebase,
  sendNotificationToUser,
  registerDevice
};