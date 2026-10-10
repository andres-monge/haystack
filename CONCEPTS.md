# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Generation

### Scenario
The time, daylight, weather, and celestial conditions that describe the moment Haystack should depict.

### Render
A generated image together with the metadata that identifies its source artwork, Scenario, prompt, model, creation time, and any available response details.

## Display delivery

### Kiosk
The always-on display client that presents Haystack's newest Render while the generation engine and stored outputs remain on the Mac.

A Kiosk preserves its currently visible Render during delivery failures and checks again for a newer one, so a stale display does not by itself mean generation stopped.


## Daily stories

### Daily Story
A complete standalone plot for one local date and frozen artwork fingerprint, with stable cast identities and one complete visible scene per active-hour slot.

### Story Scene
The cumulative visible state and current action at a planned hour, naming only characters present in that frame. A scene remains understandable after missed hours.

### D Continuity
Ordered references consisting of the canonical original followed by the preceding successful Render from the same Daily Story. The first successful Render uses the original alone.

### Ready Story
A validated story committed atomically with its frozen original. Failed or interrupted preparation is not ready and requires an explicit retry.

### Daily Trailer
The one-sentence spoiler-free Spanish introduction exported after story commit through the dated public `Haystack/TV Today.md` handoff.
