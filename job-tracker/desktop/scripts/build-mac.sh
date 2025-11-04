#!/bin/bash

set -e

echo "=================================="
echo "Building Job Tracker for macOS"
echo "=================================="

# Check environment variables
if [ -z "$APPLE_ID" ] || [ -z "$APPLE_ID_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
    echo "❌ Missing environment variables!"
    echo "Required: APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID"
    echo ""
    echo "Set them in your shell profile or run:"
    echo 'export APPLE_ID="your-email@example.com"'
    echo 'export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"'
    echo 'export APPLE_TEAM_ID="YOUR_TEAM_ID"'
    exit 1
fi

echo "✅ Environment variables set"
echo ""

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist
rm -rf release

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build
echo "🔨 Building..."
npm run build

# The build process includes:
# - Code signing
# - Notarization (takes 5-10 minutes)
# - Stapling notarization ticket

echo ""
echo "=================================="
echo "✅ Build complete!"
echo "=================================="
echo ""
echo "Output: dist/Job Tracker-1.0.0.dmg"
echo ""

# Verify
if [ -f "dist/mac/Job Tracker.app" ]; then
    echo "Verifying signature and notarization..."
    codesign --verify --verbose "dist/mac/Job Tracker.app"
    spctl -a -vv -t install "dist/mac/Job Tracker.app"
    echo ""
    echo "✅ App is properly signed and notarized!"
else
    echo "❌ Build failed - app not found"
    exit 1
fi