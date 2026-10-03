---
name: build-interactive-diagrams
description: Build reusable native draw.io interactive architecture or process diagrams from project evidence, with nested node documentation, explicit normal/failure/wait branches, local playback, and construction handoffs. Use for a navigable diagram plus a testable explanation of behavior, not for deploying a real workflow service.
---

# Build interactive diagrams

Turn the user's actual project into one local, self-contained diagram workspace. Reuse the bundled native draw.io renderer, architectural C-style cards, hierarchy, drag/pan/zoom and live detail projection. Do not replace it with a screenshot, a bare SVG graph, or a fixed demo.

## Establish the model

Read the project sources and requirements that the user authorized. Identify components, real parent/child ownership, inputs/outputs, state changes, permissions, normal paths, failure/retry/exhaustion and human waits. Distinguish observed implementation from assumptions. Ask only for consequential missing decisions; label unresolved construction details instead of inventing them.

Create a project-specific JSON spec outside this skill folder. The skill may be mounted read-only. See [references/contract.md](references/contract.md) for exact execution semantics and [references/spec.schema.json](references/spec.schema.json) for shape. Inspect one of [examples/greenhouse.json](examples/greenhouse.json) or [examples/release-pipeline.json](examples/release-pipeline.json) only for syntax. Their policies and labels are examples, not defaults for another project.

- Preserve authored nested node documentation. A container organizes real children and never hides a compound operation behind one execution step
- Control edges connect executable nodes. `kind: data` is a nonexecuting dependency. Guards must encode the actual branch; do not hardcode a scenario-specific route list
- Normal/failure/wait are input modes, not automatically inserted behavior. Supply meaningful paths and acceptance cases for every advertised mode, including wait approval and rejection
- Use the small declarative action set for local state simulation. Project code, services and prose contracts are not automatically executed
- Put rules, permission boundaries, implementation guidance and acceptance evidence in node docs; `docs.tests` is prose, while `acceptance` is executable

## Compose a clear visual explanation

Use [references/visual-language.md](references/visual-language.md) for presentation constraints. Preserve the bundled native model, execution core, schema and contract; author project behavior in the spec. The renderer tries official horizontal and vertical layouts within each real container, then packs the actual top-level rectangles. It is a deterministic box-fit heuristic, not a crossing-minimization or arbitrary-scale guarantee.

Keep L1/L2 on the main canvas, L3 in the live corner projection, and deeper levels available on click. Current nodes and the last actual edge have thin cyan outlines, near-white cores and a bounded static halo; completed paths stay subdued green. The short explanation reflects the current runtime snapshot and observed trace, without invented traffic, timelines, progress percentages or outcomes.

Header, toolbar, explanation, inspector and local view hide independently. Keep restore controls reachable; focus mode restores prior choices. With the inspector hidden, move the original run/approval controls into the dock, never clone IDs, handlers, timers or simulation state. Keep Fit accessible, restore local detail at the latest real step, and preserve playback and camera during pane changes.

## Build and verify

Find this skill's actual directory from the loaded skill location; resolve helper paths from there, never from a particular home directory. Python 3.10+ is needed for validation/build/local serving; Node.js 18+ for deterministic execution tests. No npm/pip packages or network access are needed for those commands.

From the skill directory (or substitute absolute helper paths):

```sh
python3 scripts/diagram.py doctor
python3 scripts/diagram.py validate /path/to/project-spec.json
python3 scripts/diagram.py test /path/to/project-spec.json
python3 scripts/diagram.py build /path/to/project-spec.json --out /path/to/new-output
python3 scripts/diagram.py serve /path/to/new-output --port 8000
```

The output directory must be empty and outside the skill. `doctor` diagnoses; it does not install software. If Node is unavailable, validation/build can run, but disclose that runtime tests were not run. `serve` binds loopback only. Open its URL in an available authorized browser; a remote browser may not share the same localhost. Do not change networking, publish, or install tools just to work around that without suitable authorization.

Check the actual result: node labels and nesting, readable routes, native docs, repeated normal/failure/wait runs, pause/step/back, wait decisions, cancellation, restart, drag/pan/zoom, and opening/closing live detail during playback. Check independent pane switches, focus restoration, and run/approval controls with the inspector hidden. Verify that completion preserves the user's view. Run the bundled regression checks after changing the presentation or engine:

```sh
node tests/runtime.test.js
python3 tests/package.test.py
python3 tests/presentation.test.py
node tests/layout-stress.test.js
```

Do not claim visual verification if a browser is unavailable. Report static/runtime checks separately. Large or dense diagrams need their own visual review; the included examples are not proof of all possible projects.

## Deliver

Deliver the generated workspace and its `construction.zip` when appropriate, not this skill's test artifacts. It includes the exact blueprint, native diagram, node index, schema, execution contract, acceptance cases and file hashes. All runtime assets and third-party notices remain local and relative. The built-in export button saves the current native layout with the original spec; it does not persist a simulation session.

This is one portable skill directory usable by hosts that load SKILL.md and allow local command execution. See [references/使用说明.md](references/使用说明.md) for Chinese usage and host caveats. Do not assert it was installed, invoked, or verified inside Codex/Hermes unless that actually happened.
