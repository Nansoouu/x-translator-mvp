// ESLint configuration for x-translator-mvp frontend

module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:next/core-web-vitals',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: [
    '@typescript-eslint',
    'react',
    'react-hooks',
    'next',
  ],
  settings: {
    react: {
      version: 'detect',
    },
  },
  ignorePatterns: [
    '.next/',
    'node_modules/',
    'out/',
    '.eslintrc.cjs',
  ],
  rules: {
    // TypeScript
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/consistent-type-exports': 'error',
    
    // React
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react/jsx-uses-react': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    
    // Next.js
    'next/core-web-vitals': 'error',
    'next/next-script-for-ga': 'off',
    
    // General
    'no-console': 'warn',
    'no-debugger': 'warn',
    'no-unused-vars': 'off', // Handled by @typescript-eslint
    'no-empty': 'off', // Handled by @typescript-eslint
    
    // Import sorting
    'import/order': [
      'error',
      {
        groups: [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index',
          'type',
        ],
        'warn-on-unassigned': true,
        'newlines-between': 'always',
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
    
    // Quotes
    quotes: ['error', 'double', { avoidEscape: true }],
    'jsx-quotes': ['error', 'double'],
    
    // Semicolons
    semi: ['error', 'always'],
    
    // Trailing commas
    'comma-dangle': ['error', 'always-multiline'],
    
    // Indentation
    indent: ['error', 2, { SwitchCase: 1 }],
    
    // Spacing
    'space-infix-ops': 'error',
    'space-before-blocks': 'error',
    'keyword-spacing': 'error',
    
    // Max line length
    'max-len': ['error', 120, { ignoreUrls: true, ignoreStrings: true }],
    
    // No newlines at end of files
    'eol-last': ['error', 'always'],
  },
  overrides: [
    {
      files: ['*.test.ts', '*.test.tsx', '*.spec.ts', '*.spec.tsx'],
      env: {
        jest: true,
        node: true,
      },
      plugins: ['jest'],
      extends: ['plugin:jest/recommended'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
};