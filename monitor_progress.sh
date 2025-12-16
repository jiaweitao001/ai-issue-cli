#!/bin/bash
# monitor_progress.sh - Monitor AI Issue processing progress

ISSUE_NUMBER=$1
REPORT_PATH="/Users/jiaweitao/Downloads/AI_Issue_Experiment"

if [ -z "$ISSUE_NUMBER" ]; then
    echo "Usage: $0 <issue_number>"
    exit 1
fi

ANALYSIS_FILE="$REPORT_PATH/issue-$ISSUE_NUMBER-analysis.md"
EVAL_FILE="$REPORT_PATH/issue-$ISSUE_NUMBER-evaluation.md"

echo "📊 Monitoring Issue #$ISSUE_NUMBER processing progress"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

while true; do
    clear
    echo "📊 Monitoring Issue #$ISSUE_NUMBER processing progress"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Time: $(date '+%H:%M:%S')"
    echo ""
    
    # Check analysis report
    if [ -f "$ANALYSIS_FILE" ]; then
        SIZE=$(wc -l < "$ANALYSIS_FILE")
        echo "✅ Analysis report: Generated ($SIZE lines)"
    else
        echo "⏳ Analysis report: Processing..."
    fi
    
    # Check evaluation report
    if [ -f "$EVAL_FILE" ]; then
        SIZE=$(wc -l < "$EVAL_FILE")
        echo "✅ Evaluation report: Generated ($SIZE lines)"
    else
        echo "⏳ Evaluation report: Waiting..."
    fi
    
    echo ""
    
    # Check Git branch
    cd /Users/jiaweitao/Work/terraform-provider-azurerm 2>/dev/null
    if git rev-parse --verify "issue-$ISSUE_NUMBER" &>/dev/null; then
        echo "✅ Git branch: issue-$ISSUE_NUMBER created"
        COMMITS=$(git rev-list --count "issue-$ISSUE_NUMBER" ^main 2>/dev/null || echo "0")
        echo "   Commits: $COMMITS"
    else
        echo "⏳ Git branch: Not created yet"
    fi
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Press Ctrl+C to exit monitoring"
    echo ""
    
    # Exit if all complete
    if [ -f "$ANALYSIS_FILE" ] && [ -f "$EVAL_FILE" ]; then
        echo "🎉 Processing completed!"
        break
    fi
    
    sleep 5
done
