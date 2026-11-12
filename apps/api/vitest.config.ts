import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { mergeConfig } from 'vitest/config'
import { sharedVitest } from '../../vitest.config.shared'

const envFile = resolve(import.meta.dirname, '.env')
const fileEnv = existsSync(envFile) ? parse(readFileSync(envFile)) : {}

export default mergeConfig(
  sharedVitest,
  {
    test: {
      include: ['src/**/*.test.ts'],
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL:
          process.env.DATABASE_URL ?? fileEnv.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/oncall',
        JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-chars-long',
      },
    },
  },
)
