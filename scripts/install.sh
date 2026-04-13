#!/bin/bash
# install.sh - Install ai-issue CLI tool

set -e

echo "🚀 Installing AI Issue CLI Tool"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please visit https://nodejs.org/ to install Node.js"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js version: $NODE_VERSION"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi

NPM_VERSION=$(npm --version)
echo "✅ npm version: $NPM_VERSION"
echo ""

# Get project root directory (parent of scripts/)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"

# Method 1: Global installation (recommended)
echo "Choose installation method:"
echo "  1) Global installation (recommended, use ai-issue command anywhere)"
echo "  2) Local link (development mode, use current code directly)"
echo ""
read -p "Please choose [1/2]: " choice

case $choice in
  1)
    echo ""
    echo "📦 Installing dependencies..."
    cd "$SCRIPT_DIR"
    npm install
    
    echo ""
    echo "📦 Installing ai-issue globally..."
    npm install -g .
    
    echo ""
    echo "📦 Installing skills dependencies..."
    cd "$SCRIPT_DIR/skills/github-issue-fetcher" && npm install --silent
    cd "$SCRIPT_DIR/skills/code-similarity-finder" && npm install --silent
    echo "✅ Skills installed"
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ Installation completed!"
    echo ""
    echo "🎯 Quick start:"
    echo "  ai-issue check          # Check environment"
    echo "  ai-issue config show    # View configuration"
    echo "  ai-issue solve 30340    # Solve Issue"
    echo ""
    ;;
    
  2)
    echo ""
    echo "📦 Installing dependencies..."
    cd "$SCRIPT_DIR"
    npm install
    
    echo ""
    echo "🔗 Linking ai-issue locally..."
    npm link
    
    echo ""
    echo "📦 Installing skills dependencies..."
    cd "$SCRIPT_DIR/skills/github-issue-fetcher" && npm install --silent
    cd "$SCRIPT_DIR/skills/code-similarity-finder" && npm install --silent
    echo "✅ Skills installed"
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ Link completed!"
    echo ""
    echo "💡 Development mode:"
    echo "  - Code changes will take effect immediately"
    echo "  - Uninstall: npm unlink -g ai-issue-cli"
    echo ""
    echo "🎯 Quick start:"
    echo "  ai-issue check          # Check environment"
    echo "  ai-issue config show    # View configuration"
    echo ""
    ;;
    
  *)
    echo "❌ Invalid choice"
    exit 1
    ;;
esac

# Check GitHub Copilot CLI
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Checking dependencies..."
echo ""

if command -v copilot &> /dev/null; then
    COPILOT_VERSION=$(copilot --version 2>&1 | head -1)
    echo "✅ GitHub Copilot CLI: $COPILOT_VERSION"
else
    echo "⚠️  GitHub Copilot CLI is not installed"
    echo ""
    echo "Installation method:"
    echo "  npm install -g @github/copilot"
    echo ""
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All done!"
echo ""
