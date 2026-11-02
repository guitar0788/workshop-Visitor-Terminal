# Accessibility and keyboard interaction (v0.6 draft)

Workshop Studio's v0.6 editor is designed to remain usable with keyboard, touch and assistive technology while keeping the illustrated artwork unchanged.

## Current support

- **Named controls:** buttons expose visible text or an accessible label; inputs and selects are associated with labels. The card picker, layer tools and precision controls are exposed as named groups.
- **Focus visibility:** keyboard focus is visibly outlined on buttons, links, inputs, selects, import controls and the mobile sheet heading.
- **Mobile sheet focus:** opening Layers, Properties or Export moves focus to the sheet heading so Tab proceeds into the sheet controls. Closing the sheet returns focus to the Preview navigation button. Switching to the already-open tab moves focus back to its heading.
- **Keyboard layer movement:** select a layer and use the arrow keys to move one pixel; hold Shift to move ten pixels. Precision buttons move five pixels per action. Each committed move remains undoable.
- **Reduced motion:** users who request reduced motion receive minimal transition and animation duration and automatic scroll behavior.
- **Touch safety:** tapping a layer selects it; touch dragging requires the explicit Move layers mode so normal page scrolling is preserved.

## Verification

The real 390px Chrome mobile integration test checks:
- mobile sheet focus entry, close-and-return focus, and the sheet's accessible heading relationship;
- accessible names for buttons and associated labels for form controls;
- named group roles for the card picker and layer tools;
- text alignment, geometry constraints, invalid JSON import preservation, and autosave failure warnings.

The standard CI also runs the shared model, JSON, local-draft and Worker test suites, plus the six-card SVG visual audit.

## Scope and limitations

These checks are automated Chrome regression tests, not a claim of complete WCAG conformance or a substitute for testing with VoiceOver, TalkBack, NVDA, JAWS and browser/OS combinations. The mobile sheet is a non-modal editor region, not a dialog: focus moves into it and returns on close, but it does not trap focus. No screen-reader announcement behavior outside the tested DOM semantics is claimed.
