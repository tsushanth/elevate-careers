#!/bin/bash

# Test backend with Docker locally before deploying to GCP

echo "🧪 Testing Backend with Docker"
echo "=============================="
echo ""

# Build image
echo "Building Docker image..."
docker build -t job-tracker-backend:test .

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build successful!"
echo ""

# Run container
echo "Starting container..."
docker run -d \
    --name job-tracker-test \
    -p 8080:8080 \
    -e DATABASE_URL="postgresql://user:pass@host.docker.internal:5432/job_tracker" \
    -e JWT_SECRET="test-secret-key-for-local-testing-only" \
    -e NODE_ENV="development" \
    -e PORT="8080" \
    job-tracker-backend:test

if [ $? -ne 0 ]; then
    echo "❌ Failed to start container!"
    exit 1
fi

echo "✅ Container started!"
echo ""

# Wait for startup
echo "Waiting for app to start..."
sleep 5

# Test health endpoint
echo "Testing health endpoint..."
RESPONSE=$(curl -s http://localhost:8080/health)

if [[ $RESPONSE == *"ok"* ]]; then
    echo "✅ Health check passed!"
    echo "Response: $RESPONSE"
else
    echo "❌ Health check failed!"
    echo "Response: $RESPONSE"
fi

echo ""
echo "Container is running!"
echo "  - Health: http://localhost:8080/health"
echo "  - API: http://localhost:8080/api"
echo ""
echo "View logs:"
echo "  docker logs -f job-tracker-test"
echo ""
echo "Stop container:"
echo "  docker stop job-tracker-test"
echo "  docker rm job-tracker-test"