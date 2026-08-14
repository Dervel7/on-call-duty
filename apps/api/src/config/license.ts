import { existsSync, readFileSync } from 'node:fs'
import { createPublicKey, verify as verifySignature } from 'node:crypto'
import { env } from './env'
import { LICENSE_PUBLIC_KEY } from './license-public-key'

export interface License {
  licensee: string
  doctorAllowance: number
  rollingWindowDays: number
  expiresAt: string | null
}

interface LicenseClaims {
  licensee: string
  doctor_allowance: number
  rolling_window_days: number
  exp?: number
}

const DEFAULT_ALLOWANCE = 25
const DEFAULT_WINDOW_DAYS = 90

/**
 * Verify an EdDSA (Ed25519) JWT and return its claims. jsonwebtoken does not
 * support EdDSA (its jws backend rejects the algorithm), so the signature is
 * verified directly with node:crypto. The token format is a standard JWS
 * compact serialization and remains interoperable with conformant libraries.
 */
function verifyEdDSA(token: string, publicKeyPem: string): LicenseClaims {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('malformed token')
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as {
    alg?: string
  }
  if (header.alg !== 'EdDSA') {
    throw new Error(`unexpected algorithm: ${header.alg ?? 'missing'}`)
  }
  const key = createPublicKey(publicKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('license public key is not an Ed25519 key')
  }
  const valid = verifySignature(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    key,
    Buffer.from(encodedSignature, 'base64url'),
  )
  if (!valid) {
    throw new Error('invalid signature')
  }
  const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as LicenseClaims
  if (typeof claims.licensee !== 'string' || typeof claims.doctor_allowance !== 'number' || typeof claims.rolling_window_days !== 'number') {
    throw new Error('invalid license claims')
  }
  if (claims.exp !== undefined && claims.exp * 1000 < Date.now()) {
    throw new Error('license expired')
  }
  return claims
}

function loadLicense(): License {
  const path = env.LICENSE_FILE
  if (!path || !existsSync(path)) {
    if (env.NODE_ENV === 'production') {
      console.error(`License file not found: ${path || 'LICENSE_FILE is unset'}`)
      process.exit(1)
    }
    return {
      licensee: 'development',
      doctorAllowance: DEFAULT_ALLOWANCE,
      rollingWindowDays: DEFAULT_WINDOW_DAYS,
      expiresAt: null,
    }
  }
  const token = readFileSync(path, 'utf8').trim()
  try {
    const claims = verifyEdDSA(token, LICENSE_PUBLIC_KEY)
    return {
      licensee: claims.licensee,
      doctorAllowance: claims.doctor_allowance,
      rollingWindowDays: claims.rolling_window_days,
      expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    }
  } catch (err) {
    console.error('Invalid or expired license:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

export const license = loadLicense()
