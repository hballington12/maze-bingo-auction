#!/bin/bash
set -e  # Exit on any error

# Build script for Render deployment

echo "Installing root dependencies..."
npm install

echo "Building server..."
npx tsc --project tsconfig.json
if [ ! -d "dist" ]; then
  echo "Error: TypeScript compilation failed - dist directory not created"
  exit 1
fi

echo "Installing client dependencies..."
cd client
npm install --include=dev

echo "Building client..."
npm run build

cd ..
echo "Build complete!"