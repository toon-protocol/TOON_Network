#!/usr/bin/env node
// Checks the wire fixtures the way a tenant implementation would, with
// nothing but Node's standard library. It is the round trip a tenant client
// needs (TOON_Network #16, acceptance criterion 4), in both directions:
//
//   verify   every event's `id` is the SHA-256 of its NIP-01 serialization,
//            every `sig` is a valid BIP-340 Schnorr signature over that id by
//            `pubkey`, every event is the kind its `kind_name` says, every
//            error body is `{ error, message }` with a spec §5 code, and the
//            routes in `routes.listing` are the ones the Listing events
//            derive to — the paid `.spawn` and `.extend` of every Listing,
//            plus `.standby` and `.standby.extend` at `standby_price` for
//            exactly the Listings that carry one; a Profile that declares
//            `hidden` carries no `host` while every Listing of that provider
//            carries the `hidden:true` label, and no other Listing does; and
//            a lease of a hidden provider is reached at a `.anyone` host of
//            its own, on the same ports a public lease gets, with no IP
//            anywhere in the answer;
//   requests every Lease Request is a plain JSON object of exactly the six
//            keys spec §6.1 names, signed by nobody, addressed to the one
//            fixture provider, inside the window, with a 32-byte
//            `request_id` and a `continuation` that is the token the
//            fixture tenant's root secret derives for that provider —
//            recomputed here with Node's own HKDF, so a second
//            implementation checks its derivation against the reference's
//            rather than against a copied constant; a request that asserts a
//            `gateway_expires_at` presents instead the Gateway Grant that
//            token derives for that moment (§6.5.1), recomputed the same way,
//            and is answered exactly what the tenant was answered; and every
//            packet body is exactly `{ "request": <request> }`;
//   produce  from the test keys in `constants.json`, every event is rebuilt
//            from its fields and signed with all-zero auxiliary randomness,
//            and the result must have the same `id` and the same `sig` byte
//            for byte.
//
//     node docs/spec/fixtures/check.mjs            # checks ./wire
//     node docs/spec/fixtures/check.mjs <dir>      # checks another copy
//
// Exit code 0 when everything passes, 1 otherwise. The secp256k1 arithmetic
// below is a plain BigInt implementation for checking fixtures only: slow,
// not constant-time, and not for use anywhere a real key is handled. The
// signing half exists so that the fixture signatures are shown to be
// reproducible from the published keys; real signers use fresh randomness.

import { createHash, hkdfSync } from 'node:crypto';
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
  'expired', 'not_standby', 'not_running', 'stale_request', 'bad_grant',
];

/** Spec §4.4's GPU label grammar: `gpu:<vendor>-<model>`, where the value
 *  after `gpu:` matches `[a-z0-9]+(-[a-z0-9]+)*` in full and the vendor is
 *  one of the fixed, amendable list. */
const GPU_VENDORS = ['nvidia', 'amd', 'intel', 'apple'];
const GPU_LABEL = new RegExp(`^gpu:(?:${GPU_VENDORS.join('|')})-[a-z0-9]+(?:-[a-z0-9]+)*$`);

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

// Spec §7.2's normative timing table, checked against the `timing` block the
// reference provider's own constants produced (TOON_Network #71). Every
// value here but `liveness_cadence_s` — the one row a provider chooses, in
// its Profile — is fixed by the protocol, so a second implementation that
// disagrees with any of them is checked here rather than discovered on the
// wire.
{
  const timing = constants.timing;
  const TABLE = {
    liveness_expiry_cadences: 5,
    takeover_trigger_cadences: 1,
    settle_window_cadences: 2,
    self_stop_cadences: 5,
    request_window_s: 300,
    sweep_interval_s: 30,
  };
  report(
    Number.isInteger(timing?.liveness_cadence_s) && timing.liveness_cadence_s > 0,
    'constants.timing: liveness_cadence_s is a positive integer (the provider\'s own Profile value)',
  );
  for (const [key, value] of Object.entries(TABLE)) {
    report(timing?.[key] === value, `constants.timing: ${key} is ${value} (spec §7.2)`);
  }
  // The invariant spec §7.2 states: self-stop (5c) <= liveness expiry +
  // trigger (6c) < Takeover start (6c + 2c = 8c). Checked on the fixture's
  // own values rather than assumed, so a future change to any one of them
  // that breaks the invariant fails here first.
  const selfStop = timing?.self_stop_cadences;
  const trigger = timing?.liveness_expiry_cadences + timing?.takeover_trigger_cadences;
  const takeoverStart = trigger + timing?.settle_window_cadences;
  report(
    selfStop <= trigger && trigger < takeoverStart,
    `constants.timing: the invariant self-stop (${selfStop}c) <= liveness expiry + trigger (${trigger}c) < Takeover start (${takeoverStart}c) holds`,
  );
}

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

function checkEvent(where, event, { kindName } = {}) {
  report(eventId(event) === event.id, `${where}: id is the sha256 of the NIP-01 serialization`);
  report(schnorrVerify(event.pubkey, event.id, event.sig), `${where}: BIP-340 signature verifies`);
  if (kindName) {
    report(constants.kinds[kindName] === event.kind, `${where}: kind ${event.kind} is ${kindName}`);
  }
}

/** Rebuild `event` from its fields, sign it with the test key its `pubkey`
 *  names and zero aux, and require the same `id` and `sig`. Returns the
 *  rebuilt event, or null when it could not be rebuilt. */
function roundTrip(where, event) {
  const secret = secretKeys[event.pubkey];
  report(secret !== undefined, `${where}: signed by one of constants.json's test keys`);
  if (secret === undefined) return null;
  const rebuilt = {
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
  };
  rebuilt.id = eventId(rebuilt);
  rebuilt.sig = schnorrSignZeroAux(secret, rebuilt.id);
  report(rebuilt.id === event.id, `${where}: rebuilt event has the same id`);
  report(rebuilt.sig === event.sig, `${where}: re-signing with zero aux gives the same sig byte for byte`);
  return rebuilt;
}

// An IP address in a string value. A Hidden Provider's answers must carry
// none — its whole claim is that a tenant never learns where it is (spec
// §10) — so the test is over every string in the body, not just the host.
const IPV4 = /(?:^|[^\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:[^\d.]|$)/;
const IPV6 = /(?:[0-9a-fA-F]{1,4}:){2,}[0-9a-fA-F]{0,4}|[0-9a-fA-F]{1,4}::/;

function* strings(value) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) yield* strings(item);
}

const namesAnAddress = (value) => [...strings(value)].some((s) => IPV4.test(s) || IPV6.test(s));

const hasTag = (event, cells) =>
  event.tags.some((t) => cells.every((c, i) => t[i] === c));
const tagValue = (event, name) => event.tags.find((t) => t[0] === name)?.[1];
const tagValues = (event, name) => event.tags.filter((t) => t[0] === name).map((t) => t[1]);

// The verifier must reject something, or every "ok" above is vacuous. The
// witness is a PUBLISHED event: nothing a tenant sends is signed any more
// (spec §6.1, ADR 0016).
{
  const good = load('directory.profile.json').event;
  const tampered = (good.sig[0] === '0' ? '1' : '0') + good.sig.slice(1);
  report(schnorrVerify(good.pubkey, good.id, tampered) === false, 'self-test: a tampered signature is rejected');
  report(schnorrVerify(good.pubkey, good.id, good.sig) === true, 'self-test: the untampered signature is accepted');
  // And the signer must produce something the verifier accepts, with a
  // different key giving a different signature.
  const other = schnorrSignZeroAux(constants.publisher.secret_key, good.id);
  report(schnorrVerify(constants.publisher.public_key, good.id, other), 'self-test: a signature this signer produces verifies');
  report(other !== good.sig, 'self-test: a different key gives a different signature');
}

// ── the Continuation Token (spec §6.1) ──────────────────────────────────────

/** `continuation(provider) = HKDF-SHA256(ikm = root, salt = empty,
 *  info = "toon-network-continuation:" || <provider pubkey hex>, L = 32)`,
 *  computed from Node's own HKDF rather than copied from the fixture. */
function continuationFor(rootSecretHex, providerPubkeyHex, infoPrefix) {
  const okm = hkdfSync(
    'sha256',
    Buffer.from(rootSecretHex, 'hex'),
    Buffer.alloc(0),
    Buffer.from(infoPrefix + providerPubkeyHex, 'ascii'),
    32,
  );
  return Buffer.from(okm).toString('hex');
}

/** `gateway_sub(provider, expires_at) = HKDF-SHA256(continuation(provider),
 *  "toon-network-gateway:" || expires_at)` (spec §6.5.1), with `expires_at` as
 *  unpadded decimal unix seconds. Node's own HKDF again, over the LEASE'S
 *  TOKEN rather than the tenant's root secret: a provider holds the token
 *  and not the root, which is how it recomputes a grant it was handed. */
function gatewaySubFor(continuationHex, expiresAt, infoPrefix) {
  const okm = hkdfSync(
    'sha256',
    Buffer.from(continuationHex, 'hex'),
    Buffer.alloc(0),
    Buffer.from(infoPrefix + String(expiresAt), 'ascii'),
    32,
  );
  return Buffer.from(okm).toString('hex');
}

const INFO_PREFIX = load('continuation.vector.json').info_prefix;
const GATEWAY_INFO_PREFIX = load('gateway_sub.vector.json').info_prefix;
const TENANT_TOKEN = continuationFor(
  constants.tenant.root_secret,
  constants.provider.public_key,
  INFO_PREFIX,
);
const OTHER_TOKEN = continuationFor(
  constants.other_tenant.root_secret,
  constants.provider.public_key,
  INFO_PREFIX,
);
/** The token a rotation installs (spec §6.8): what the FRESH root secret the
 *  fixture tenant minted to rotate derives at the fixture provider. */
const ROTATED_TOKEN = continuationFor(
  constants.rotated_tenant.root_secret,
  constants.provider.public_key,
  INFO_PREFIX,
);

{
  const vector = load('continuation.vector.json');
  report(
    constants.continuation.derivation.includes(`"${INFO_PREFIX}"`),
    'continuation.vector: constants.json states the same domain the vector derives under',
  );
  report(
    continuationFor(vector.root_secret, vector.provider_public_key, vector.info_prefix) === vector.continuation,
    'continuation.vector: the documented derivation reproduces the token',
  );
  report(
    continuationFor(vector.root_secret, vector.at_other_provider.provider_public_key, vector.info_prefix) ===
      vector.at_other_provider.continuation,
    'continuation.vector: the same root secret derives a DIFFERENT token at another provider',
  );
  report(
    vector.continuation !== vector.at_other_provider.continuation,
    'continuation.vector: one member of a Standby Set cannot hold another member\'s token (§7)',
  );
  report(
    constants.tenant.continuation_at_provider === TENANT_TOKEN,
    'constants: the tenant\'s published token is what its root secret derives at the fixture provider',
  );
  report(
    constants.rotated_tenant.continuation_at_provider === ROTATED_TOKEN,
    'constants: the rotated token is what the fresh root secret derives at the fixture provider',
  );
  report(
    new Set([TENANT_TOKEN, OTHER_TOKEN, ROTATED_TOKEN]).size === 3,
    'constants: the three root secrets derive three different tokens here',
  );
}

{
  const vector = load('gateway_sub.vector.json');
  report(
    vector.continuation === TENANT_TOKEN,
    'gateway_sub.vector: the grant is derived from the token the fixture tenant holds here',
  );
  report(
    gatewaySubFor(vector.continuation, vector.expires_at, vector.info_prefix) === vector.gateway_sub,
    'gateway_sub.vector: the documented derivation reproduces the grant',
  );
  report(
    gatewaySubFor(vector.continuation, vector.at_the_next_second.expires_at, vector.info_prefix) ===
      vector.at_the_next_second.gateway_sub,
    'gateway_sub.vector: the same token one second later derives the second grant',
  );
  report(
    vector.gateway_sub !== vector.at_the_next_second.gateway_sub,
    'gateway_sub.vector: a grant is bound to the one moment it names, so rotation is re-derivation (§6.5.1)',
  );
  report(
    vector.gateway_sub !== vector.continuation,
    'gateway_sub.vector: a grant is not the token it came from — it delegates reading, never the lease',
  );
}

/** Every Lease Request in the fixtures, checked against §6.1's shape: six
 *  keys, nothing signed, one provider, a 32-byte `request_id`, a window
 *  inside the 300 s bound, and the token this tenant derives for this
 *  provider. */
function checkLeaseRequest(where, request) {
  report(
    canonical(Object.keys(request).sort()) ===
      canonical(['content', 'continuation', 'expiration', 'op', 'provider', 'request_id']),
    `${where}: exactly { request_id, op, provider, expiration, continuation, content }`,
  );
  report(!('sig' in request) && !('pubkey' in request) && !('kind' in request), `${where}: nothing here is signed`);
  report(/^[0-9a-f]{64}$/.test(request.request_id), `${where}: request_id is 32 bytes of lowercase hex`);
  report(
    ['spawn', 'standby', 'status', 'terminate', 'rotate'].includes(request.op),
    `${where}: op is one of §6.1's five`,
  );
  report(request.provider === constants.provider.public_key, `${where}: provider names the fixture provider`);
  report(/^[0-9a-f]{64}$/.test(request.continuation), `${where}: continuation is 32 bytes of lowercase hex`);
  report(
    request.expiration - constants.now <= 300,
    `${where}: expiration is inside the 300 s request window`,
  );
  report(typeof request.content === 'object' && request.content !== null, `${where}: content is the op's JSON object`);
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
    checkLeaseRequest(`${file} request`, doc.request);
    if (kase === 'rotate') {
      // The token a rotation names is the one `rotate.ok` installs.
      report(doc.content.next === ROTATED_TOKEN, `${file}: next is the token the fresh root secret derives here`);
    }
    report(doc.request.op === kase, `${file}: op is ${kase}`);
    report(canonical(doc.content) === canonical(doc.request.content), `${file}: content is the request's own content object`);
    report(doc.request.continuation === TENANT_TOKEN, `${file}: presents the fixture tenant's token for this provider`);
    report(
      doc.request.expiration - constants.now === constants.lease_request_ttl_s,
      `${file}: expiration is now + ${constants.lease_request_ttl_s}`,
    );
    report(
      Object.keys(doc.packet_body).length === 1 && canonical(doc.packet_body.request) === canonical(doc.request),
      `${file}: packet_body is exactly { "request": <request> }`,
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
      // GPU labels (spec §4.2, §4.4, §11 item 1): `gpu:<vendor>-<model>` must
      // match the grammar and equal `resources.gpu` byte for byte, or the
      // Listing is not purchasable. A Listing with no `resources.gpu` carries
      // no `gpu:` label at all.
      const gpuLabels = tagValues(doc.event, 'l').filter((v) => v.startsWith('gpu:'));
      if (doc.content.resources?.gpu !== undefined) {
        report(gpuLabels.length === 1, `${file}: carries exactly one gpu: label when resources.gpu is set`);
        report(GPU_LABEL.test(gpuLabels[0]), `${file}: gpu: label matches gpu:<vendor>-<model> (§4.4)`);
        report(gpuLabels[0] === `gpu:${doc.content.resources.gpu}`, `${file}: gpu: label equals resources.gpu`);
      } else {
        report(gpuLabels.length === 0, `${file}: carries no gpu: label when resources.gpu is unset`);
      }
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
    if (kase.startsWith('blob_record')) {
      report(d === doc.content.digest, `${file}: d is the blob's digest`);
      report(tagValue(doc.event, 'x') === doc.content.digest.replace(/^sha256:/, ''), `${file}: x tag is the blob digest's hex`);

      // Exactly one of `parts` (inline) or `pages` (large blob, spec §8.2,
      // §11 item 2) — except the one fixture that exists to be the shape
      // this rule refuses.
      const hasParts = Array.isArray(doc.content.parts);
      const hasPages = Array.isArray(doc.content.pages);
      if (kase === 'blob_record.both_forms') {
        report(hasParts && hasPages, `${file}: carries BOTH parts and pages — the shape §8.2's one-of rule refuses`);
      } else {
        report(hasParts !== hasPages, `${file}: carries exactly one of parts or pages (§8.2, §11 item 2)`);
      }

      // The ordered part list, however this record carries it: `parts`
      // directly, or `pages` concatenated in order after each page's own
      // digest and part count are checked — exactly what a reader does
      // before trusting a single part from a page (§8.2).
      let parts = hasParts ? doc.content.parts : [];
      if (hasPages) {
        let pageParts = [];
        for (const [i, page] of doc.content.pages.entries()) {
          const bytes = doc.page_bytes?.[page.txid];
          report(typeof bytes === 'string', `${file}: page_bytes carries page ${i} (${page.txid})'s own bytes`);
          if (typeof bytes !== 'string') continue;
          const got = sha256(Buffer.from(bytes, 'utf8')).toString('hex');
          report(got === page.sha256, `${file}: page ${i} (${page.txid}) hashes to its recorded sha256`);
          let parsed = null;
          try {
            parsed = JSON.parse(bytes);
          } catch {
            /* reported below */
          }
          report(Array.isArray(parsed), `${file}: page ${i} (${page.txid})'s bytes are a JSON array of part objects`);
          if (Array.isArray(parsed)) {
            report(parsed.length === page.parts, `${file}: page ${i} (${page.txid}) lists its recorded parts count`);
            pageParts = pageParts.concat(parsed);
          }
        }
        if (!hasParts) parts = pageParts; // both_forms already has its own `parts`; leave it alone
      }

      if (parts.length > 0 && kase !== 'blob_record.both_forms') {
        const total = parts.reduce((sum, p) => sum + p.size, 0);
        report(total === doc.content.size, `${file}: the parts' sizes sum to the blob's size`);
        report(
          parts.slice(0, -1).every((p) => p.size === doc.content.part_size),
          `${file}: every part but the last is part_size bytes`,
        );
      }
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
      canonical(doc.request_body.request.content) === canonical(doc.spawn_content),
      `${file}: spawn_content is exactly the request's content`,
    );
  }

  if (doc.request_body && typeof doc.request_body === 'object' && doc.request_body.request) {
    checkLeaseRequest(`${file} request_body.request`, doc.request_body.request);
    report(Object.keys(doc.request_body).length === 1, `${file}: the body has no key besides request`);
    // Every request here presents a token the fixtures can name, and which
    // one says what the request is. `not_tenant` is the OTHER tenant's token
    // — the whole of what makes it a refusal — except after a rotation
    // (§6.8), where it is the fixture tenant's own token, replaced; and a
    // status after a rotation (`rotated`) presents the token that replaced
    // it. Everything else presents the token the lease was taken with.
    const request = doc.request_body.request;
    const token = request.continuation;
    const asserted = request.content?.gateway_expires_at;
    const code = kase.split('.')[0];
    const rotated = kase === 'rotated' || kase.endsWith('.rotated');
    if (asserted === undefined) {
      const [expected, what] =
        kase === 'not_tenant.rotated'
          ? [TENANT_TOKEN, 'the token the lease was taken with, which a rotation replaced']
          : code === 'not_tenant'
            ? [OTHER_TOKEN, 'the OTHER tenant\'s token, which this lease was not taken with']
            : rotated
              ? [ROTATED_TOKEN, 'the token the rotation installed']
              : [TENANT_TOKEN, 'the fixture tenant\'s token for this provider'];
      report(token === expected, `${file}: presents ${what}`);
    } else {
      // A WORKLOAD GATEWAY's request (spec §6.5.1): the value in `continuation`
      // is a Gateway Grant, and `gateway_expires_at` says which moment to
      // recompute it at. The field is named by `status` content and by
      // nothing else, which is why a gateway cannot reach `terminate` or
      // `rotate` with it at all: anywhere else it is `invalid_request`.
      report(
        request.op === 'status' || code === 'invalid_request',
        `${file}: gateway_expires_at is named by status content alone`,
      );
      // `now <= gateway_expires_at` admits the moment itself (§6.5.1 step 2):
      // `expires_at` is the last second a grant is good for, not the first
      // it is not.
      report(asserted >= constants.now, `${file}: the moment the request asserts has not passed`);
      const grant = gatewaySubFor(TENANT_TOKEN, asserted, GATEWAY_INFO_PREFIX);
      if (kase === 'bad_grant') {
        // Well formed, unexpired, and derived from a token this lease was
        // not taken with: the defect is not the shape, and the refusal is
        // `bad_grant` because the request ASSERTED a delegation — the same
        // value asserting none would hear `not_tenant`.
        report(token !== grant, `${file}: presents a value that is NOT the grant this lease's token derives for that moment`);
        report(
          token === gatewaySubFor(OTHER_TOKEN, asserted, GATEWAY_INFO_PREFIX),
          `${file}: it is the OTHER tenant's own grant, which delegates nothing here`,
        );
      } else if (kase === 'bad_grant.rotated') {
        // The very grant `status.delegated` was admitted with — refused now
        // because the token it derives from is no longer the lease's, and a
        // provider recomputes a grant from the token it stores (§6.5.1, §6.8).
        report(token === grant, `${file}: presents the grant the token the lease was taken with derives`);
        report(
          token !== gatewaySubFor(ROTATED_TOKEN, asserted, GATEWAY_INFO_PREFIX),
          `${file}: which is not the grant the token the lease holds now derives`,
        );
      } else {
        report(token === grant, `${file}: presents the Gateway Grant this lease's token derives for that moment`);
      }
    }

    // A rotation (spec §6.8): exactly { workload_id, next }, `next` a token,
    // and — on the one that is answered `rotated: true` — the token the fresh
    // root secret derives, which is not the one presented.
    if (request.op === 'rotate') {
      const content = request.content;
      if (code !== 'invalid_request') {
        report(
          canonical(Object.keys(content).sort()) === canonical(['next', 'workload_id']),
          `${file}: rotate content is exactly { workload_id, next }`,
        );
        report(/^[0-9a-f]{64}$/.test(content.next), `${file}: next is 32 bytes of lowercase hex`);
        report(content.next === ROTATED_TOKEN, `${file}: next is the token the fresh root secret derives here`);
        report(content.next !== token, `${file}: next is not the token the request presents`);
      }
      if (kase === 'invalid_request.rotate_malformed_next') {
        report(!/^[0-9a-f]{64}$/.test(content.next), `${file}: next is NOT 32 bytes of lowercase hex`);
      }
      if (kase === 'invalid_request.rotate_same_token') {
        report(content.next === token, `${file}: next IS the token the request presents, the lease's own`);
      }
      if (kase === 'stale_request.rotate_replay') {
        report(
          canonical(doc.request_body) === canonical(load('rotate.ok.json').request_body),
          `${file}: the request body is rotate.ok's, byte for byte`,
        );
      }
    }
  }

  // A rotation's answer confirms the lease and nothing more: no token, old or
  // new, is anywhere in it (spec §6.8).
  if (surface === 'rotate' && kase === 'ok') {
    const request = doc.request_body.request;
    report(
      canonical(doc.response_body) === canonical({ workload_id: request.content.workload_id, rotated: true }),
      `${file}: the answer is exactly { workload_id, rotated: true }`,
    );
    report(
      canonical(request) === canonical({ ...load('lease_request.rotate.json').request, request_id: request.request_id }),
      `${file}: the body is lease_request.rotate's request`,
    );
  }

  // Rotation replaces the token and changes nothing else: the new token reads
  // exactly what the old one read before the rotation (§6.8).
  if (surface === 'status' && kase === 'rotated') {
    report(
      canonical(doc.response_body) === canonical(load('status.running.json').response_body),
      `${file}: answered exactly what status.running answered before the rotation`,
    );
  }

  // No token — nor a grant of one — reaches an answer, a refusal's message
  // included (spec §6.1.1). Every token the fixtures know is looked for.
  if (doc.response_body !== undefined) {
    const answer = JSON.stringify(doc.response_body);
    const grantsAt = (t) => (doc.request_body?.request?.content?.gateway_expires_at === undefined
      ? []
      : [gatewaySubFor(t, doc.request_body.request.content.gateway_expires_at, GATEWAY_INFO_PREFIX)]);
    const secrets = [TENANT_TOKEN, OTHER_TOKEN, ROTATED_TOKEN].flatMap((t) => [t, t.toUpperCase(), ...grantsAt(t)]);
    report(!secrets.some((t) => answer.includes(t)), `${file}: no token or grant appears anywhere in the answer`);
  }

  // A grant delegates READING a lease, so the answer is the answer either
  // way: what the gateway is told is byte for byte what the tenant was told
  // in `status.running` (§6.5.1).
  if (surface === 'status' && kase === 'delegated') {
    report(
      canonical(doc.response_body) === canonical(load('status.running.json').response_body),
      `${file}: answered exactly what the tenant's own status was answered`,
    );
  }

  // A Standby Set (spec §6.2 step 3, §7): the tenant sends the same spawn
  // CONTENT to every member, but a request of its own to each — naming only
  // that member and presenting only that member's token — so the ROLE comes
  // from this provider's position in `standby_set` together with the route it
  // arrived on. Index 0 is the primary, arrives on `.spawn` and runs the
  // workload; any other index is a Warm Standby, arrives on `.standby` and
  // runs nothing, which is why its answer carries no `access`.
  if (surface === 'spawn' && (kase === 'primary' || kase === 'standby')) {
    const request = doc.request_body.request;
    const content = request.content;
    const set = content.standby_set ?? [];
    const index = set.indexOf(constants.provider.public_key);
    report(index >= 0, `${file}: the standby_set names the fixture provider`);
    report(
      request.provider === constants.provider.public_key,
      `${file}: the request names this member alone, whatever the set says`,
    );
    const onStandbyRoute = doc.http_path.endsWith('/standby');
    report(
      request.op === (onStandbyRoute ? 'standby' : 'spawn'),
      `${file}: op is the one the ${onStandbyRoute ? '.standby' : '.spawn'} route serves`,
    );
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
    // The case is the code, then — where one code has several fixtures, as
    // rotation's refusals do (§6.8) — a dot and which of them this is.
    const code = kase.split('.')[0];
    report(body.error === code, `${file}: response error code is ${code}`);
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

  // Where a lease is reached (§6.2, §6.5). On a HIDDEN PROVIDER (§10) the
  // host is a `.anyone` address belonging to that one lease — the provider
  // published none of its own — and on every other provider it is the
  // provider's host, never a `.anyone` name. The ports do not move either
  // way: a tenant dials `ssh_port` and each `host_port` on whichever host it
  // was given, so the hidden answer is the public one with the host swapped
  // and nothing else changed.
  if ((surface === 'spawn' || surface === 'status') && doc.response_body?.access) {
    const access = doc.response_body.access;
    const hidden = kase.endsWith('.hidden');
    report(
      hidden ? /^[a-z2-7]+\.anyone$/.test(access.host) : !String(access.host).endsWith('.anyone'),
      hidden
        ? `${file}: access.host is the lease's own .anyone address`
        : `${file}: access.host is the provider's own host, not a .anyone address`,
    );
    if (hidden) {
      report(!namesAnAddress(doc.response_body), `${file}: no IP address anywhere in the answer`);
      const open = load(file.replace(/\.hidden\.json$/, '.json')).response_body.access;
      report(
        canonical({ ...access, host: null }) === canonical({ ...open, host: null }),
        `${file}: the same ssh_port and ports the public answer gives — only the host differs`,
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
  for (const free of ['availability', 'status', 'terminate', 'rotate']) {
    report(routes.has(`${addr}.${free}`), `routes.listing: has the free route ${addr}.${free}`);
  }
}

console.log(`\n${files.length} fixtures, ${checks} checks, ${failures} failure${failures === 1 ? '' : 's'}`);
process.exit(failures ? 1 : 0);
