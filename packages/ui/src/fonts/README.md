# Bundled fonts

Kerf ships three variable families so the interface renders identically offline.
All three are licensed under the SIL Open Font License 1.1. The license text for
each family is stored beside its binary.

| Family          | Role                 | Source                                            |
| --------------- | -------------------- | ------------------------------------------------- |
| Fraunces        | Display and headings | https://fonts.google.com/specimen/Fraunces        |
| Instrument Sans | Interface text       | https://fonts.google.com/specimen/Instrument+Sans |
| JetBrains Mono  | Timecode and data    | https://fonts.google.com/specimen/JetBrains+Mono  |

Only the Latin subset is bundled. Glyphs outside that range fall back to the
system serif, sans or monospace stack declared in `tokens.css`.
