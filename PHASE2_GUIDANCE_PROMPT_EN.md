````markdown
# Phase 2: Guidance Explanation

Based on Phase 1 research, provide clear and helpful explanations and guidance to users.

---

## Core Task

This Issue **does not require code changes**, it needs:
- Clear explanation of the problem cause
- Provide feasible solutions or workarounds
- Write professional and friendly replies

## Common Scenarios

### 1. User Configuration Error
- Point out the issue in the configuration
- Provide correct configuration examples
- Explain why this configuration is needed

### 2. By Design (Expected Behavior)
- Explain that the current behavior is a design decision
- Explain the reasoning behind the design
- If there are alternatives, provide suggestions

### 3. Version Upgrade Required
- Point out that the issue was fixed in a certain version
- Provide upgrade steps
- Explain the impact of version changes

### 4. Provide Workaround
- Explain why direct support is currently not available
- Provide temporary solutions
- Explain the limitations of the workaround

---

## Output Requirements

⚠️ **Only create `issue-[number]-analysis.md` - delete all other temporary files before finishing**

**Using the following format**:

```markdown
# Issue #[number] Analysis Report

## 1. Problem Analysis

### Problem Symptoms
[Specific problem the user encountered]

### Root Cause
[Why this problem occurs]

### Classification
📖 GUIDANCE - [Specific type: Configuration Error/Expected Behavior/Version Upgrade Required/Workaround]

## 2. Solution

### Recommended Approach
[Detailed explanation of solution steps]

### Configuration Example (If Applicable)
```hcl
# Correct configuration approach
resource "azurerm_xxx" "example" {
  # ...
}
```

### Notes
- [Point to note 1]
- [Point to note 2]

## 3. Additional Information

### Related Documentation
- [Official documentation link]
- [Related Issue/PR]

### Future Outlook (If Applicable)
[If it's a feature limitation, explain if there are plans to support it]

## 4. Issue Reply

> Content for directly replying to the Issue, written in English, professional and friendly

```
Thank you for raising this issue!

[Problem acknowledgment and empathy]

[Explanation of the cause]

[Solution]

[Example code, if applicable]

[Closing remarks]
```
```

---

## Reply Principles

### ✅ Good Replies
- First confirm understanding of the user's problem
- Clearly explain the cause without overly technical jargon
- Provide solutions that can be used directly
- Include code examples (if applicable)
- Professional and friendly tone

### ❌ Avoid
- Directly saying "this is not a bug" without explanation
- Only giving links without explanation
- Using a blaming tone
- Being too brief or dismissive

---

## Example Reply Templates

### Configuration Error Type

```
Thank you for raising this issue!

I've investigated this and found that the issue is related to the configuration. 
The `xxx` attribute requires [specific requirement].

Here's the corrected configuration:

\`\`\`hcl
resource "azurerm_xxx" "example" {
  name = "example"
  xxx  = "correct_value"  # This should be...
}
\`\`\`

Please let me know if this resolves your issue!
```

### Expected Behavior Type

```
Thank you for raising this issue!

This is actually the expected behavior. The reason is [explain reason].

If you need [what the user wants], you can use [alternative approach]:

\`\`\`hcl
# Alternative approach
...
\`\`\`

I hope this helps clarify the behavior. Feel free to ask if you have any questions!
```

### Version Upgrade Required Type

```
Thank you for raising this issue!

This issue was fixed in version X.Y.Z (PR #xxxx). 

To resolve this, please upgrade your provider version:

\`\`\`hcl
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= X.Y.Z"
    }
  }
}
\`\`\`

Let me know if you encounter any issues after upgrading!
```

````
