# Releasing Seismic

How a version of the app goes out, and the owner's steps it depends on. The constraints the builds
must keep are in [`docs/design.md`](design.md) (Constraints).

The app is downloaded from the GitHub releases of `nickpalenchar/seismic`; the live seismic.im links
the newest one (it is built from the separate `seismic-site` repository, not from `site/` here,
which stays unpublished). The Mac apps are signed with a Developer ID and notarised; the Windows
installer and the Linux packages are not signed, and the release lists the SHA-256 of every file
in `SHA256SUMS`. Every version has a section in [`CHANGELOG.md`](../CHANGELOG.md), which is the
start of its release notes and what installed apps show of the update.

Three switches can stop distribution again, each on its own: `DISTRIBUTION` in
`scripts/distribution.ts` (the release status refuses), `CHECK_RELEASES` in `desktop/src/update.rs`
(installed apps stop looking for updates) and `UPDATES_ENABLED` in `src/server/app-update.ts` (the
server shows no update the shell reports).

## A release

When the owner says "make a release", the project skill `.claude/skills/release/SKILL.md` goes
through these steps in this order, on a Seismic card or in a terminal; it adds when to ask the
owner and what to look at. The scripts that talk to GitHub act on the checkout's origin as the
account that owns it (`nickpalenchar` for nickpalenchar/seismic, with its gh login, without
switching the account gh has active); other gh calls go through `bun scripts/gh.ts <gh args…>`,
which does the same, since the machine's active account may lack the admin rights a workflow run
or a rerun needs.

1. Where things stand: `bun scripts/release-status.ts` prints whether distribution is switched on,
   the last version tag, the commits since then that change what runs, the version to propose
   (the next minor one while the version is 0.x; `package.json`'s when it is past the last tag, as
   0.1.0 is before the first), whether `CHANGELOG.md` has its section yet, how far GitHub's `main`
   is behind, the latest release and drafts left over, and whether the build's secrets are there.
   It ends with what stands in the way and exits with 1 then.
2. The changelog: `bun scripts/release.ts commits` prints the commits since the last version tag
   that change what runs, grouped by the demo their `Demo-Video` / `Demo-Page` trailers link (a
   trailer naming a file on a machine is no link and is left out); `--since <date>` narrows them.
   From that, the version's section goes at the top of `CHANGELOG.md`, under the heading
   `## <version> — <date of the tag>`:
   - one or two sentences on what the version brings, then `### New`, `### Improved` and
     `### Fixed` (those it has), each entry one line by what users notice, not by commit: a demo
     usually stands for one entry, its commits behind it;
   - every entry links its demo, `([demo](<url>))`, the URL as the trailer has it; a change
     without a demo joins an entry that has one, or is left to the folded list of commits;
   - its first twelve lines, a paragraph or an entry counting as one, are what the app's update
     bar shows on hover (`latest.json`), so the sentences and the entries that matter most go first.
   The section holds the version's main changes, not every commit: the release notes fold every
   commit under it.
3. The version in `package.json` (the app, its settings and the release take it from there),
   committed with the changelog. Landing it restarts a running Seismic (`package.json` counts as
   code).
4. `git push origin main`. The tag's commit has to be on GitHub. Right before tagging, a release
   checkout is rebased onto the current `main`, so commits that landed while the release was being
   prepared go into it too.
5. `git tag v<version> <commit>` on the commit with the version, and `git push origin v<version>`
   (`git push` alone pushes no tag). The build workflow's first check
   (`bun scripts/release.ts check <tag>`) fails at once unless the tag is the version of
   `package.json` and `CHANGELOG.md` has its section. Then the workflow builds every platform,
   checks them, signs and notarises the Mac apps (Apple answers within a minute or so), signs the
   updates and makes a draft release with the installers, the updates and their signatures,
   `SHA256SUMS`, `latest.json` and the notes: the version's section of `CHANGELOG.md`, how to
   install the unsigned downloads, and the commits since the tag before, folded under "All commits"
   (the first release links the history instead). A run takes about ten minutes.
6. The run and the draft: the run of the build workflow for the tag (`bun scripts/gh.ts run list
   --workflow build.yml --branch v<version>`, then `bun scripts/gh.ts run watch <id>`; a job that
   failed on something flaky runs again with `bun scripts/gh.ts run rerun <id> --failed`), then
   `bun scripts/release-status.ts draft v<version>`, which checks that the draft holds every
   installer, update and signature, and a `latest.json` of the version that names every platform,
   and prints the notes. A run that fails on the Macs with HTTP 403 needs the owner to accept
   Apple's agreement (Signing the Mac apps).
7. The owner reads the draft and publishes it as the latest release ("Set as the latest release"
   stays ticked). Publishing reaches every installed app, so that click is the owner's. The
   download links (`releases/latest/download/<installer>`, which carry no version) go to the
   latest release; installed apps find it at their next start or within six hours, and offer it in
   their bar. What the bar shows on hover is the start of the changelog's section as the run found
   it, whatever the release's text says after an edit. Afterwards `bun scripts/release-status.ts`
   names the new version as the latest release.

## Release candidates

A release candidate, `v<version>-rc.<n>` (`v0.2.0-rc.1`), is a build of the version to come, there
for trying it out between releases. It goes out as a GitHub pre-release, published by the build
workflow at once, without a draft: GitHub's `releases/latest` skips pre-releases, so installed apps
are not offered it, and the download links keep pointing at the latest release. Someone who
installs a candidate gets the next release through the updater once it is out (semver puts
`0.2.0` after `0.2.0-rc.1`); a later candidate they install by hand.

1. The version in `package.json` is the candidate's, `0.2.0-rc.1`; committed and pushed to `main`.
   The release after its candidates sets it to `0.2.0`.
2. `git tag v0.2.0-rc.1 <commit>` and `git push origin v0.2.0-rc.1`. The build signs and notarises
   it as a release's, and `bun scripts/release.ts check` asks for no section in `CHANGELOG.md`.
3. Its notes say what it is and fold the commits since the tag before, a candidate's or a
   release's; a section `## 0.2.0-rc.1` in `CHANGELOG.md`, if there is one, comes after that. The
   section `## 0.2.0` is the release's, not its candidates'.

The release's own notes and `bun scripts/release.ts commits` count from the release before, so the
changes of every candidate in between are part of them. `bun scripts/release-status.ts` does too, and
proposes the version a candidate in `package.json` is for.

## The updater's key

Installed apps install only what is signed with Seismic's own key pair (Tauri's updater, made with
`tauri signer generate` on 2026-11-17, without a password).

- The public key is in `desktop/tauri.conf.json` (`plugins.updater.pubkey`); every app carries it.
- The private key is `~/.tauri/seismic.key` on the owner's Mac. Keep a copy in a password manager:
  without it no update reaches the apps that are installed, which would then have to install the
  next version by hand.
- The build workflow signs with the repository secret `TAURI_SIGNING_PRIVATE_KEY`, the file's
  content (`bun scripts/gh.ts secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/seismic.key`),
  read on tags only. Without it a release has no updates and `latest.json` names no platform;
  installed apps then find nothing to install.

A key that is lost or got out is replaced by a new pair whose public key goes into
`desktop/tauri.conf.json`; apps installed before still trust the old one, so the release with the
new key has to be installed by hand once (say so in its notes).

## Signing the Mac apps

The build signs and notarises them with four repository secrets (five with a team key) (Settings → Secrets and variables
→ Actions, or `bun scripts/gh.ts secret set <NAME>`, which reads the value from standard
input). A tag fails on the Macs while one is missing.

### Membership and agreement

The Developer ID needs a membership in the Apple Developer Program (99 USD a year). Apple's API
refuses notarisation ("A required agreement is missing or has expired", HTTP 403) until the
account holder has accepted the newest Program License Agreement: it shows as a banner on
<https://developer.apple.com/account> and in App Store Connect under Business. Apple renews it
now and then, and a release fails the same way until it is accepted again.

### The Developer ID Application certificate

1. Make it, if the keychain has none (`security find-identity -v -p codesigning` lists a
   "Developer ID Application: …"): in Xcode, Settings → Accounts → the team → Manage
   Certificates → + → Developer ID Application (only the account holder may), or on
   <https://developer.apple.com/account/resources/certificates> with a certificate signing
   request from Keychain Access (Certificate Assistant → Request a Certificate from a Certificate
   Authority, saved to disk).
2. Export it with its private key: Keychain Access → login → My Certificates → the
   "Developer ID Application: …" entry → Export → `.p12`, with a password. The `.p12` format is
   offered only for the certificate with its private key (the entry under My Certificates, the
   key folded under it); under Certificates it is greyed out. Exported from the key's row instead,
   the file holds the key without the certificate, and the build fails with "failed to resolve
   signing identity". `openssl pkcs12 -info -noout -in seismic.p12` lists what the file holds: a
   "Certificate bag" and a "Shrouded Keybag".
3. Secrets:
   - `APPLE_CERTIFICATE`: the `.p12` in base64, `base64 -i seismic.p12 | bun scripts/gh.ts secret set APPLE_CERTIFICATE`
   - `APPLE_CERTIFICATE_PASSWORD`: the export's password.
4. Delete the `.p12` file. The certificate is valid for five years; apps signed and notarised
   before it expires keep opening (the signature carries a timestamp). A new one goes into the
   two secrets the same way (`security find-certificate -c "Developer ID Application" -p | openssl x509 -noout -enddate`
   says when it ends).

### The App Store Connect API key, for notarisation

1. On <https://appstoreconnect.apple.com/access/integrations/api>: a team key (Team Keys → +,
   access "Developer"), or an individual key (Individual Keys, for the account's own user).
   Download the `.p8` (Apple offers it once) and note its key ID; for a team key also the Issuer
   ID above the list.
2. Secrets:
   - `APPLE_NOTARY_KEY`: the `.p8`'s contents, `bun scripts/gh.ts secret set APPLE_NOTARY_KEY < AuthKey_XXXXXXXXXX.p8`
   - `APPLE_NOTARY_KEY_ID`: the key ID.
   - `APPLE_NOTARY_ISSUER`: the Issuer ID, for a team key only.
3. Keep the `.p8` somewhere safe (`~/.appstoreconnect/private_keys/` is where Apple's tools look)
   or delete it; Apple does not offer it again, a lost one is revoked and replaced.

### Trying it before a release

Actions → Build → Run workflow, with "Sign and notarise the macOS app" ticked (or `bun scripts/gh.ts workflow run
build.yml --ref main -f sign=true`): the Macs build as on a tag (without a
release), and the step "The compiled server and the app around it" ends
with Gatekeeper's verdict, `source=Notarized Developer ID`. On a Mac, `bun run build:app` does the same with the certificate in the keychain:

```sh
APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)" \
APPLE_NOTARY_KEY=~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8 \
APPLE_NOTARY_KEY_ID=XXXXXXXXXX APPLE_NOTARY_ISSUER=<issuer, team key only> \
bun run build:app
```

## Windows and Linux

Not signed. SmartScreen warns about the Windows installer until it has a reputation ("More
info", then "Run anyway"); the release notes say so and how to check a download against
`SHA256SUMS`.

## Rules

- gh calls against this repository's GitHub repository go through `bun scripts/gh.ts <gh args…>`:
  it runs gh on the checkout's origin as the account that owns it (`nickpalenchar` for
  nickpalenchar/seismic), since the machine's active gh account may be another without admin
  rights.
- The test "names what stands in the way: a missing secret, GitHub ahead, a tag taken, a draft
  left over" in `scripts/release-status.test.ts` clones real git repositories and may time out
  while iterating: skip it locally (`--test-name-pattern` or by file), and run the full suite
  before handing over.
