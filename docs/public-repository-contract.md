# Public Repository Contract

Status: CURRENT  
Applicability: public source repository

## Purpose

Keep the public repository as reusable product source, not as a user instance or runtime archive.

## Allowed in Git

- source code;
- architecture and current ADRs;
- generic product documentation;
- schemas and data contracts;
- neutral defaults;
- synthetic fixtures;
- reusable tests;
- generic Source Registry and nomenclatures;
- CI/CD definitions that contain no secrets.

## Not allowed in Git

- personal profile data;
- real applications or application history;
- personal search preferences or exclusions;
- real job-search result snapshots;
- FIT/evaluation results tied to a user profile;
- runtime search state;
- run history/status from real executions;
- operational evidence that is not required to understand or reproduce the product;
- credentials, tokens, keys or secret values.

## Ownership boundary

```text
source repository
  = code + contracts + neutral seeds

runtime
  = profile data + applications + search state + operational history

persistent backend / runtime storage
  = authoritative user and operational state
```

Tracked JSON under `data/` is seed/compatibility content only. It must remain empty, neutral or synthetic and must never be used as the authoritative store for a real user's runtime state in the public source repository.

## Publication rule

A candidate public snapshot must pass:

1. repository-content sanitization;
2. removal of historical/non-product artifacts from the snapshot;
3. secret scan;
4. verification that runtime JSON is empty/neutral/synthetic;
5. verification that user-specific defaults are absent from code and product documentation.

The existing repository is sanitized in its current source tree and then changes visibility from PRIVATE to PUBLIC. Existing Git history is not rewritten solely to remove non-sensitive historical runtime/profile data. History rewrite is reserved for a confirmed credential/secret exposure that requires purge after revocation/rotation.
