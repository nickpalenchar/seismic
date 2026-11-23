# Publish docs/site/ to seismic.im: move docs-vlatest to GitHub's main (or a commit) and push it; --force redeploys.
publish-docs *args:
    bun scripts/publish-docs.ts {{args}}
