# TRACE

**Local BOM stock tracking and assembly planning for JLCPCB.** Version 0.1.0.

TRACE helps PCB designers follow component availability from schematic design to an assembly order. Import a BOM, check whether parts cover your intended batch, review Basic/Extended classifications and Economic/Standard assembly eligibility, and track changes as your design develops.

Built for hobby projects and small production batches, TRACE requires no account, JLCPCB sign-in, AI subscription or API key. Projects stay on your computer; internet access retrieves public JLCPCB component information. TRACE is an independent community tool, unaffiliated with JLCPCB. Final component matching, availability and quotes must be checked on JLCPCB.

## Quick start

### Requirements

- Node.js **22.12 or newer**, including npm. Tested with Node.js 24.
- A modern browser with IndexedDB and Web Locks support.
- Internet for initial dependency installation and supplier refreshes.

The launcher workflow is tested on Windows. Other operating systems can use the npm commands below, but have not received equivalent platform testing.

### Start on Windows

1. Download or clone the project and extract it into a folder if necessary.
2. Double-click **TRACE.cmd** in that folder.
3. On first use, the launcher installs locked dependencies. It builds the app when compiled files are missing or outdated.
4. Your browser opens **[http://localhost:3000/](http://localhost:3000/)**.

The local server runs in the background. Running TRACE.cmd again reuses a matching running release. If an older development server occupies port 3000, stop it in its original terminal with Ctrl+C, then launch TRACE again.

**To stop:** click **Stop TRACE** below Preferences in the sidebar and confirm. TRACE saves your workspace before stopping its local server, then shows a stopped screen. You can close that tab. If a parts refresh is running, wait for it to finish first. This stops the server for all TRACE tabs; your saved projects stay in their browser profiles. Double-click **TRACE.cmd** to start again.

**Stop-TRACE.cmd** remains available as a fallback; finish editing and close TRACE tabs before using it. Closing the browser alone leaves the server running. Monitoring stops when the app is closed.

PowerShell users can run `./Start-Local.ps1` if their existing execution policy permits local scripts. The CMD launcher requires no policy change or administrator rights.

### Start from a terminal

From the project folder:

```sh
npm ci
npm run local
```

Stop the launcher-managed server with `npm run stop`.

For a foreground production server, use `npm run build` followed by `npm start`; use the browser's **Stop TRACE** button or Ctrl+C in that terminal to stop it.

## Everyday workflow

1. **Create or open a project.** Give each PCB design its own project.
2. **Import its BOM.** Use Excel, CSV or TSV, review the detected columns, then import. Descriptions, stock and prices load automatically.
3. **Set the assembly quantity.** New runs start at two boards. Choose a preset or a custom whole number. Configure panel quantities when relevant.
4. **Review the components.** Check shortages, unknown/stale observations, library classification, service eligibility and identity warnings. Record parts you will assemble yourself or mark them DNP.
5. **Review Build & cost.** Choose the assembly service and inspect estimate assumptions. TRACE offers an explicit switch when known Standard-only parts conflict with Economic assembly.
6. **Update during design.** Reimport the changed BOM into the same project. Notes and assembly choices follow designators through regrouping. The previous BOM is saved as a revision by default; ambiguous matches require review and an automatic revision.
7. **Before ordering, refresh again.** Resolve outstanding checks, export the JLCPCB BOM and review JLCPCB's final matching and quote. Supply your placement/CPL file separately.
8. **Export backups periodically.** Automatic browser saving and an external JSON backup serve different purposes.

Use the **same browser, profile and localhost address** regularly. `localhost:3000`, `127.0.0.1:3000` and another port have separate browser storage. An apparently empty workspace at a different address does not mean the original data was deleted.

## Features

### Component availability and review

- Stock, per-board quantities, batch requirements, shortages, limiting parts and estimated build capacity.
- Aggregated demand when multiple BOM rows use the same C-number.
- Available supplier minimum/loss metadata for Standard and Economic Extended parts; Economic Basic parts use placement quantities. Manual rules can override estimates.
- Separate library classification and assembly eligibility: Extended does not automatically mean Standard-only.
- Combined stock, library, service, population and review filters, plus search, sorting and grouping. Filters affect the list, not full-BOM calculations.
- Stock/price history and refresh summaries of library, service, coverage and purchase-requirement changes.
- Review prompts for supplied MPN differences and recognizable package-size or pin-count differences. Acknowledgements apply to the exact identity comparison; changed identities reopen review.
- Circuit notes, critical-part flags, tags, manual corrections and manually recorded alternatives with validation status.

Identity checks do not verify electrical compatibility, pinout, rotation or land patterns. Unfamiliar or metric-only package names may need manual checking. TRACE does not automatically choose replacements.

### Planning tools

| Tool                | Purpose                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Components**      | Inspect the BOM, filter parts, refresh supplier data and edit circuit details.                                                              |
| **Build & cost**    | Configure quantity, service, panel basis, purchase allowances and estimate assumptions.                                                     |
| **Scenarios**       | Save build configurations and compare batches. Mark intended builds Planned for combined demand. Pin a revision to retain a particular BOM. |
| **Revisions**       | Freeze snapshots and compare them with the working design using saved or current assumptions.                                               |
| **Workspace tools** | View combined planned demand, manually track owned/incoming stock and inspect activity.                                                     |

Owned inventory is recorded manually. Bench stock is distinct from JLCPCB private/consigned stock; recording a lot does not reserve inventory or arrange consignment. Completed builds do not automatically infer stock consumption: reconcile inventory yourself.

### Cost estimates

The active estimate includes known component purchase costs, setup, stencil, applicable loading fees and known component-specific special processing fees. Pricing profiles are dated and editable.

PCB fabrication and board services are excluded. X-ray, packaging and SMT solder-joint fees are also excluded from automatic calculation. Shipping, tax and other costs are not automatically quoted; manually entered additions remain explicit.

Cost basis can cover the full BOM or only parts selected in a JLCPCB quote. Excluding a part from quote costing does **not** remove it from the BOM export or hide its full-BOM shortage. Through-hole loading and unexposed loading exemptions can differ from a quote; a quoted loading-total override is available.

Stock is a snapshot, not a reservation. Quantities, prices and eligibility can change. Verify unknown, stale and provisional values before ordering.

## BOM import and export

Supported inputs: `.xlsx`, `.csv`, `.tsv` and `.txt`, with local column mapping. Excel imports offer worksheet selection. Convert older `.xls` files to `.xlsx` first. Files must be smaller than 5 MB; selected Excel sheets support up to 10,000 populated rows and 100 columns.

Typical columns: designators, quantity, LCSC/JLCPCB C-number, value/comment, footprint, MPN, description and DNP. Unresolved and out-of-stock rows remain visible. `Name` can supply the value when Value/Comment is absent. An explicit DNP column takes precedence over an exact `DNP` value.

Example CSV:

```csv
Designator,Quantity,LCSC Part,Value,Footprint
"R1,R2",2,C25804,10k,R0603
C1,1,C14663,100nF,C0603
```

| Export           | Contents and use                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analysis CSV** | All current BOM rows with stock, demand, prices and review fields, regardless of list filters. Shared C-number aggregate fields may repeat across rows; do not sum them blindly. |
| **JLCPCB BOM**   | Validated Comment, Designator, Footprint and LCSC part-number columns. DNP and manual-assembly rows are excluded. Does not include CPL data or submit an order.                  |
| **Backup**       | Portable JSON of the whole workspace: projects, revisions, observations, settings and inventory.                                                                                 |

## Saving, backups and recovery

Data saves automatically in the browser's **IndexedDB**. The sidebar shows save status and last backup export. Only one editing tab is allowed per origin. Additional tabs cannot load or modify the workspace; close the editor and choose **Try again** in the other tab to load the latest saved data.

TRACE reminds you to export a backup weekly, with a one-day snooze. An export date records the download request; check that the JSON file was actually saved. Export before clearing browser data, moving browsers/computers or updating TRACE.

**Restore** validates a backup and can merge projects as separate copies or replace the workspace. Existing data is preserved locally before restoration. A once-per-release snapshot is available through **Preferences → Update recovery**. It lives in the same browser and cannot protect against browser-data deletion.

Local editing and cached calculations work offline while the server runs. Refreshes require internet; failed requests retain cached observations. Polling runs only while the app is open. There are no email alerts or closed-app monitoring services.

## Updates and troubleshooting

Before updating: export and check a backup, wait for **Saved in this browser**, close all TRACE tabs and stop the server. Extract the new release and start TRACE.cmd. Use the same browser/profile and localhost address. Check your projects before discarding the previous release. Keep an external backup for rollback: future migrations may not be readable by older versions.

- **Port 3000 busy:** stop the older TRACE session or conflicting application. The launcher does not switch ports or stop unrelated processes.
- **Another-tab message:** use the existing editor, or close it and retry here.
- **Projects appear missing:** check the browser profile and exact address, or restore a backup.
- **Lookup fails:** use cached data and retry when connected. The public supplier endpoint is undocumented and may change.
- **Startup fails:** read the launcher message and `.trace-runtime/server.log`.

## Development and contributing

TRACE uses React, TypeScript, Vite, Express and IndexedDB. No AI model is needed at runtime.

```sh
npm ci
npm run dev
```

Development mode runs in the foreground at the same address; stop the compiled release first. Source-project checks:

```sh
npm test
npm run lint
npm run format:check
npm run build
npm run smoke:release
```

The production smoke test uses a temporary loopback port, leaves the normal workspace alone and needs no supplier connection. `node scripts/check-local.cjs` checks a running server and a live supplier lookup; it requires internet.

- `src/core/`: parsing, calculations, storage, supplier handling and regression tests.
- `src/components/`: interface panels and dialogs.
- `server.ts`: local app server and public component-lookup proxy, listening on loopback only.
- `scripts/`: launch, build, verification and packaging tools.

Regression tests use synthetic BOMs and minimal public component metadata, not personal project files.

For a runtime ZIP, build first, then run `./scripts/package-local.ps1` in PowerShell. Packages exclude tests, test fixtures, browser data, runtime logs and development backups. The full test suite belongs to the source project; installed runtime packages can run `npm run smoke:release`.

For bug reports, include the app version, browser, assembly mode, intended quantity and a small anonymized BOM that reproduces the issue. For cost discrepancies, include the equivalent JLCPCB quote lines. Add tests appropriate to changes when contributing.

## License

TRACE is open source under the [MIT License](LICENSE), copyright 2026 Yafet Daniel. You may use, modify and redistribute it, including commercially, while retaining the copyright and license notice. Third-party dependencies and supplier data retain their own terms.
