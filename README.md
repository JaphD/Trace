# TRACE

**Local BOM stock tracking and assembly planning for JLCPCB.**

For hobbyists and small-batch PCB designers: check component availability, Basic/Extended library status, Economic/Standard eligibility and estimated assembly costs throughout design. No account, JLCPCB sign-in, AI subscription or API key required. TRACE is independent of JLCPCB and does not place orders.

## Start and stop

Requires **Node.js 22.12+**, npm and a modern desktop browser with IndexedDB and Web Locks. Tested on Windows with Edge. Current Chrome, Firefox and Safari are expected to work but have not received equivalent testing. Internet is needed for installation and supplier refreshes. The server accepts connections only from the computer running TRACE; phone access is not supported by this setup.

1. Download or clone this repository and extract it if needed.
2. Double-click **TRACE.cmd**. It installs dependencies, builds when needed and opens [localhost:3000](http://localhost:3000/).
3. To finish, wait for refreshes, click **Stop TRACE** in the top-right header and confirm. This saves your workspace and stops the server for all TRACE tabs. Run **TRACE.cmd** to restart.

Closing the browser alone leaves the server running. **Stop-TRACE.cmd** is a fallback; finish editing and wait for the saved status first.

For desktop access, create a **shortcut to TRACE.cmd**. Keep the original file inside the project folder with its supporting files.

Terminal alternative: run `npm ci`, then `npm run local`; stop with `npm run stop`.

## Workflow and tools

Create a project → import and review the BOM → set the batch quantity (minimum two) → resolve shortages and identity warnings → review costs → refresh before ordering and export. Reimport design updates into the same project, and mark DNP or manually assembled parts explicitly.

The top-right header keeps **Stop TRACE** and the **Light/Dark switch** accessible while scrolling. Light is the default; your theme choice is saved in this browser.

| Tool                | Purpose                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Components**      | Stock, descriptions, prices, history and identity checks; filters for stock, library, service, population and review status. Includes notes, critical-part flags and recorded alternatives. |
| **Build & cost**    | Quantity, service, purchase allowances and editable pricing assumptions. Offers a switch when known Standard-only parts conflict with Economic assembly.                                    |
| **Scenarios**       | Compare saved build configurations and combine planned demand.                                                                                                                              |
| **Revisions**       | Save BOM snapshots and compare design changes.                                                                                                                                              |
| **Workspace tools** | Planned demand, activity and manually tracked owned/incoming inventory.                                                                                                                     |

Repeated C-number demand is combined using available supplier purchase/loss metadata. Filters do not change full-BOM calculations. Inventory entries neither reserve supplier stock nor automatically deduct completed builds.

**Covered** means observed stock meets the build requirement; **Covered · provisional** means quantity allowances still need verification. **Short X** includes required purchase/loss allowances. Library filters distinguish Basic, Extended, **Extended (Preferred)** and unknown classifications.

Save a build with **Scenarios → Save as new scenario**; use **Copy to build editor** to revisit it. Use **Revisions → Freeze current BOM** before design changes, then compare against the working BOM. Reimport preserves notes and assembly choices by designator, separating rows when needed.

Each scenario has **Delete scenario**. Select a frozen BOM to use **Delete revision**; unpin it from any builds first. **Workspace tools → Delete all projects** clears projects after confirmation and releases their inventory allocations while keeping owned inventory and settings.

## Import and export

Import **.xlsx, .csv, .tsv or .txt** with column mapping and Excel worksheet selection. Convert `.xls` to `.xlsx`. Limit: files under 5 MB; Excel sheets up to 10,000 populated rows and 100 columns.

Typical columns: designators, quantity, LCSC/JLCPCB C-number, value/comment, footprint, MPN, description and DNP. Unresolved and out-of-stock rows remain visible.

- **Analysis CSV:** all BOM rows with stock, demand, prices and review fields, regardless of filters. Shared C-number totals can repeat; do not sum them blindly.
- **JLCPCB BOM:** Comment, Designator, Footprint and LCSC part-number columns, excluding DNP and manual-assembly rows. Supply your **CPL/placement file separately**.
- **Backup:** portable workspace JSON, including projects, revisions, observations, settings and inventory.

## Estimate limits

Includes known component purchase costs, setup, stencil, applicable loading and component-specific processing fees. **Excludes automatic calculation of PCB fabrication, board services, X-ray, packaging, SMT solder-joint fees, hand-soldering labor, manual assembly, nitrogen reflow, shipping and tax.** Add costs manually as needed. Through-hole parts have no automatic feeder charge; supplier exemptions missing from public data can still cause differences. Use the loading-total override to match a verified quote.

Review rates in **Preferences → Assembly pricing profile**. Existing saved profiles are preserved across updates and may differ from current quote rates.

Costing can cover the full BOM or selected quote parts. Excluding a part from costing does not remove it from exports or hide its full-BOM shortage.

Stock is a snapshot, not a reservation; prices and eligibility can change. Identity checks do not verify electrical compatibility, pinout, rotation or land patterns. Alternatives are not automatically selected. **Verify matching, availability and the final quote on JLCPCB.**

## Data, backups and updates

Projects save automatically in browser **IndexedDB**, not the Git repository or GitHub. Always use the **same browser, profile and address**: `localhost:3000`, `127.0.0.1:3000` and different ports have separate storage. Only one tab can edit a workspace at a time.

**Keep external JSON backups.** Backup exports the whole workspace. Clearing browser data can delete projects. Restore can merge projects as copies or replace the workspace. Use a backup to move projects between browsers. **Preferences → Update recovery** offers a local snapshot, but cannot protect against browser-data deletion.

Before updating: export and check a backup, wait for the saved status, stop TRACE and close its tabs. Update, restart at the same address and verify your projects before discarding the previous release.

Cached editing and calculations work offline while the server runs. Failed supplier requests retain cached observations. Monitoring runs only while the app is open.

## Troubleshooting

- **Port 3000 busy:** stop the older session or conflicting app; TRACE does not stop unrelated processes or switch ports.
- **Another editing tab:** close the existing editor, then choose **Try again**.
- **Missing projects:** check browser/profile/address or restore a backup.
- **Lookup fails:** retry later; the public supplier endpoint is undocumented and may change.
- **Startup fails:** check the launcher message and `.trace-runtime/server.log`.

## Development and contributions

React, TypeScript, Vite, Express and IndexedDB; the server listens on loopback only. Stop the running release, then use `npm ci` and `npm run dev`.

```sh
npm test
npm run lint
npm run format:check
npm run build
npm run smoke:release
```

Tests use synthetic BOMs. The release smoke test uses a temporary local port without supplier access. After building, `./scripts/package-local.ps1` creates a runtime ZIP.

Report bugs with the version, browser, assembly mode, quantity and a small anonymized BOM; include corresponding quote lines for pricing issues.

## License

[MIT](LICENSE) — copyright 2026 Yafet Daniel. Use, modify and redistribute with the license notice. Dependencies and supplier data retain their own terms.
