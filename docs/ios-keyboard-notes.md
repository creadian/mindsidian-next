# iOS keyboard + viewport: what we learned the hard way (2026-07-06/07)

Field notes from the alpha.14–.19 debugging run, so nobody re-fights this
blind. All findings verified on-device (iPhone, Obsidian mobile) via the
"Action bar diagnostics" overlay (settings toggle) — turn it on, type,
screenshot the numbers.

## The core fact

**In landscape, iOS reports NO keyboard to the web layer at all.**
With the keyboard fully up, `window.innerHeight` stays full-height AND
`visualViewport.height` stays full-height (measured: win 812×375,
vv 812×375, keyboard actually covering the bottom ~40%). In portrait,
by contrast, the webview itself is resized to the keyboard top, so
container-bottom-based positioning "just works" there.

Consequences:
- Any keyboard math built on `window.innerHeight` or `visualViewport`
  alone works in portrait and silently fails in landscape.
- No amount of measure-and-correct helps if every measurable number is
  the same lie. You need a NON-web signal.

## The three signals (src/input/keyboardInsets.ts)

`KeyboardInsets.visibleBottom()` = the most conservative of:
1. `visualViewport.offsetTop + height` — honest in portrait;
2. `window.innerHeight - nativeKbHeight`, where nativeKbHeight comes
   from Capacitor's `keyboardWillShow`/`keyboardDidShow` **window
   events** (`e.keyboardHeight`) that Obsidian's mobile shell
   dispatches — the decisive signal in landscape;
3. the top of Obsidian's own `.mobile-toolbar` element, which the app
   parks directly above the keyboard when visible.

Everything keyboard-aware must go through this one tracker: the mobile
action bar AND the controller's `revealNode` (see below). Never
duplicate the logic.

## Rotation timing

`window` and `visualViewport` metrics update at DIFFERENT times during
an orientation change, and the last resize event can fire while they
still disagree. One-shot recomputation therefore freezes stale values.
Pattern used: recompute now + 150/400/900 ms ("settle burst") after
every trigger, and listen to `orientationchange` + window `resize` in
addition to visualViewport events.

## iOS scroll hijack

If a focused contenteditable sits below the (invisible-to-us) keyboard,
iOS force-scrolls the nearest scrollable ancestor — our
transform-positioned container — by writing a real `scrollTop` onto it.
That visually tears the map and fights any pan animation ("map jumps
around"). Countermeasures:
- `revealNode` clamps its usable height to `visibleBottom()` so nodes
  are never revealed into the hidden strip in the first place;
- the controller resets any scroll offset the moment it appears
  (`scroll` listener on the container; all panning is transform-based,
  so a nonzero scroll offset is ALWAYS bogus).

## Still open (parked 2026-07-07)

Adding branches in landscape with the keyboard up is STILL reported
jumpy on-device after all of the above (alpha.19). Next debugging step:
diagnostics overlay screenshot during the jump + verify the installed
version is current (a stale BRAT install produced a false negative once
— the overlay format itself tells you the version era: natKB/mtb fields
exist only from alpha.17 on).

## Debugging workflow that worked

Guessing failed twice; numbers worked immediately. The pattern:
1. Ship a diagnostics overlay behind a settings toggle (cheap, stays in
   the product);
2. have the owner screenshot it mid-bug on the real device;
3. fix against the measured values;
4. keep the overlay showing every input signal (useBot/natKB/mtb) so
   the NEXT anomaly names its own culprit.
