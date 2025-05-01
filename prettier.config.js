/**
 * @type {import('prettier').Config}
 */
const config = {
  semi: true,
  trailingComma: 'all',
  singleQuote: true,
  printWidth: 120,
  tabWidth: 2,
  plugins: [
    '@trivago/prettier-plugin-sort-imports',
  ],
  importOrder: [
    '^(viem|abitype|js-yaml)',
    '^\\.',
  ],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
};
export default config;
