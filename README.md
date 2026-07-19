# SFXDock for DaVinci Resolve Studio

SFXDock is an open-source sound effects search plugin for DaVinci Resolve Studio 19+,
built as a Workflow Integration Plugin. Search multiple sound effect providers
(Freesound, Pixabay, your own local folders) from one panel inside Resolve, preview
instantly, download with license/attribution tracking, and import into your Media Pool
with one click.

**Status: early development.** The plugin skeleton runs inside Resolve (Windows);
provider search is being built. Not yet usable for real work.

## Requirements

- DaVinci Resolve **Studio** 19 or later (Workflow Integration Plugins are not
  available in the free edition, and do not exist on Linux)
- Windows or macOS (macOS support planned; currently developed on Windows)
- Your own free API keys for the providers you want to search (entered in the
  panel — SFXDock ships with no credentials and never sends requests on anyone
  else's behalf)

## Development

```
pnpm install
pnpm build        # assembles the deployable plugin/ folder
pnpm dev-install  # builds and installs into Resolve's Workflow Integration Plugins dir
pnpm typecheck
```

Node 22.x (matches the Electron 36 runtime Resolve hosts plugins in — see
`docs/phase0-audit.md` for the full environment audit). After the first install,
restart Resolve once; subsequent `pnpm dev-install` runs only need the panel to be
relaunched from Workspace > Workflow Integrations.

## License

[MIT](LICENSE). "DaVinci Resolve" is a trademark of Blackmagic Design; SFXDock is an
independent project and is not affiliated with or endorsed by Blackmagic Design.
