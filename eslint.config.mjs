import next from 'eslint-config-next/core-web-vitals'
import ts from 'eslint-config-next/typescript'

const config = [
  { ignores: ['.next/**', 'node_modules/**', '.data/**', 'drizzle/**', 'next-env.d.ts', '.superpowers/**'] },
  ...next,
  ...ts,
  {
    rules: {
      '@next/next/no-img-element': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]

export default config
