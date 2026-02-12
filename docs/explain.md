Provide a beginner-friendly explanation that includes:

### What We're Building
Explain in simple terms what this subtask accomplishes and why it matters for the overall app.

### How It Fits In
Describe how this piece connects to the rest of the app architecture. Reference specific files or components if relevant.

### Key Concepts
If this subtask involves concepts the user might not be familiar with (e.g., RLS policies, OAuth flows, RPC functions), briefly explain them.

### What I Plan To Do
Summarize the implementation approach based on the TaskMaster `details` field.

### Key Gotchas and Risks
Identify potential pitfalls, edge cases, or tricky parts of this subtask

### Clarifying Questions (If Needed)
If you are unclear about anything, making assumptions, or the task details are ambiguous:
- Ask specific clarifying questions before proceeding
- For each question, provide your recommendation on what you think we should do
- Wait for the my decision before continuing

Example:
> "The task mentions 'user_hash' but doesn't specify where SERVER_SALT comes from.
> **My recommendation**: Store it as an environment variable in `.env.local`.
> Do you agree, or would you prefer a different approach?"

**Wait for user approval before proceeding to implementation.**