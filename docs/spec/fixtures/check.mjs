#!/usr/bin/env node
// Checks the wire fixtures the way a tenant implementation would, with
// nothing but Node's standard library. It is the round trip a tenant client
// needs (TOON_Network #16, acceptance criterion 4), in both directions:
//
//   verify   every event's `id` is the SHA-256 of its NIP-01 serialization,
//            every `sig` is a valid BIP-340 Schnorr signature over that id by
//            `pubkey` (or invalid, for the one case that requires it), every
//            signed request body is exactly `{ "request": <event> }`, every
//            event is the kind its `kind_name` says, every error body is
//            `{ error, message }` with a spec §5 code, and the routes in
//            `routes.listing` are the ones the Listing events derive to — the
//            paid `.spawn` and `.extend` of every Listing, plus `.standby`
//            and `.standby.extend` at `standby_price` for exactly the
//            Listings that carry one; and a Profile that declares `hidden`
//            carries no `host` while every Listing of that provider carries
//            the `hidden:true` label, and no other Listing does;
//   produce  from the test keys in `constants.json`, every event is rebuilt
//            from its fields — a Lease Request from its PARSED `content` and
//            its tags — and signed with all-zero auxiliary randomness, and
//            the result must have the same `id` and the same `sig` byte for
//            byte; every packet body is rebuilt from the rebuilt event and
//            must equal the fixture's.
//
//     node docs/spec/fixtures/check.mjs            # checks ./wire
//     node docs/spec/fixtures/check.mjs <dir>      # checks another copy
//
// Exit code 0 when everything passes, 1 otherwise. The secp256k1 arithmetic
// below is a plain BigInt implementation for checking fixtures only: slow,
// not constant-time, and not for use anywhere a real key is handled. The
// signing half exists so that the fixture signatures are shown to be
// reproducible from the published keys; real signers use fresh randomness.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── secp256k1 and BIP-340 verification ──────────────────────────────────────

const P = (1n << 256n) - (1n << 32n) - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
];

const mod = (a, m = P) => ((a % m) + m) % m;

function pow(base, exp, m = P) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return result;
}

const inv = (a) => pow(a, P - 2n);

/** Affine point addition; `null` is the point at infinity. */
function add(p, q) {
  if (!p) return q;
  if (!q) return p;
  const [x1, y1] = p;
  const [x2, y2] = q;
  if (x1 === x2) {
    if (mod(y1 + y2) === 0n) return null;
    const l = mod(3n * x1 * x1 * inv(2n * y1));
    const x3 = mod(l * l - 2n * x1);
    return [x3, mod(l * (x1 - x3) - y1)];
  }
  const l = mod((y2 - y1) * inv(x2 - x1));
  const x3 = mod(l * l - x1 - x2);
  return [x3, mod(l * (x1 - x3) - y1)];
}

function mul(p, k) {
  let result = null;
  while (k > 0n) {
    if (k & 1n) result = add(result, p);
    p = add(p, p);
    k >>= 1n;
  }
  return result;
}

/** BIP-340 lift_x: the point with this x and an even y, or null. */
function liftX(x) {
  if (x >= P) return null;
  const c = mod(pow(x, 3n) + 7n);
  const y = pow(c, (P + 1n) / 4n);
  if (mod(y * y) !== c) return null;
  return [x, (y & 1n) === 0n ? y : P - y];
}

const sha256 = (...parts) =>
  createHash('sha256').update(Buffer.concat(parts)).digest();

function taggedHash(tag, ...message) {
  const t = sha256(Buffer.from(tag, 'utf8'));
  return sha256(t, t, ...message);
}

const toInt = (buf) => BigInt('0x' + Buffer.from(buf).toString('hex'));
const toBytes32 = (n) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');

/** BIP-340 verify(pk, m, sig), all hex. */
function schnorrVerify(pubkeyHex, messageHex, sigHex) {
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex) || !/^[0-9a-f]{64}$/.test(messageHex)) return false;
  if (!/^[0-9a-f]{128}$/.test(sigHex)) return false;
  const pk = liftX(BigInt('0x' + pubkeyHex));
  if (!pk) return false;
  const sig = Buffer.from(sigHex, 'hex');
  const r = toInt(sig.subarray(0, 32));
  const s = toInt(sig.subarray(32));
  if (r >= P || s >= N) return false;
  const e = mod(
    toInt(taggedHash('BIP0340/challenge', toBytes32(r), Buffer.from(pubkeyHex, 'hex'), Buffer.from(messageHex, 'hex'))),
    N,
  );
  const R = add(mul(G, s), mul(pk, mod(N - e, N)));
  return R !== null && (R[1] & 1n) === 0n && R[0] === r;
}

/** The x-only public key of a secret key, hex, and the BIP-340 secret
 *  `d` (negated when the point's y is odd) that goes with it. */
function keypair(secretHex) {
  const d0 = BigInt('0x' + secretHex);
  if (d0 <= 0n || d0 >= N) throw new Error('secret key out of range');
  const P = mul(G, d0);
  const d = (P[1] & 1n) === 0n ? d0 : N - d0;
  return { P, d, pubkeyHex: toBytes32(P[0]).toString('hex') };
}

/** BIP-340 sign(sk, m, aux) with aux = 32 zero bytes — the fixtures' signing
 *  rule (`constants.json` → `signing.aux_rand`) — so the output is the one
 *  signature every fixture carries. Never use zero aux outside a fixture. */
function schnorrSignZeroAux(secretHex, messageHex) {
  const { P, d } = keypair(secretHex);
  const m = Buffer.from(messageHex, 'hex');
  const px = toBytes32(P[0]);
  const aux = Buffer.alloc(32);
  const t = toBytes32(d ^ toInt(taggedHash('BIP0340/aux', aux)));
  const k0 = mod(toInt(taggedHash('BIP0340/nonce', t, px, m)), N);
  if (k0 === 0n) throw new Error('nonce is zero');
  const R = mul(G, k0);
  const k = (R[1] & 1n) === 0n ? k0 : N - k0;
  const rx = toBytes32(R[0]);
  const e = mod(toInt(taggedHash('BIP0340/challenge', rx, px, m)), N);
  return Buffer.concat([rx, toBytes32(mod(k + e * d, N))]).toString('hex');
}

// ── NIP-01 ──────────────────────────────────────────────────────────────────

/** The string whose SHA-256 is the event id. JSON.stringify escapes exactly
 *  as NIP-01 requires (backslash, quote, and the control characters). */
const nip01Serialization = (e) => JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
const eventId = (e) => sha256(Buffer.from(nip01Serialization(e), 'utf8')).toString('hex');

/** JSON with object keys sorted, for comparing two documents regardless of
 *  key order (the fixtures are written with sorted keys; a tenant's
 *  serialiser need not be). */
const canonical = (v) =>
  Array.isArray(v)
    ? '[' + v.map(canonical).join(',') + ']'
    : v !== null && typeof v === 'object'
      ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
      : JSON.stringify(v);

/** Spec §5's error codes, in the order §5 lists them. */
const ERROR_CODES = [
  'unknown_workload', 'wrong_listing_version', 'not_tenant', 'workload_id_taken',
  'refused_image', 'no_capacity', 'no_matching_arch', 'invalid_request',
  'expired', 'not_standby', 'not_running', 'bad_signature', 'stale_request',
];

// ── the checks ──────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? join(here, 'wire');
const load = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

let failures = 0;
let checks = 0;
function report(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  checks += 1;
  if (!ok) failures += 1;
}

const constants = load('constants.json');

// The test keys: every fixture event is signed by one of them, so every one
// can be re-signed. Each public key must derive from its secret key first.
// Every key `constants.json` publishes is taken, not a fixed list, so a key
// added for a later surface — the Standby Set peers of §7, which sign nothing
// here but could — is checked and can sign a round trip.
const secretKeys = {};
for (const who of Object.keys(constants).filter((k) => constants[k]?.secret_key).sort()) {
  const { secret_key, public_key } = constants[who];
  report(keypair(secret_key).pubkeyHex === public_key, `constants: ${who}.public_key derives from ${who}.secret_key`);
  secretKeys[public_key] = secret_key;
}

function checkEvent(where, event, { expectValidSig = true, kindName } = {}) {
  report(eventId(event) === event.id, `${where}: id is the sha256 of the NIP-01 serialization`);
  const valid = schnorrVerify(event.pubkey, event.id, event.sig);
  report(
    valid === expectValidSig,
    `${where}: BIP-340 signature ${expectValidSig ? 'verifies' : 'is invalid, as this case requires'}`,
  );
  if (kindName) {
    report(constants.kinds[kindName] === event.kind, `${where}: kind ${event.kind} is ${kindName}`);
  }
}

/** Rebuild `event` from its fields — `content` given as the PARSED object
 *  when the fixture carries one, so the string a tenant would sign is
 *  re-serialised here rather than copied — sign it with the test key its
 *  pubkey names and zero aux, and require the same `id` and `sig`. Returns
 *  the rebuilt event, or null when it could not be rebuilt. */
function roundTrip(where, event, { content, expectSameSig = true } = {}) {
  const secret = secretKeys[event.pubkey];
  report(secret !== undefined, `${where}: signed by one of constants.json's test keys`);
  if (secret === undefined) return null;
  const rebuilt = {
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: content === undefined ? event.content : JSON.stringify(content),
  };
  if (content !== undefined) {
    report(rebuilt.content === event.content, `${where}: content re-serialises to the signed string (sorted keys, no whitespace)`);
  }
  rebuilt.id = eventId(rebuilt);
  rebuilt.sig = schnorrSignZeroAux(secret, rebuilt.id);
  report(rebuilt.id === event.id, `${where}: rebuilt event has the same id`);
  report(
    (rebuilt.sig === event.sig) === expectSameSig,
    `${where}: re-signing with zero aux gives ${expectSameSig ? 'the same sig byte for byte' : 'a different sig, since this one is tampered'}`,
  );
  return rebuilt;
}

const hasTag = (event, cells) =>
  event.tags.some((t) => cells.every((c, i) => t[i] === c));
const tagValue = (event, name) => event.tags.find((t) => t[0] === name)?.[1];
const tagValues = (event, name) => event.tags.filter((t) => t[0] === name).map((t) => t[1]);

// The verifier must reject something, or every "ok" above is vacuous.
{
  const good = load('lease_request.spawn.json').event;
  const tampered = (good.sig[0] === '0' ? '1' : '0') + good.sig.slice(1);
  report(schnorrVerify(good.pubkey, good.id, tampered) === false, 'self-test: a tampered signature is rejected');
  report(schnorrVerify(good.pubkey, good.id, good.sig) === true, 'self-test: the untampered signature is accepted');
  // And the signer must produce something the verifier accepts, with a
  // different key giving a different signature.
  const other = schnorrSignZeroAux(constants.other_tenant.secret_key, good.id);
  report(schnorrVerify(constants.other_tenant.public_key, good.id, other), 'self-test: a signature this signer produces verifies');
  report(other !== good.sig, 'self-test: a different key gives a different signature');
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
for (const file of files) {
  const doc = load(file);
  const { surface, case: kase } = doc.fixture;

  if (doc.event) {
    checkEvent(`${file} event`, doc.event, { kindName: doc.kind_name });
    report(doc.nip01_serialization === nip01Serialization(doc.event), `${file}: nip01_serialization matches the event`);
  }

  if (surface === 'lease_request') {
    report(
      JSON.stringify(doc.packet_body) === JSON.stringify({ request: doc.event }),
      `${file}: packet_body is exactly { "request": <event> }`,
    );
    const rebuilt = roundTrip(`${file} event`, doc.event, { content: doc.content });
    if (rebuilt) {
      report(
        canonical({ request: rebuilt }) === canonical(doc.packet_body),
        `${file}: packet_body rebuilt from the rebuilt event matches`,
      );
      report(
        Object.keys(doc.packet_body).length === 1 && canonical(doc.packet_body.request) === canonical(rebuilt),
        `${file}: the rebuilt packet body has the single key request`,
      );
    }
    report(doc.event.pubkey === constants.tenant.public_key, `${file}: signed by the fixture tenant`);
    report(tagValue(doc.event, 'p') === constants.provider.public_key, `${file}: p tag names the fixture provider`);
    report(tagValue(doc.event, 'op') === kase, `${file}: op tag is ${kase}`);
    const expiration = Number(tagValue(doc.event, 'expiration'));
    report(
      expiration - doc.event.created_at === constants.lease_request_ttl_s,
      `${file}: expiration is created_at + ${constants.lease_request_ttl_s}`,
    );
  }

  if (surface === 'directory') {
    report(doc.event.pubkey === constants.provider.public_key, `${file}: signed by the fixture provider`);
    roundTrip(`${file} event`, doc.event);
    report(hasTag(doc.event, ['L', constants.label]), `${file}: carries ["L", "${constants.label}"]`);
    // A Takeover (spec §7.1) is addressed by the workload id the whole
    // Standby Set shares, and names the primary it claims from. The signer
    // is the STANDBY: a primary never announces its own takeover.
    if (kase === 'takeover') {
      report(tagValue(doc.event, 'd') === doc.content.workload_id, `${file}: d is the workload id`);
      report(doc.content.primary === constants.primary_provider.public_key, `${file}: primary is the set's index 0`);
      report(doc.event.pubkey !== doc.content.primary, `${file}: the standby signs it, not the primary`);
    }
    if (kase === 'eviction') {
      report(['abuse', 'policy', 'maintenance', 'other'].includes(doc.content.reason), `${file}: reason is one of §6.7's codes`);
      report(tagValue(doc.event, 'x') === doc.content.workload_id, `${file}: x tag is the workload id`);
    }
    // A Hidden Provider (spec §4.1, §10) declares `hidden: true` and then
    // publishes NO host — not a null, not an empty string, no key — because
    // a host is exactly what it promised not to reveal. A provider that is
    // not hidden publishes one. `connector_url` of a hidden provider is at
    // an `.anyone` host, the only way its connector is reached.
    if (kase === 'profile' || kase === 'profile.hidden') {
      const hidden = doc.content.hidden === true;
      report(typeof doc.content.hidden === 'boolean', `${file}: hidden is a boolean`);
      report(hidden === (kase === 'profile.hidden'), `${file}: hidden is ${kase === 'profile.hidden'}`);
      report(
        hidden ? !('host' in doc.content) : typeof doc.content.host === 'string' && doc.content.host.length > 0,
        hidden ? `${file}: a hidden Profile carries no host key at all` : `${file}: a Profile that is not hidden carries its host`,
      );
      const connectorHost = new URL(doc.content.connector_url).hostname;
      report(
        hidden ? /^[a-z2-7]+\.anyone$/.test(connectorHost) : !connectorHost.endsWith('.anyone'),
        hidden ? `${file}: connector_url is at an .anyone host` : `${file}: connector_url is at a clearnet host`,
      );
    }
    // Every Listing of a hidden provider carries `["l", "hidden:true",
    // "toon.network"]` beside its other labels (spec §4.2, §4.4); a Listing
    // of any other provider carries no `hidden:` label at all — never
    // `hidden:false` — so absence is the filter for public compute.
    if (kase.startsWith('listing')) {
      const hiddenLabels = doc.event.tags.filter((t) => t[0] === 'l' && String(t[1]).startsWith('hidden:'));
      if (kase.endsWith('.hidden')) {
        report(hasTag(doc.event, ['l', 'hidden:true', constants.label]), `${file}: carries ["l", "hidden:true", "${constants.label}"]`);
        report(hiddenLabels.length === 1, `${file}: exactly one hidden label`);
      } else {
        report(hiddenLabels.length === 0, `${file}: carries no hidden: label (never hidden:false)`);
      }
      report(hasTag(doc.event, ['l', 'isolation:' + load('directory.profile.json').content.isolation, constants.label]), `${file}: carries the isolation label`);
      report(tagValues(doc.event, 'l').some((v) => v.startsWith('arch:')), `${file}: carries the arch label`);
    }
  }

  // The Image Registry entry, the Blob Record and the Template (spec §8) are
  // signed by a PUBLISHER, never by a provider, and each carries the same
  // label. The two that are addressed by a digest must agree with it in both
  // their `d` and their `x` tag, or a relay's `#x` filter could be made to
  // serve a record describing a different blob.
  if (surface === 'registry') {
    report(doc.event.pubkey === constants.publisher.public_key, `${file}: signed by the fixture publisher, not the provider`);
    roundTrip(`${file} event`, doc.event);
    report(hasTag(doc.event, ['L', constants.label]), `${file}: carries ["L", "${constants.label}"]`);
    const d = tagValue(doc.event, 'd');
    if (kase === 'image_entry') {
      report(/^[^:]+:[^:]+$/.test(d), `${file}: d is <name>:<tag>`);
      report(tagValue(doc.event, 'x') === doc.content.digest.replace(/^sha256:/, ''), `${file}: x tag is the image digest's hex`);
      report(doc.content.blobs.length > 0, `${file}: lists the image's blobs`);
      for (const [i, blob] of doc.content.blobs.entries()) {
        const type = blob.source?.type;
        report(type === 'toon-store' || type === 'oci', `${file}: blobs[${i}] has a source type this milestone defines`);
      }
    }
    if (kase === 'blob_record') {
      report(d === doc.content.digest, `${file}: d is the blob's digest`);
      report(tagValue(doc.event, 'x') === doc.content.digest.replace(/^sha256:/, ''), `${file}: x tag is the blob digest's hex`);
      const total = doc.content.parts.reduce((sum, p) => sum + p.size, 0);
      report(total === doc.content.size, `${file}: the parts' sizes sum to the blob's size`);
      report(
        doc.content.parts.slice(0, -1).every((p) => p.size === doc.content.part_size),
        `${file}: every part but the last is part_size bytes`,
      );
    }
    if (kase === 'template') {
      report(typeof d === 'string' && d.length > 0, `${file}: d is the template name`);
      report(!('capabilities' in doc.content), `${file}: a Template grants no capability (ADR 0004)`);
    }
  }

  // The three forms spec §6.2 allows a spawn's `image` to take. Exactly one
  // of `reference` and `registry_entry` may be present, or neither.
  if (surface === 'spawn_image') {
    const image = doc.image;
    report(/^sha256:[0-9a-f]{64}$/.test(image.digest), `${file}: image.digest is sha256:<64 lowercase hex>`);
    report(
      !('reference' in image) || !('registry_entry' in image),
      `${file}: reference and registry_entry are never both present`,
    );
    if (image.registry_entry) {
      const [kind, pubkey] = image.registry_entry.address.split(':');
      report(Number(kind) === constants.kinds.K_IMAGE, `${file}: registry_entry.address names an Image Registry entry`);
      report(pubkey === constants.publisher.public_key, `${file}: registry_entry.address names the fixture publisher`);
      report(typeof image.registry_entry.relay === 'string' && image.registry_entry.relay.length > 0, `${file}: registry_entry names a relay`);
    }
    report(
      JSON.stringify(doc.spawn_content.image) === JSON.stringify(image),
      `${file}: image is the spawn content's own image object`,
    );
    report(
      doc.request_body.request.content === JSON.stringify(doc.spawn_content),
      `${file}: spawn_content is exactly the signed event's content`,
    );
  }

  if (doc.request_body && typeof doc.request_body === 'object' && doc.request_body.request) {
    checkEvent(`${file} request_body.request`, doc.request_body.request, {
      expectValidSig: kase !== 'bad_signature',
      kindName: 'K_LEASE_REQUEST',
    });
    report(Object.keys(doc.request_body).length === 1, `${file}: the body has no key besides request`);
    const rebuilt = roundTrip(`${file} request_body.request`, doc.request_body.request, {
      expectSameSig: kase !== 'bad_signature',
    });
    if (rebuilt && kase !== 'bad_signature') {
      report(canonical({ request: rebuilt }) === canonical(doc.request_body), `${file}: request_body rebuilt from the rebuilt event matches`);
    }
  }

  // A Standby Set (spec §6.2 step 3, §7): ONE signed spawn reaches every
  // member, so the request is identical at all of them and the ROLE comes
  // from this provider's position in `standby_set` together with the route it
  // arrived on. Index 0 is the primary, arrives on `.spawn` and runs the
  // workload; any other index is a Warm Standby, arrives on `.standby` and
  // runs nothing, which is why its answer carries no `access`.
  if (surface === 'spawn' && (kase === 'primary' || kase === 'standby')) {
    const content = JSON.parse(doc.request_body.request.content);
    const set = content.standby_set ?? [];
    const index = set.indexOf(constants.provider.public_key);
    report(index >= 0, `${file}: the standby_set names the fixture provider`);
    report(
      JSON.stringify(tagValues(doc.request_body.request, 'p')) === JSON.stringify(set),
      `${file}: one p tag per member, in the set's order`,
    );
    const onStandbyRoute = doc.http_path.endsWith('/standby');
    report(
      kase === 'primary' ? index === 0 && !onStandbyRoute : index > 0 && onStandbyRoute,
      `${file}: index ${index} matches the ${onStandbyRoute ? '.standby' : '.spawn'} route`,
    );
    report(doc.response_body.role === kase, `${file}: the answer's role is ${kase}`);
    report(
      kase === 'standby'
        ? doc.response_body.access === undefined
        : doc.response_body.access !== undefined,
      `${file}: a standby answers no access, a primary answers its own`,
    );
    report(
      doc.response_body.workload_id === content.workload_id,
      `${file}: the answer names the workload id the whole set shares`,
    );
  }

  if (surface === 'error') {
    const body = doc.response_body;
    report(
      canonical(Object.keys(body).sort()) === canonical(['error', 'message']),
      `${file}: response body is exactly { error, message }`,
    );
    report(ERROR_CODES.includes(body.error), `${file}: error ${JSON.stringify(body.error)} is a spec §5 code`);
    report(body.error === kase, `${file}: response error code is ${kase}`);
    report(typeof body.message === 'string' && body.message.length > 0, `${file}: response carries a message`);
    report(Number.isInteger(doc.response_status) && doc.response_status >= 400 && doc.response_status <= 499, `${file}: response_status is a 4xx (this provider's; a tenant reads error, not the status)`);
  }

  // Availability answers 200 either way; a refusal is the answer, with a §5
  // code, not a transport failure.
  if (surface === 'availability') {
    report(doc.response_status === 200, `${file}: availability answers HTTP 200`);
    const body = doc.response_body;
    if (body.would_run === true) {
      report(canonical(body) === canonical({ would_run: true }), `${file}: a positive answer is exactly { would_run: true }`);
    } else {
      report(body.would_run === false, `${file}: would_run is false`);
      report(
        canonical(Object.keys(body).sort()) === canonical(['error', 'message', 'would_run']),
        `${file}: a refusal is exactly { would_run, error, message }`,
      );
      report(ERROR_CODES.includes(body.error), `${file}: error ${JSON.stringify(body.error)} is a spec §5 code`);
    }
    const image = doc.request_body.image;
    report(image !== undefined && /^sha256:[0-9a-f]{64}$/.test(image.digest), `${file}: request carries the spawn's image object (ADR 0015)`);
    const askKeys = canonical(Object.keys(doc.request_body).sort());
    report(
      askKeys === canonical(['image', 'listing', 'version']) ||
        askKeys === canonical(['image', 'listing', 'role', 'version']),
      `${file}: request body is exactly { listing, version, image } plus §6.4's optional role`,
    );
    if ('role' in doc.request_body) {
      report(
        ['primary', 'standby'].includes(doc.request_body.role),
        `${file}: role is "primary" | "standby", the whole vocabulary §6.4 asks about`,
      );
    }
  }

  // A lease's state on the wire (§6.7): a string, or a one-key { ended } object.
  if (doc.response_body && doc.response_status === 200 && 'state' in doc.response_body) {
    const state = doc.response_body.state;
    const ok =
      ['provisioning', 'reserved', 'running', 'stopped'].includes(state) ||
      (state !== null && typeof state === 'object' && canonical(Object.keys(state)) === canonical(['ended']) &&
        ['expiry', 'termination', 'eviction'].includes(state.ended));
    report(ok, `${file}: state is "provisioning" | "reserved" | "running" | "stopped" | { "ended": <how> }`);
  }
}

// The routes a Listing generates: derive them from the Listing events and
// the Profile, and compare with the provider's own table.
{
  const profile = load('directory.profile.json');
  const table = load('routes.listing.json').routes;
  const routes = new Set(table.map((r) => r.prefix));
  const priced = new Map(table.map((r) => [r.prefix, r]));
  const addr = profile.content.ilp_address;
  for (const file of files.filter((f) => f.startsWith('directory.listing'))) {
    const listing = load(file);
    const name = tagValue(listing.event, 'd');
    const version = listing.content.version;
    for (const op of ['spawn', 'extend']) {
      const prefix = `${addr}.${name}.v${version}.${op}`;
      report(routes.has(prefix), `${file}: derives to route ${prefix}`);
    }
    // The standby routes exist for exactly the listings that price them
    // (§4.2, §5): `standby_price` present means both rows at that price,
    // absent means neither — a connector must never terminate a route the
    // provider did not price, and it must never sell held capacity free.
    const standbyPrice = listing.content.standby_price;
    for (const op of ['standby', 'standby.extend']) {
      const prefix = `${addr}.${name}.v${version}.${op}`;
      const row = priced.get(prefix);
      if (standbyPrice === undefined) {
        report(row === undefined, `${file}: prices no standby, so there is no route ${prefix}`);
      } else {
        report(row?.price === standbyPrice, `${file}: derives to route ${prefix} at standby_price ${standbyPrice}`);
      }
    }
    report(
      tagValue(listing.event, 'a') === `${constants.kinds.K_PROFILE}:${profile.event.pubkey}:`,
      `${file}: a tag points at the Profile coordinate`,
    );
  }
  for (const free of ['availability', 'status', 'terminate']) {
    report(routes.has(`${addr}.${free}`), `routes.listing: has the free route ${addr}.${free}`);
  }
}

console.log(`\n${files.length} fixtures, ${checks} checks, ${failures} failure${failures === 1 ? '' : 's'}`);
process.exit(failures ? 1 : 0);
