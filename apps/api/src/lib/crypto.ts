import crypto from 'node:crypto';
import { config } from '../config.js';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function generateSixDigitCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// Ed25519 manifest signing keys
interface SigningKeys {
  privateKey: crypto.KeyObject;
  publicKeyPem: string;
}

let cachedKeys: SigningKeys | null = null;

function getSigningKeys(): SigningKeys {
  if (cachedKeys) return cachedKeys;

  if (config.MANIFEST_PRIVATE_KEY_B64 && config.MANIFEST_PUBLIC_KEY_B64) {
    const privPem = Buffer.from(config.MANIFEST_PRIVATE_KEY_B64, 'base64').toString('utf8');
    const pubPem = Buffer.from(config.MANIFEST_PUBLIC_KEY_B64, 'base64').toString('utf8');
    cachedKeys = {
      privateKey: crypto.createPrivateKey(privPem),
      publicKeyPem: pubPem,
    };
    return cachedKeys;
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  cachedKeys = {
    privateKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  return cachedKeys;
}

export function signManifest(payloadJson: string): {
  kid: string;
  signatureB64: string;
  publicKeyB64: string;
} {
  const keys = getSigningKeys();
  const signature = crypto.sign(null, Buffer.from(payloadJson, 'utf8'), keys.privateKey);
  return {
    kid: config.MANIFEST_KEY_ID,
    signatureB64: signature.toString('base64'),
    publicKeyB64: Buffer.from(keys.publicKeyPem, 'utf8').toString('base64'),
  };
}
