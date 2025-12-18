# Release Notes

Each release tag `vX.Y.Z` MUST have a matching release notes file:

- `releases/vX.Y.Z.md`
- Contains both `## English` and `## 中文`

Scaffold a draft from git history:

```bash
node scripts/generate-release-notes.mjs vX.Y.Z vA.B.C > releases/vX.Y.Z.md
```

Then rewrite the draft into a user-facing bilingual note before tagging.
