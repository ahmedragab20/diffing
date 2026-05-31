---
"diffing": patch
---

Load user-selected fonts as web fonts so custom font picks actually render

Previously only the two built-in defaults (Geist Mono / JetBrains Mono) were fetched from Google Fonts, and only when they were _not_ overridden. Selecting any other font therefore named it in CSS but never loaded a matching font face, so it silently fell back to system monospace — most visibly in code diffs. The font picker now always requests the chosen UI and mono families from Google Fonts (the request degrades gracefully: families Google does not host are dropped server-side without breaking the valid ones).

Note: a locally-installed font that isn't hosted on Google Fonts (e.g. a Nerd Font, or a commercial font like Dank Mono) is applied by name and renders only if the browser lets pages use local fonts. Privacy browsers such as Brave block uncommon local fonts via fingerprinting protection, in which case the font falls back regardless — pick a Google-hosted family, or allow fingerprinting for the site in Brave's Shields.
