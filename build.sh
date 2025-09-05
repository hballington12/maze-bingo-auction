#!/bin/bash

# Build script for Render deployment

echo "Installing root dependencies..."
npm install

echo "Building server..."
npx tsc

echo "Installing client dependencies..."
cd client
npm install

echo "Building client..."
npm run build

echo "Build complete!"