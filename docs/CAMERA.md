# CAMERA CAPTURE — Phase 4

> **NOT SANCTIONED. DO NOT BUILD.**
>
> This document exists so the idea is recorded, not because the work is queued.
> No scaffolding, no dependencies, no camera permissions in the manifest, no
> "quick spike". Requires explicit written approval from the owner referencing
> this line.

## Why it is deferred

Roughly the size of Phases 1–3 combined, and the hard parts cannot be tested from
the repo. It depends on physical conditions — bar lighting, viewing angle, the
specific plastic finish of one Connect 4 set, reflections off the frame — that only
reveal themselves in situ. Every hour spent on it is an hour not spent on a solver
that works today.

It is also the most fun part of the project, which is exactly why it will pull effort
away from Phase 1 if left unguarded.

## Shape, if approved

**Input.** `getUserMedia`, rear camera, live preview with a fixed 7×6 alignment
overlay. The user aligns the board to the overlay rather than the software solving
arbitrary perspective. This trades a small amount of convenience for an enormous
reduction in difficulty and should not be negotiated away.

**Detection pipeline.**
1. Sample a small disc-shaped region at the centre of each of the 42 overlay cells.
2. Convert to HSV. Hue separates red from yellow far more robustly than RGB under
   warm artificial light.
3. Classify each cell: red, yellow, or empty. Empty cells read as the dark frame or
   as whatever is behind the board.
4. Validate against gravity and disc-count rules before accepting.
5. Require the same reading on three consecutive frames before committing, to
   suppress flicker.

**Calibration.** A one-time step where the user photographs the empty board and then
one disc of each colour, storing the sampled hue ranges. Without this, thresholds
tuned in one venue fail in the next.

**Failure handling.** When confidence is low, fall back to the Setup mode board with
the detected position pre-filled for manual correction. Never silently accept an
uncertain reading — a wrong board produces a confidently wrong analysis, which is
worse than no analysis.

## Dependencies

OpenCV.js is the obvious choice and is heavy (several MB of WASM). Lazy-load it only
when camera mode is opened; it must never affect the load time of the core tool.

Evaluate whether plain canvas pixel sampling suffices first. With a fixed alignment
overlay, the geometry problem largely disappears and the remaining work is colour
thresholding, which does not need OpenCV. Prefer the lighter path.

## Gate, if ever started

1. Correctly reads 20 out of 20 boards under three distinct lighting conditions.
2. Misreads always fall back to manual correction, never to silent acceptance.
3. Core tool load time unchanged when camera mode is not opened.
