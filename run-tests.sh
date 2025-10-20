#!/bin/bash
# run-tests.sh - Convenient test runner script

echo "🧪 WhatsApp Logistics Bot - Test Suite Runner"
echo "=============================================="
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate > /dev/null 2>&1
echo ""

# Parse command line arguments
case "$1" in
    "unit")
        echo "🔬 Running Unit Tests..."
        npm run test:unit
        ;;
    "integration")
        echo "🔗 Running Integration Tests..."
        npm run test:integration
        ;;
    "watch")
        echo "👀 Running Tests in Watch Mode..."
        npm run test:watch
        ;;
    "coverage")
        echo "📊 Running Tests with Coverage..."
        npm test -- --coverage
        ;;
    *)
        echo "🚀 Running All Tests..."
        npm test
        ;;
esac

echo ""
echo "✅ Test run complete!"
