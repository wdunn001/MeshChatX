# Hosted onboarding journey

This is a design document. Nothing described here is built. It is the starting
point for implementation. Every section below is a proposal that still has to be
reviewed, built, and shipped.

## 1. Scope

This design covers the hosted, multi-user MeshChatX instance at
`msg.quasarke.net`. It applies only when the backend reports `auth_mode` of
`accounts`. It applies only after a person has signed in. The single-user
desktop build, the Electron build, and the Android build are out of scope. Their
behaviour must be byte-for-byte unchanged.

Nothing in this document renders for an anonymous visitor. The entry gate at
`meshchatx/src/frontend/components/auth/AccountsAuthPage.vue` renders alone.
That property is asserted by `tests/e2e/multiuser/entry-gate.spec.js`. Every
surface designed here mounts inside the application shell. `App.vue` mounts that
shell only when `GlobalState.authMode === "accounts"` and
`GlobalState.authenticated` is true.

The person this is written for was handed a link. They are on a phone. They are
on someone else's WiFi. They installed nothing. They have most likely never
heard of Reticulum. They will not learn it in order to finish a step.

## 2. What the hosted terminal actually is

The hosted terminal is a borrowed machine. One backend process runs Reticulum
and serves many people at once. The login exists to protect that shared
resource. The login does not authenticate transport.

The sharing is already visible in the code.
`meshchatx/src/backend/multiuser/rate_limit.py` meters `send_message`,
`announce`, `call`, and `file_transfer` per account. One person's traffic is
drawn from a pool everyone else uses. That fact is the honest basis for section
8. It is never a threat to make to somebody.

Identity here means the RNS identity. The account row in the `accounts` table
binds a username to an identity hash. That binding is the whole of the
relationship. The long-term direction removes username and password
authentication entirely while the identity persists. No rung in this journey may
treat the username as a credential that must survive. The username is a label on
an identity. Eventually it is only that.

The terminal is the first rung. The journey below is a ladder out of dependence
on our server. It is walked one step at a time, at the moment the person can
take the step.

## 3. What is wrong with the current first run

`meshchatx/src/frontend/components/TutorialModal.vue` is an eight step tour
written for someone who installed a desktop application and now operates it.
Every step assumes control the hosted visitor does not have.

The following items must not appear for a hosted, signed-in visitor.

- Security and performance with crash recovery. This describes the reliability
  of a process the person does not run.
- Maps with OpenLayers and offline MBTiles export. Exporting map tiles is a
  bandwidth and storage decision. A stranger on a phone on borrowed WiFi cannot
  make that decision yet. They should not be asked to.
- Full LXST voice with voicemail and custom ringtones. Voice needs a working
  two-way link. It also needs a person to call. At minute one there is neither.
- Built-in extras covering the micron editor, NomadNet nodes, and RNS tools.
  These are authoring and diagnostic tools for an operator.
- Archiver for offline page archiving. This presumes the person already browses
  NomadNet pages.
- Banishment with RNS blackhole level announce dropping. This is a moderation
  tool for a problem the person has not had yet.
- Command palette and keybindings. This is a keyboard product described to
  someone holding a phone.
- The i18n item. Language choice matters a great deal to a stranger. It belongs
  in a control that is always reachable. A tour is the wrong home for it.
- "+ MANY MORE FEATURES!". This is marketing register. It names nothing the
  person can act on.

Further steps are actively harmful on a shared instance. They are a larger
problem than the wrong-audience feature cards.

- Step 2, identity setup, offers a choice between creating a new identity and
  importing one. The account already owns an identity, created at sign up. A
  hosted visitor who takes either branch orphans the identity their account row
  points at.
- Step 3, connection mode, edits the Reticulum interface configuration. Step 4,
  bootstrap selection, edits it too. On the hosted instance that configuration
  is shared. One visitor changing it changes the network for everyone signed in.
- Step 5, propagation mode, is an instance-level setting for the same reason.
- Step 7, the privacy step, writes `local_hops_delta` through
  `PATCH /api/v1/reticulum/instance`. That is a server-wide value.
- The storage migration offer and the Android storage choice on step 1 are
  packaging concerns for a locally installed build.

The footer actions are "Skip Setup" and "Continue". There is no setup on the
hosted instance. Nothing there is skippable. Both strings are also asserted
absent on the anonymous entry gate. Reusing them in the signed-in surface
invites confusion in tests and in people.

## 4. The ladder

Each rung is a state a person is in. Each rung has one ask. The ask is small. A
person may sit on any rung indefinitely. Sitting still is a valid outcome.

### Rung 1: named and addressable on the terminal

Reached at account creation. Sign up calls
`app.identity_manager.create_identity(display_name=username)` in
`meshchatx/src/backend/multiuser/routes.py`. `_save_new_identity` then writes
that name into the new identity's own `config` table and into its
`metadata.json`. The username therefore sets the announced display name. Nobody
lands on the mesh as "Anonymous Peer". The person already has an identity, an
address, and a name at the moment they first see the shell.

Ask of the person: nothing. This rung is a statement of fact.

### Rung 2: they have sent a message that was delivered

Reached when one outbound LXMF message reaches the `delivered` state.

Ask of the person: send one message to one address.

This is the first rung with real friction. The friction is social. A brand new
person has nobody to write to. Section 9 records this as the single largest gap
in the journey.

### Rung 3: they have received a reply

Reached when an inbound LXMF message arrives from a peer they have written to.

Ask of the person: nothing. This rung arrives on its own.

This is the moment the mesh stops being a claim and becomes an experience. No
rung above this one may be offered before it. A person who has never received
anything has no evidence that the thing is worth carrying. Every sovereignty
step then reads to them as an unexplained chore.

### Rung 4: they came back

Reached when the account has been active on two separate days.

Ask of the person: nothing. Returning is the signal. That signal is what earns
the right to ask for anything at all.

### Rung 5: they hold their own identity

Reached when the person has taken a copy of their identity off our server. They
must also have proved to the app that they hold it.

Ask of the person: save the identity, then paste it back once for a check.

This rung is valuable on its own even if the person never climbs higher. It is
also the hard prerequisite for every rung above it. It is the highest risk step
in the whole product. Section 7 covers it in full.

### Rung 6: the app is installed on their device

Reached when the app runs from the home screen in standalone display mode.

Ask of the person: add the app to their home screen.

Installing does not move the identity. The installed app still speaks to our
Reticulum instance over our server. The login still applies. Section 9 records
the login-free, identity-holding PWA as a dependency that does not exist.

Rungs 5 and 6 are parallel. Neither requires the other. Rung 6 is cheaper and
gives immediate value. It is therefore offered first when the device supports
it.

### Rung 7: they run their own node

Reached when the person is running a MeshChatX client on hardware they control.
That client carries their own identity. It reaches the mesh over our public
backbone.

Ask of the person: install the client for their device, restore the identity
they already saved, then retire the terminal copy.

The client builds already exist on the download hub. The identity restore path
already exists. What does not exist is the seeded interface configuration for a
client the person takes away. The retirement flow that closes the terminal side
does not exist either. Both are in section 9.

### Rung 8: their node carries other people

Reached when the person's own node accepts inbound connections and relays the
on-ramp onward.

Ask of the person: allow inbound connections on their node.

A native client can be dialled. A browser peer never can. This rung therefore
belongs to rung 7 hardware. The PWA cannot serve it. This is also the first rung
we cannot observe. Section 5 explains what follows from that.

## 5. The checkpoints

### 5.1 Where the signals come from

Every signal below is read from the account's own per-identity database at
`storage/identities/<identity_hash>/database.db`. The multi-user middleware in
`meshchatx/src/backend/multiuser/middleware.py` binds an `IdentityContext` per
request. `app.database` and `app.config` therefore already resolve to that
account's own storage. No cross-account query is needed. None is permitted.

| Signal | Source |
| --- | --- |
| `outbound_delivered` | `lxmf_messages` where `is_incoming = 0` and `state = 'delivered'` |
| `outbound_attempted` | `lxmf_messages` where `is_incoming = 0` |
| `inbound_total` | `lxmf_messages` where `is_incoming = 1` |
| `distinct_peers` | distinct `peer_hash` in `lxmf_messages` |
| `contacts_count` | rows in `contacts` |
| `favourites_count` | rows in `favourite_destinations` |
| `announces_seen` | rows in `announces` |
| `active_days` | new config key, described below |
| `backup_taken_at` | new config key, set when the identity is exported |
| `backup_verified_at` | new config key, set when possession is proved |
| `installed_seen_at` | new config key, set when the client reports standalone display mode |
| `network_degraded` | existing readiness payload from `/api/v1/status` |

`active_days` has no existing source. The `accounts` table carries a single
`last_login_at` value that is overwritten on every sign in. No existing column
can count returns. A new per-identity config pair is required.
`hosted_onboarding_last_day` holds a UTC date string.
`hosted_onboarding_active_days` holds an integer. That integer increments when
the first authenticated request of a new UTC day arrives.

### 5.2 Readiness and suppression, rung by rung

A rung's prompt fires only when the readiness condition holds and no suppression
condition holds. Readiness proves the person can take the step. Suppression
proves they would be confused by it.

**Prompt for rung 2, send a first message.**

Ready when `outbound_attempted == 0` and the welcome card has been dismissed.

Suppressed when `network_degraded` is true. Suppressed when `announces_seen ==
0`. A person with nobody visible on the network is being asked to write to an
empty room. Presentation is an inline empty state in the conversation list. It is
never a modal.

**Prompt for rung 5, save the identity.**

Ready when `outbound_delivered >= 1` and `inbound_total >= 1` and `active_days
>= 2` and `backup_verified_at` is unset.

Suppressed when `network_degraded` is true. Suppressed while any other ladder
prompt is live. Suppressed for seven days after any dismissal. Retired to a
settings entry after three dismissals.

The two-way conversation requirement is the load-bearing part. Before a reply
has arrived, the identity file protects something the person has no evidence is
real. Asking earlier produces a download nobody keeps.

**Prompt for rung 6, install the app.**

Ready when `active_days >= 2` and `inbound_total >= 1` and the device can
install. On Chromium that means a `beforeinstallprompt` event has been captured.
On iOS Safari that means the platform has been detected and the manual add to
home screen instructions apply.

Suppressed when the app already reports standalone display mode. Suppressed when
neither install path applies to the device. Such a person skips rung 6 entirely
and stays eligible for rung 7. Suppressed when `network_degraded` is true.
Suppressed while any other ladder prompt is live.

**Prompt for rung 7, run your own node.**

Ready when `backup_verified_at` is set and `inbound_total >= 3` and either
`installed_seen_at` is set or `active_days >= 4`.

The `inbound_total >= 3` threshold separates an ongoing conversation from a
single novelty reply. A person who received one message and stopped is a poor
candidate for a node installation.

Suppressed when `network_degraded` is true. Suppressed when `backup_verified_at`
is unset, with no exception. Moving an identity onto a device without a verified
copy is the one way this product can lose someone's address permanently.

**Prompt for rung 8, relay the on-ramp.**

Not offered by the hosted terminal at all.

Once the identity has moved, the person's node is the thing that knows their
state. Our server no longer sees it. Rung 8 therefore has to be prompted by the
client they took away. The hosted terminal's last useful act is rung 7. The
design must not pretend otherwise.

### 5.3 Global rules

- At most one ladder prompt is live at any moment. When more than one is ready,
  the lowest rung wins.
- Every prompt is dismissible without penalty. Dismissal is recorded per account
  and honoured across devices.
- Ladder prompts never appear while the network is degraded. Nobody is asked to
  leave while the thing they would be leaving is broken.
- The first account on an instance is the operator and holds the admin role. The
  operator is a different audience. Admin accounts are excluded from every
  ladder prompt.
- A premature prompt is a design failure. A prompt that never fires is also a
  design failure. Both are regressions. Both need tests.

## 6. What a brand new user sees after their first sign in

One card. It replaces `TutorialModal.vue` entirely for hosted mode. It states
three facts and offers one action. It does not ask the person to configure
anything.

The person is already named. The username they chose at sign up set their RNS
display name. The card therefore reports the name as an existing fact. It never
offers to change it.

Draft copy, written to the same rules as this document.

> **You are on the mesh**
>
> Your address is `<lxmf destination hash>`. Anyone who has this address can
> reach you. It belongs to you.
>
> You appear as **`<display name>`**. That is the name people see when your
> address shows up on the network.
>
> To reach someone you need their address. Share yours, or look at who else is
> here.

Actions on the card: copy the address, show the address as a QR code, open the
announces list. The dismiss action is labelled "Close". The strings "Skip Setup"
and "Continue" must not be used.

What earns its place and why.

- The address earns its place. It is the only thing the person needs in order to
  be reachable. They cannot guess it.
- The name earns its place. It answers the question the address raises. That
  question is what other people will see.
- The one action about finding someone earns its place. Without it the address
  is inert.

Everything else is cut. The full cut list with reasons is section 3.

Language selection stays reachable at all times through the existing selector.
It does not become a step.

## 7. Identity continuity

This is the highest risk step in the product for a non-technical person. It is
also the part most likely to hurt someone if it is designed carelessly.

### 7.1 What the person must understand

These things, stated plainly and stated at the moment of the action.

1. The identity is the address. Whoever holds a copy is that address on the
   mesh.
2. There is no recovery. We cannot restore a lost identity. No support request
   can produce one. A lost identity means an address nobody can read again.
   Messages sent to it will not arrive.
3. The identity is a secret. Anyone who obtains a copy can act as that person.
4. The username and password are separate from all of this. They open this
   server. Losing the password is a problem an operator can help with. No
   operator can help with a lost identity.

Point 4 has to be said out loud. A person's whole prior experience of accounts
teaches them the opposite. It also has to survive the removal of password
authentication. When the login goes away, points 1 through 3 stay true and
unchanged. The copy must therefore be written so that no part of it depends on a
password existing.

### 7.2 What the person must physically do

The person is on a phone. The design follows from that.

1. **Take the identity as text first.** `POST /api/v1/identity/backup/base32`
   already returns the identity as a base32 string. On a phone a string can be
   pasted into a password manager, a notes app, or a message to themselves. A
   downloaded `.bin` file lands in a Downloads folder that the person will lose
   with the phone.

   There is a second and stronger reason to prefer the string.
   `POST /api/v1/identity/backup/download` calls
   `IdentityManager.backup_identity()`. That method writes the private key to
   `<storage_dir>/identity`, a single shared path at the instance root, then
   reads it back to serve the response. On a hosted instance that path is shared
   by every account. Two people exporting at the same time race on one file. A
   private key is left sitting at the instance root afterwards.
   `backup_identity_base32()` reads the key in memory and writes nothing. It is
   safe as written. The file download must not be offered on the hosted instance
   until that path is made per-identity. Section 9 records this as D10.

2. **Put it in one place that is not this phone.** The copy names this
   explicitly. A copy that lives only on the device is no backup at all.

3. **Prove they have it.** The person pastes the string back into the app. The
   app derives the identity hash from what was pasted and compares it to the
   account's `identity_hash`. A match sets `backup_verified_at`. A mismatch
   fails loudly and says what to try again.

Step 3 is the part that separates this design from a checkbox. A checkbox
records a claim. A paste-back records possession. The server already holds this
exact private key. Sending it back therefore adds no new exposure. The pasted
value is compared and discarded without being stored anywhere new.

Draft copy for the verification step.

> Paste your saved identity back here. This checks that the copy you kept is the
> right one. We compare it and throw it away.

### 7.3 The moment the identity moves off our server

Copying the identity does not move it. After a copy, the identity exists in two
places. Both places can run it.

Running the same identity on two Reticulum instances at once is a real hazard.
Both announce the same destination. Delivery reaches whichever path resolves
first. Messages then split across two stores. The person sees half a
conversation in each. Nothing warns them that this is happening.

The design response has these parts.

1. At the point the person exports the identity for the purpose of moving it,
   the copy states that they will be running the address in two places until
   they retire one of them.
2. Rung 7 does not end at "the client works". It ends at an explicit action to
   retire the terminal copy. That action deletes the server-side identity
   directory and closes the account.
3. Retirement is refused while `backup_verified_at` is unset. A person cannot
   delete the only copy they have by accident.

Detecting a duplicate identity from the server side is not verified. Our RNS
instance may or may not surface an announce for a destination it already owns.
Section 9 records this as an open question. Until it is answered, the flow
relies on the person's own declaration. It also relies on warning them at the
point of export.

### 7.4 Tone at this step

No urgency. No countdown. No consequence for waiting. The copy explains what the
identity is and what losing it costs, then it stops. A person who declines is
offered it again in seven days, twice more, then never again outside settings.

## 8. The offboarding moment

This is the emotionally delicate part of the product. Getting the tone wrong
loses the person entirely.

### 8.1 What it must not read as

It must not read as being kicked out. The person did nothing wrong. No limit was
hit. No deadline is approaching. Any mention of quotas, tiers, fair use, or
capacity turns a gift into an eviction notice.

It must not read as an upsell. There is nothing to buy. There is nothing to
upgrade to. No better version is being withheld. Any language borrowed from a
pricing page poisons this.

It must not read as a chore assigned by us. The person is not completing a task
on our behalf.

### 8.2 What it should read as

A statement of where things currently stand, followed by an offer.

The honest framing is that the address is already theirs. What is borrowed is
the machine the address currently runs on. Moving it changes where the address
runs. It changes nothing about who they are on the mesh. That framing is true.
It is the reason the moment can be told plainly without spin.

Draft copy for the rung 7 prompt.

> **Your address can live on your own device**
>
> Right now your address runs on this server. This server is shared with
> everyone else who uses this terminal. It works well for that.
>
> You can move your address onto a device you control. Your address stays the
> same. Your name stays the same. Your conversations continue.
>
> There is no hurry. Nothing changes here if you leave this for later.

Actions: "Show me how" and "Not now". No third action. No small print.

### 8.3 Placement and frequency

The prompt is a card in the conversation list, dismissible in place. It is never
a modal. It is never an interstitial. It never blocks a message. A person who
opened the app to read a message reads the message first.

It appears at most once every seven days, at most three times in total. After
that it lives only in settings as a permanent entry the person can find when
they are ready.

### 8.4 After they leave

When the person retires the terminal copy, the last screen thanks them and gives
them nothing to do. It does not ask for feedback. It does not offer to bring
them back. It states that their address now runs on their device. It states that
this terminal no longer holds a copy.

If the design succeeds, this is the screen every person eventually sees. It
should feel like an ending that went well.

## 9. Dependencies that do not exist

Each item below is required by a rung. Each is absent from the tree today. None
of them should be assumed while planning.

**D1. Install prompt handling.** There is no `beforeinstallprompt` handler, no
`appinstalled` handler, and no `display-mode: standalone` detection anywhere in
`meshchatx/src/frontend`. The web manifest at
`meshchatx/src/frontend/public/manifest.json` is minimal. It carries one 512px
icon with no `id`, no maskable icon, no `screenshots`, and no `shortcuts`.
Chromium install eligibility and the iOS add to home screen path both need
building. Rung 6 is blocked on this.

**D2. A browser-side Reticulum runtime.** The repository contains no in-browser
RNS node in any form, at any stage of build. The WASM artifacts present are a Go
micron parser, a Go network visualiser, the Rust LXMF stamper at
`lxmf-stamper-wasm/`, and Emscripten builds of codec2 and sox. None of them
speak Reticulum. The frontend opens exactly three WebSockets. All three carry
the application's own JSON to the Python backend. The dependency list contains no
cryptography library at all. The browser is a thin HTTP client of the Python
process. It is nothing more than that today.

The server-side halves are also weaker than they look.
`meshchatx/src/backend/interfaces/WebsocketServerInterface.py` and
`WebsocketClientInterface.py` exist and have unit tests. They are unreachable as
product surface. They are absent from `_BUNDLED_INTERFACE_MODULES` in
`meshchatx/src/backend/interface_module_store.py`. That tuple lists
`HTTPInterface.py` alone. They are therefore never copied into the Reticulum
interface path. They
are absent from the add interface UI. Both classes also set `self.IN = True` and
`self.OUT = False`. Transport therefore treats them as receive-only as written.

Integrating Reticulum-Go's WASM target is a separate project. The login-free,
identity-holding PWA named in the product vision is blocked on all of this.
Until it lands, rung 6 is an installed shell over our server with the login
intact. The design says so plainly.

**D3. Identity possession verification.** There is no endpoint that accepts a
pasted or uploaded identity and confirms it matches the signed-in account.
`POST /api/v1/identity/restore` replaces the running identity. That is the
opposite of what rung 5 needs. A new read-only comparison endpoint is required.

**D4. Sign out.** No frontend surface calls `POST /api/v1/multiuser/logout`.
There is no sign-out control anywhere in the shell. A person on a borrowed phone
on someone else's WiFi currently cannot end their session.

**D5. Account retirement.** There is no flow that deletes an account's
server-side identity directory and closes the account.
`DELETE /api/v1/identities/{identity_hash}` exists as an identity management
route for the single-user path. It is not an offboarding flow. Rung 7 ends on
this. Section 7.3 explains why the ending matters.

**D6. Somebody to talk to.** A brand new account has no contacts. The announces
list is a directory of hashes. Nothing in the product gives a first person a
first conversation. This is the largest gap in the journey. Rung 2 is where most
people will stop without it. Whatever fills this must be a real, reachable LXMF
destination that answers. A placeholder that never replies is worse than
nothing. It fails at exactly rung 3.

**D7. Return counting.** The `accounts` table records a single `last_login_at`
that is overwritten each sign in. No existing column can count separate days.
The `hosted_onboarding_active_days` pair described in section 5.1 is new work.

**D8. Seeded interfaces for a client the person takes away.** The repository
ships no Reticulum config template of its own.
`_write_rns_reticulum_default_config_file()` in `meshchatx/meshchat.py` writes
`RNS.Reticulum.__default_rns_config__` unchanged. A fresh install therefore gets
upstream's stock AutoInterface and nothing else. The string `rns.quasarke.net`
does not appear anywhere in the tree. The string `127.0.0.1:4343` appears only as
third-party entries inside
`meshchatx/src/backend/data/community_interfaces.json`. The terminal's own route
to the mesh is host configuration outside this repository. That route is useless
to a client running on someone's laptop.

Rung 7 therefore needs a configuration that points at our public backbone and at
our other faces. It must carry no third-party hub. Whether it ships as a
downloadable config file, a deep link, or a value shown on screen is an open
question. This is the largest piece of unbuilt work in the offboarding half of
the ladder.

**D9. Duplicate identity detection.** Whether our RNS instance can observe an
announce for a destination it already owns is unverified. Until someone confirms
it, no part of the design may depend on detecting that a person is running their
identity in two places.

**D10. A per-identity path for the identity file export.**
`IdentityManager.backup_identity()` writes the private key to
`<storage_dir>/identity`, one shared path for the whole instance, before serving
it. Section 7.2 explains the consequence. Until this is made per-identity, the
hosted instance offers the base32 string only. The file download stays a desktop
affordance.

## 10. Implementation plan

### 10.1 Where checkpoint state lives

In the per-identity `config` key and value table declared at
`meshchatx/src/backend/database/schema.py:175`. `ConfigManager.set` and
`ConfigManager.get` are a generic key and value store. New keys therefore need no
schema migration.

This choice is the reason the design is simple. `app.config` resolves through
`IdentityContext` via `set_active_context` in the multi-user middleware. Any key
written there is already per-account, already server-side, and already isolated
from every other account. It also satisfies the repository convention in
`.agents/conventions/reticulum-zen.md` that identity-scoped state stays inside
`IdentityContext`. The keys `tutorial_seen` and `changelog_seen_version` already
ride this exact path.

Keys are namespaced with a `hosted_onboarding_` prefix.

The state must not go in `accounts.db`. That store holds one table with eight
columns. It has no migration machinery beyond `CREATE TABLE IF NOT EXISTS`. It is
deliberately identity-agnostic. Adding a column there would mean hand-writing an
`ALTER TABLE` guard for state that belongs one layer down.

The API surface needs one correction to an easy assumption.
`GET /api/v1/config` returns a hand-written dictionary of roughly sixty named
fields. `PATCH /api/v1/config` is a long chain of per-key blocks. Neither is a
generic key and value passthrough. New keys do not appear there for free. The
precedented and cheaper path is a dedicated route pair modelled on
`POST /api/v1/app/tutorial/seen`. That is what this plan uses.

The pattern catalog normally consulted before designing a service layer was not
reachable from this machine. No catalog entry is cited. The shape used is a
server-side evaluator holding one rule per rung, reading from the existing key
and value repository.

### 10.2 How it stays out of the desktop path

These rules are all testable.

1. No increment in this plan modifies `TutorialModal.vue`. The desktop tour
   keeps its current behaviour, its current tests, and its current snapshots.
   Hosted mode gets a new component. `App.vue` gains one branch that selects
   between them. Work outside this plan may touch that file for its own
   reasons, such as the entry gate hardening in progress at the time of
   writing. That is a separate concern from the onboarding journey.
2. The `App.vue` branch is gated on `GlobalState.authMode === "accounts"`. That
   value is `null` on every desktop build. The branch is therefore unreachable
   outside hosted mode.
3. The new backend routes return a disabled payload when multi-user is not
   active. They use the same check `meshchatx/src/backend/http/routes/status.py`
   already applies. Route registration does not diverge between modes.

The existing dismissible prompt framework in
`meshchatx/src/frontend/js/postInstallPromptState.js` is deliberately left
alone. It stores its seen-map in `localStorage`. That storage is per-device. On a
shared browser it leaks one account's onboarding state onto the next account
that signs in. Hosted acknowledgements go to the per-identity config.

### 10.3 Increments

**Increment 1: the hosted welcome card.** This is the first shippable unit. It is
deliberately small.

Add `meshchatx/src/frontend/components/onboarding/HostedWelcomeCard.vue`
carrying the section 6 content. Add the branch in
`meshchatx/src/frontend/components/App.vue` so hosted mode mounts the card and
never mounts `TutorialModal`. Add one config key
`hosted_onboarding_welcome_seen` with a route to set it. Add frontend unit tests
proving the card renders only when `authMode === "accounts"` and `authenticated`
is true. Add a multi-user end to end test proving a fresh account sees the card
and never sees the eight step tour.

This increment is independently useful with nothing else built. It removes a tour
that is wrong for the audience. It replaces that tour with the three facts the
person needs. It touches no backend logic beyond one key.

**Increment 2: the checkpoint service.** Add
`meshchatx/src/backend/multiuser/onboarding.py` computing the section 5.1
signals from the account's own database. Add `GET /api/v1/onboarding/state`
returning the signals, the current rung, and the single live prompt if any. Add
the `hosted_onboarding_active_days` counter to the multi-user middleware. Add a
frontend composable that reads the endpoint. Add a host component that renders
the one live prompt. Ship with only the rung 2 prompt wired. That proves the
ladder machinery before any high-stakes prompt rides on it.

**Increment 3: identity continuity.** Build D3, the possession verification
endpoint. Build the section 7 flow with base32 first. Wire the rung 5 prompt.
This increment deserves the most careful review of the set. It should not be
combined with anything else.

**Increment 4: sign out.** Build D4. This is small. It is overdue on its own
merits. A person on a borrowed phone needs it more than they need any rung. It
can ship at any point and does not depend on the increments around it.

**Increment 5: the install rung.** Build D1. Wire the rung 6 prompt. Improve the
web manifest to meet install criteria on both platforms.

**Increment 6: the own-node rung.** Resolve D8 first. Then build the rung 7
prompt and the walkthrough. Then build D5, the retirement flow, including the
refusal when `backup_verified_at` is unset.

**Increment 7: the login-free PWA.** Blocked on D2. Not schedulable until the
browser runtime question is answered by a separate piece of work.

D10 blocks the file download half of increment 3. It is a small fix on its own
and can land at any time before it.

D6 is not an increment here. It is a product question and not a frontend one. It
blocks the value of increment 2. It should be answered in parallel by whoever
owns the mesh services.

### 10.4 Files this plan touches

- `meshchatx/src/frontend/components/App.vue`, one branch added.
- `meshchatx/src/frontend/components/onboarding/HostedWelcomeCard.vue`, new.
- `meshchatx/src/frontend/components/onboarding/LadderPromptHost.vue`, new.
- `meshchatx/src/frontend/js/onboarding/hostedOnboardingState.js`, new.
- `meshchatx/src/backend/multiuser/onboarding.py`, new.
- `meshchatx/src/backend/multiuser/routes.py`, new routes registered.
- `meshchatx/src/backend/multiuser/middleware.py`, the active-day counter.
- `meshchatx/src/backend/multiuser/permissions.py`, classifying the new routes.
- `meshchatx/src/backend/http/routes/identities.py`, the verification endpoint.
- `meshchatx/src/backend/identity_manager.py`, the D10 per-identity export path.
- `meshchatx/src/frontend/public/manifest.json`, install criteria.

`meshchatx/src/frontend/components/TutorialModal.vue` is absent from this list.
It must stay absent.
