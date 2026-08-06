import { mergeConfig } from 'vitest/config'
import { sharedVitest } from '../../vitest.config.shared'

export default mergeConfig(
  sharedVitest,
  {
    test: {
      include: ['src/**/*.test.ts'],
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/oncall',
      },
    },
  },
)
