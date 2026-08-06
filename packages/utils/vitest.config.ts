import { mergeConfig } from 'vitest/config'
import { sharedVitest } from '../../vitest.config.shared'

export default mergeConfig(sharedVitest, {
  test: {
    include: ['src/**/*.test.ts'],
  },
})
