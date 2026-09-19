# NaN Usage for Ulanzi D200

Displays the remaining token quota for up to three nan.builders subscription models on a 196×196 D200 key. A key press refreshes immediately; active configured keys also refresh every five minutes.

**Author:** Santiago Pérez

## Install and configure

1. Install Node.js 20 or newer.
2. Run `npm run check`, `npm test`, `npm run build`, and `npm run package`.
3. Import `com.ulanzi.nanusage.ulanziPlugin/package/com.ulanzi.nanusage.ulanziPlugin.zip` into UlanziStudio.
4. Add **NaN Usage** to a D200 key.
5. Enter a NaN API key in the Property Inspector password field.
6. Select up to three models, or leave the selection empty to show the top three models by consumption.

The key requires Ulanzi D200 hardware and Ulanzi Studio 2.1.4 or later. It reads quota data from `GET https://cloud-api.nan.builders/api/usage/quota` with the configured API key sent as a Bearer token.

## Display

The key shows up to three models. Each row contains the model name, the remaining percentage, and a full-width bar for the remaining quota. Checked models render in the order listed by the Property Inspector; if fewer than three models are checked, the remaining rows are filled automatically from the models with the highest token consumption.

A warning background is used when any displayed model reaches 10% remaining quota or below. Compact states cover a missing API key, authentication and permission errors, rate limiting, timeout, network failure, malformed responses, and unavailable quota data. Press the key to retry.

## Security and API caveats

`cloud-api.nan.builders/api/usage/quota` is an undocumented internal NaN endpoint and may change or disappear without notice. Response normalization is isolated so endpoint changes degrade to an unavailable state instead of crashing the key.

The API key is stored by UlanziStudio with the host-managed per-key settings; this plugin cannot guarantee that host storage is encrypted. The Property Inspector masks the input. The runtime sends the key only to `cloud-api.nan.builders` in the `Authorization` header. The API key is never logged and is never shipped in `dist/` or `package/`.

## Development commands

- `npm run check` validates package metadata, manifest identity, required package files, store metadata, source syntax, and template-residue rules.
- `npm test` runs the Node.js behavior tests.
- `npm run build` copies `src/plugin/` into the plugin `dist/` folder and regenerates the PNG assets.
- `npm run package` runs check, tests, build, and creates the importable ZIP.

## Package ZIP install flow

After `npm run package`, open UlanziStudio and import `com.ulanzi.nanusage.ulanziPlugin/package/com.ulanzi.nanusage.ulanziPlugin.zip`. Add **NaN Usage** to a D200 key, configure the API key and optional model selection in the Property Inspector, then press the key to force an immediate refresh.
