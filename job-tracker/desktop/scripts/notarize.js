const { notarize } = require('@electron/notarize');

/**
 * Notarization script for macOS
 * Called automatically after signing during the build process
 */
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  // Only notarize for macOS
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization (not macOS)');
    return;
  }

  // Check environment variables
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.warn('⚠️  Skipping notarization: Missing environment variables');
    console.warn('   Required: APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔐 Starting notarization process...');
  console.log(`📦 App: ${appName}`);
  console.log(`📂 Path: ${appPath}`);
  console.log(`👤 Apple ID: ${process.env.APPLE_ID}`);
  console.log(`🏢 Team ID: ${process.env.APPLE_TEAM_ID}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    await notarize({
      appBundleId: 'com.kreativekoala.jobtracker', // Change this to your bundle ID
      appPath: appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    });
    
    console.log('');
    console.log('✅ Notarization successful!');
    console.log('   Your app is now verified by Apple and will install without warnings.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    console.error('');
    console.error('❌ Notarization failed!');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(error);
    console.error('');
    console.error('Common issues:');
    console.error('1. Invalid Apple ID or password');
    console.error('2. App-specific password not used (required for 2FA accounts)');
    console.error('3. Team ID incorrect');
    console.error('4. App not properly signed');
    console.error('');
    console.error('To generate app-specific password:');
    console.error('https://appleid.apple.com/account/manage → Security → App-Specific Passwords');
    console.error('');
    throw error;
  }
};