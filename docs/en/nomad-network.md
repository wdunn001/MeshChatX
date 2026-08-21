# Nomad Network and Mesh Server

Nomad Network is a distributed page and file system on top of Reticulum. MeshChatX includes a browser for remote nodes and a **Mesh Server** tool for hosting your own pages.

## Nomad browser

Open **Nomad Network** and enter a node destination hash. MeshChatX fetches the default entry page (usually `/page/index.mu`) over Reticulum link requests.

Supported page types:

| Extension | Format                               |
| --------- | ------------------------------------ |
| `.mu`     | Micron markup (NomadNet default)     |
| `.md`     | Markdown with GFM-oriented rendering |
| `.txt`    | Plain text with preserved whitespace |
| `.html`   | Static HTML with sanitised CSS       |

Follow links inside pages to browse further paths on the same node. Download files offered at `/file/*` paths.

Rendering uses `NomadPageRenderer.js` with DOMPurify sanitization. Micron can use a JavaScript parser or optional Go WASM when `nomad_micron_wasm_enabled` is set.

## Human-readable names

Instead of a destination hash you can type a name such as `beacon`, provided a resolver is configured. Name resolution is off until you add one under **Settings → NomadNet**, in the Naming section. With it off, only hashes and names you have already pinned are used.

Names are resolved by [rns-resolve](https://github.com/wdunn001/rns-resolve), a naming service that runs elsewhere on the mesh. MeshChatX is only a client of it, so nothing extra is installed and no resolver runs locally.

What happens when you type an address:

| Input                  | Result                                             |
| ---------------------- | -------------------------------------------------- |
| 32 hex character hash  | Used directly. Never sent to a resolver.           |
| A name you have pinned | Answered from the local database. No mesh traffic. |
| Any other name         | Looked up through your configured resolvers.       |

A hash never reaches a resolver, so browsing by hash does not tell a resolver what you are reading.

### What you see during a lookup

A lookup crosses the mesh, so the browser shows the same progress line a page load uses, reading "Looking up the name with a resolver". A name that resolves goes straight on to loading the page.

A name that does not resolve is reported as a name rather than as a bad address:

| Message                               | Meaning                          |
| ------------------------------------- | -------------------------------- |
| No resolver knows this name           | The name is not registered.      |
| Could not reach a resolver to look up | No configured resolver answered. |
| Name resolution is off                | No resolver is configured yet.   |
| More than one identity has registered | The name is contested, so it is not used. |

The name in the message is the normalised form, so typing `RNS-Resolve` reports `rns-resolve`, which is what the resolver was asked for.

### Pinned names

The first time a name resolves, MeshChatX pins it to that destination and remembers it, so later lookups need no network. A pin is stored on the same row as the custom display name for that destination, so it lives with the name you may already have given the node.

A pinned name is never repointed in the background. If a resolver later answers with a different destination for a name you have pinned, the pin stands.

### Setting a second resolver

The first resolver is asked. A second can be set as a fallback, used only when the first cannot be reached or does not know the name, so an ordinary lookup costs one mesh round trip.

Every record is checked before it is used. A registration target is derived from the registrant's identity rather than declared by the resolver, so MeshChatX recomputes it and drops any record where the two disagree. A resolver cannot point a name at a destination its registrant did not control. Because records are combined rather than compared, adding a resolver widens what you can find and cannot stop a name from resolving.

This proves a destination belongs to an identity. It does not prove that identity owns the name. When more than one identity has registered the same name, the name does not identify a single destination, so it is not used and you are told to browse by hash instead.

## Favourites and caching

Save frequent nodes as favourites. Link caching (`nomadnet_cached_links`) speeds up repeat visits on slow links.

## Archives

When **page archiver** is enabled, MeshChatX stores versioned snapshots of pages you visit. Open **Archives** to browse historical copies. An optional crawler can archive automatically.

Archived pages use the same renderer as the live browser based on the stored `page_path` extension.

## Mesh Server (page nodes)

**Tools → Mesh Server** lets you run a `nomadnetwork.node` destination locally.

Typical workflow:

1. Create a page node in the UI.
2. Upload `.mu`, `.md`, `.txt`, or `.html` pages and optional files.
3. Start the node and announce it on the mesh.
4. Share your destination hash so others can open `/page/index.mu` on your node.

### Executable (dynamic) pages

You can opt in per node to **executable pages**. When enabled:

- Non-executable pages are served as static files.
- Pages marked executable in the Mesh Server editor run as scripts. On Linux and macOS, `chmod +x` on the page file also marks it.
- The first line must be a shebang such as `#!/usr/bin/env python3`. Windows does not exec scripts by shebang, so Mesh Server resolves that interpreter on PATH (`python`, `py`, `node`, and similar).
- Request `field_*` and `var_*` values are passed as environment variables.
- `link_id` and `remote_identity` are supplied when available.
- Script stdout is returned as the page body. Failures return a controlled error page.

Editing a page in Mesh Server always shows the file source, never the script output.

API endpoints under `/api/v1/page-nodes/` manage CRUD operations, start and stop, and file listings.

Pages are served at `/page/<name>` and files at `/file/<name>` on the node destination.

## Browsing flow

```
User enters destination hash, or a name (see Human-readable names)
    |
    v
RNS link request to /page/index.mu (or chosen path)
    |
    v
Remote page node responds with content
    |
    v
NomadPageRenderer picks Micron, Markdown, text, or HTML pipeline
    |
    v
Sanitised HTML shown in Nomad Network view
```

## Authoring pages

Read **NomadNet page formats** for security rules, Markdown quirks, and API behaviour. The Mesh Server rejects disallowed extensions on upload.

## Micron editor

**Tools → Micron editor** helps author `.mu` pages before you upload them to your node.

## See also

- **NomadNet page formats** for detailed authoring reference
- **Tools and utilities** for the full tools list
- **Reticulum interfaces** if remote pages time out (likely a path issue)
