# Security

## Reporting a vulnerability
Please report it in private, not in a public issue:
[Report a vulnerability](https://github.com/mrtinotano/Exilewright/security/advisories/new) (the repository's Security tab).

Only the latest release is supported: a fix goes into the next one.

## Getting Exilewright
- The only official download is this repository's [Releases](https://github.com/mrtinotano/Exilewright/releases/latest)
  page. The app updates itself from there and from nowhere else.
- The installer is not signed yet, so Windows cannot tell it from a copy somebody else made. Do not install an
  "Exilewright" from another site.
- The release page shows the SHA-256 of the installer, to check a download against.

## What the app does on your computer
- Its page is served by a small server of its own that listens on your computer only (`127.0.0.1`) and answers only
  that page: other sites open in a browser are refused.
- The page runs no code but the app's own (a Content-Security-Policy): a build, a shared code or a listing from outside
  is data, never code.
- It writes only its own data (`%LOCALAPPDATA%\Exilewright`) and the files you ask for: a loot filter, its sounds and a
  build for the game's planner in the game's folder (`Documents\My Games\Path of Exile 2`), and an exported build in
  Downloads.
- It never asks for your Path of Exile account, password or session. What goes out, and when, is listed under
  [Privacy](README.md#privacy).
