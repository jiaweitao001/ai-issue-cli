# AI Issue Solution Evaluation Guide

## Evaluation Task

Comparative analysis of AI solutions against standard answers (PR) for accuracy and quality.

## Evaluation Dimensions and Scoring

### Scoring Criteria (0-5 points)
- **5 points**: Completely correct, equivalent to or better than the standard answer
- **4 points**: Basically correct, core approach is right with minor flaws
- **3 points**: Partially correct, identified some issues but incomplete
- **2 points**: Wrong approach, incorrect solution direction
- **1 point**: Completely wrong, solution is not feasible
- **0 points**: No answer or completely irrelevant

### Weighted Scoring Dimensions

| Dimension | Weight | Scoring Points |
|-----------|--------|----------------|
| **Core Approach** | 30% | Whether the solution approach is consistent, whether technical means are similar |
| **Functional Equivalence** | 25% | Whether it can achieve the same effect, whether edge case handling is consistent |
| **Implementation Method** | 20% | Code modification locations, API usage, code complexity |
| **Completeness** | 15% | Whether it includes code, tests, documentation |
| **Code Quality** | 10% | Code correctness, clarity, maintainability |

### Evaluation Recommendation Levels

| Score Range | Recommendation | Description |
|-------------|----------------|-------------|
| 4.5-5.0 | ✅ Accept | Can be used directly |
| 3.5-4.4 | 🔍 Review | Needs review and improvement |
| 0-3.4 | ❌ Reject | Needs to be redone |


## Evaluation Process

### 1. Obtain Comparison Materials
- Get standard answer from GitHub PR
- Read AI-generated analysis report
- **If Commit Hash exists, use `git show <hash>` to view actual code and evaluate based on real code**

### 2. Core Comparison

| Dimension | AI Solution | Standard Answer (PR) |
|-----------|-------------|----------------------|
| Problem Identification | ... | ... |
| Modified Files | ... | ... |
| Core Modifications | ... | ... |
| Test Cases | ... | ... |

### 3. Analyze Differences

**✅ Similarities**: List consistent parts

**⚠️ Differences**: List key differences and their impact

**❌ Missing Points**: Point out important missing content

### 4. Calculate Score

| Evaluation Dimension | Score | Weight | Weighted Score |
|---------------------|-------|--------|----------------|
| Core Approach | X/5 | 30% | X.XX |
| Functional Equivalence | X/5 | 25% | X.XX |
| Implementation Method | X/5 | 20% | X.XX |
| Completeness | X/5 | 15% | X.XX |
| Code Quality | X/5 | 10% | X.XX |

**Weighted Total Score**: X.XX / 5.0

## Evaluation Report Template

```markdown
# Issue #XXXXX Evaluation Report

## Core Comparison

| Dimension | AI Solution | Standard Answer |
|-----------|-------------|-----------------|
| Problem Identification | ... | ... |
| Modified Files | ... | ... |
| Core Modifications | ... | ... |

## Analysis

**✅ Similarities**: ...
**⚠️ Differences**: ...
**❌ Missing Points**: ...

## Scoring

| Dimension | Score | Weighted Score |
|-----------|-------|----------------|
| Core Approach (30%) | X/5 | X.XX |
| Functional Equivalence (25%) | X/5 | X.XX |
| Implementation Method (20%) | X/5 | X.XX |
| Completeness (15%) | X/5 | X.XX |
| Code Quality (10%) | X/5 | X.XX |

**Total Score**: X.XX / 5.0

## Conclusion

- **Functional Equivalence**: ✅ Yes / ❌ No
- **Recommendation**: ✅ Accept / 🔍 Review / ❌ Reject
- **Improvement Suggestions**: ...
```

## Important Notes

### Evaluation Principles
- Focus on functional equivalence rather than implementation details
- Should acknowledge if AI solution is better
- Edge cases and error handling are equally important
- Remain objective, avoid subjective speculation

### Common Pitfalls
- ❌ Deducting points solely because implementation differs
- ❌ Ignoring details (edge cases, error handling)
- ❌ Being too lenient (giving high scores just for right approach)
- ✅ Evaluate based on objective criteria and actual effectiveness

