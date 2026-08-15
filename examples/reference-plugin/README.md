# Reference plugin

A complete Longbox plugin in one dependency-free file. It exists to be read and copied.

It implements the whole protocol with nothing but Node's standard library, and reports one
invented upcoming issue per followed series — enough to watch a release travel from a
plugin onto the release calendar without writing anything real first.

```bash
node server.js                    # listens on 8099
PORT=9000 PLUGIN_TOKEN=… node server.js
```

Then, in Longbox: **Settings → Server → Plugins → Register**, with the base URL
`http://<host>:8099/longbox/v1`. Copy the token Longbox shows you into the plugin's
`PLUGIN_TOKEN`, restart it, hit **Test**, then enable it.

Releases appear after the next Release Calendar Sync (Settings → Server → Jobs), and only
for series someone follows — follows are the subscription, so an unfollowed series is
never described to a plugin.

## Writing your own

Your plugin does not belong in this repository. It is a service you run; it can live in
its own repo, in any language, on its own release cycle. That is the whole point of the
design — see `docs/content/docs/developer/plugins.mdx` for the protocol.

The three things worth copying from here:

- **`manifest` and `health` do not require the token.** Longbox has to read the manifest
  during registration, before you have had a chance to paste the token anywhere. Capability
  endpoints are the ones that must check it.
- **`external_id` is the upsert key.** Make it stable for a given issue and a re-sweep
  updates the row instead of adding a duplicate.
- **Echo back the `series[].id` Longbox sent you.** A release naming a series that was not
  in the request is dropped, so there is no reconciliation step and no way to write rows
  against a series the operator never asked about.
