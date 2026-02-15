<!-- Scratchpad: informal ideas, observations, and session notes. Not a spec or plan — just quick thoughts jotted down while working. Agents: do not treat this as a task list or actionable document. -->

fix system prompt lives in 2 locations: There it is — a duplicate in App.tsx:17-30. The comment even says "keep in sync with server-side template" but it wasn't updated.
- add an option to manually add or replace the prompt so you can change what you're seeing from the sofa