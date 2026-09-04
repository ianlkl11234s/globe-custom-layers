# Contributing

## The one rule that matters

**Do not claim more than you have verified.** Every recipe carries a status marker, and the difference between them is not a formality:

| Mark | You may use it when |
|---|---|
| ✅ **Verified** | It runs in production somewhere *and* it is reproduced in an example in this repo |
| 🔬 **Reproduced** | It is reproduced in an example in this repo |
| 📋 **Reported** | It runs in production somewhere; nobody has reproduced it here yet |
| ⚠️ **Unverified** | It is reasoned from source or typings and has not been run |

A page marked ⚠️ that is honest about being untested is more useful than a page marked ✅ that is wrong. If you cannot tell which mark applies, use the lower one.

Corollaries:

- **No invented numbers.** If you did not measure the frame time, do not write a frame time. "Noticeably faster" is an acceptable sentence; "3.2× faster" without a measurement is not.
- **Quote the source when the source is surprising.** Claims about what a library does should point at its docs, typings, or source, with a link or a file and symbol name.
- **Say which versions you ran.** `mapbox-gl` and `maplibre-gl` both move, and several recipes here rest on behaviour that is not part of a public contract.

## Correcting a page

If a recipe contradicts what you observe, the recipe is the thing that is wrong. Open an issue with:

- the library and version
- what you did
- what you saw, versus what the page said you would see

A reproduction is welcome but not required. "This page is wrong and here is why I think so" is a useful issue.

## Adding a recipe

A recipe earns a page when it meets all three:

1. **The symptom is confusing.** If the error message tells you what to do, the error message is the documentation.
2. **The cause is not in the official docs.** Check first. Linking to an existing official page beats rewriting it.
3. **The fix is not obvious once you know the cause.** Some bugs need one sentence, not one page — those belong as a note inside a related recipe.

Structure follows the existing pages: symptom, cause, steps, the trap that costs the most time, source, next. That order exists because it is the order a reader arrives in — they have the symptom, not the cause.

## Adding an example

- Self-contained. Its own `package.json`, its own `node_modules`, no imports outside its folder. Duplicated code between examples is fine and expected.
- Dependencies limited to the map library, `three`, `vite`, `typescript`, and `vitest`. No UI frameworks — the example is about the rendering, and a reader should not have to know your framework to read it.
- Comment the *why*, especially at anything counter-intuitive. Production code explains what it does; a teaching example explains why it is not the obvious thing.
- **No tokens, no private data, ever.** Read tokens from `import.meta.env`, ship a `.env.example`, and show a friendly message when the token is missing instead of crashing.
- Sample data must be public domain or generated at runtime. Label synthetic values as synthetic.
- `npx tsc --noEmit`, `npx vitest run` and `npm run build` must all pass before you open the PR.

## Style

- English, for the same reason the code is: reach.
- Second person, present tense. "You zoom out" beats "the user zooms out".
- No marketing. The reader arrived with a bug; they are not an audience.
