#!/usr/bin/env node
// Checks the wire fixtures the way a tenant implementation would, with
// nothing but Node's standard library: every event's `id` is the SHA-256 of
// its NIP-01 serialization, every `sig` is a valid BIP-340 Schnorr signature
// over that id by `pubkey` (or invalid, for the one case that requires it),
// every signed request body is exactly `{ "request": <event> }`, every event
// is the kind its `kind_name` says, and the routes in `routes.listing` are the
// ones the Listing events derive to — the paid `.spawn` and `.extend` of
// every Listing, plus `.standby` and `.standby.extend` at `standby_price` for
// exactly the Listings that carry one.
//
//     node docs/spec/fixtures/check.mjs            # checks ./wire
//     node docs/spec/fixtures/check.mjs <dir>      # checks another copy
//
// Exit code 0 when everything passes, 1 otherwise. The secp256k1 arithmetic
// below is a plain BigInt implementation for verification only: slow, and
// not for use anywhere a signature is produced or a key is handled.

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

// ── NIP-01 ──────────────────────────────────────────────────────────────────

/** The string whose SHA-256 is the event id. JSON.stringify escapes exactly
 *  as NIP-01 requires (backslash, quote, and the control characters). */
const nip01Serialization = (e) => JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
const eventId = (e) => sha256(Buffer.from(nip01Serialization(e), 'utf8')).toString('hex');

// ── the checks ──────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? join(here, 'wire');
const load = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

let failures = 0;
function report(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures += 1;
}

const constants = load('constants.json');

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

const hasTag = (event, cells) =>
  event.tags.some((t) => cells.every((c, i) => t[i] === c));
const tagValue = (event, name) => event.tags.find((t) => t[0] === name)?.[1];

// The verifier must reject something, or every "ok" above is vacuous.
{
  const good = load('lease_request.spawn.json').event;
  const tampered = (good.sig[0] === '0' ? '1' : '0') + good.sig.slice(1);
  report(schnorrVerify(good.pubkey, good.id, tampered) === false, 'self-test: a tampered signature is rejected');
  report(schnorrVerify(good.pubkey, good.id, good.sig) === true, 'self-test: the untampered signature is accepted');
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
    report(hasTag(doc.event, ['L', constants.label]), `${file}: carries ["L", "${constants.label}"]`);
    // A Takeover (spec §7.1) is addressed by the workload id the whole
    // Standby Set shares, and names the primary it claims from. The signer
    // is the STANDBY: a primary never announces its own takeover.
    if (kase === 'takeover') {
      report(tagValue(doc.event, 'd') === doc.content.workload_id, `${file}: d is the workload id`);
      report(doc.content.primary === constants.primary_provider.public_key, `${file}: primary is the set's index 0`);
      report(doc.event.pubkey !== doc.content.primary, `${file}: the standby signs it, not the primary`);
    }
  }

  // The Image Registry entry, the Blob Record and the Template (spec §8) are
  // signed by a PUBLISHER, never by a provider, and each carries the same
  // label. The two that are addressed by a digest must agree with it in both
  // their `d` and their `x` tag, or a relay's `#x` filter could be made to
  // serve a record describing a different blob.
  if (surface === 'registry') {
    report(doc.event.pubkey === constants.publisher.public_key, `${file}: signed by the fixture publisher, not the provider`);
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
  }

  if (surface === 'error') {
    report(doc.response_body.error === kase, `${file}: response error code is ${kase}`);
    report(typeof doc.response_body.message === 'string', `${file}: response carries a message`);
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

console.log(`\n${files.length} fixtures, ${failures} failure${failures === 1 ? '' : 's'}`);
process.exit(failures ? 1 : 0);
