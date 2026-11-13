# Bundled fonts

Kerf loads two variable families so the interface renders consistently offline.
Both are licensed under the SIL Open Font License 1.1, with licenses beside the binaries.

| Family          | Role                             | Source                                            |
| --------------- | -------------------------------- | ------------------------------------------------- |
| Instrument Sans | Interface, headings and wordmark | https://fonts.google.com/specimen/Instrument+Sans |
| JetBrains Mono  | Timecode and data                | https://fonts.google.com/specimen/JetBrains+Mono  |

Only the Latin subset is bundled. Other glyphs use the system sans-serif or
monospace fallbacks declared in `tailwind.css`. The retained Fraunces font asset
is no longer loaded by the app.
