## What kind of change does this PR introduce?

Bug fix, feature, docs update, ...

## What is the current behavior?

Please link any relevant issues here.

## What is the new behavior?

Feel free to include screenshots if it includes visual changes.

## How to Review

<!--
A reviewer should understand what this PR does within 15-30 seconds, then know where to start reading.

Non-trivial or multi-file PRs must fill in the reading path below. Trivial single-file changes may delete this section when the review path is obvious.

- Start from the main public entrypoint or request handler, and follow the actual execution path before reading tests.
- Use bold numbered areas, each with one or two indented bullets: the exact files, then what to inspect.
- Use exact repository-relative paths, and avoid line numbers while the branch is still changing.
- Prefer project-facing language such as `interface`, `extension point`, or `contract` over internal design jargon.
- Don't repeat the PR purpose or the verification commands here. Keep the section scannable.
-->

1. **Review area**
   - `path/to/main-entrypoint.ts`
   - What to follow or verify.

2. **Next review area**
   - `path/to/next-file.ts`
   - What to follow or verify.

3. **Tests**
   - Exact test files
   - Which observable contracts they protect.

**Review questions**

<!-- Four to six short questions covering the reviewer's judgment calls. -->

- [ ] Is the public contract minimal and intentional?
- [ ] Do the main execution paths preserve existing behavior?
- [ ] Do failures stop safely?
- [ ] Do tests protect observable behavior rather than implementation details?

## Verification

How you verified the change. Include the steps and evidence (commands, test output, screenshots). AI-assisted contributions are welcome, but a human must review and verify the output.

## Additional context

Add any other context or screenshots.
