/*
  Hand written CSS may not hard-code colour, spacing, radius, type size or shadow: those values
  come from the tokens through var(--token). The token files (src/web/styles/tokens.css, and
  src/app/styles/tokens.css for the new app) are the only files allowed to define raw values.
  Tailwind at-rules are allowed.
*/
export const strictProperties = [
  '/(^|-)color$/',
  'background',
  'fill',
  'stroke',
  '/^(padding|margin)(-|$)/',
  '/^(row-|column-)?gap$/',
  '/^(top|right|bottom|left|inset)(-|$)/',
  '/radius$/',
  'font-size',
  'box-shadow',
]

export default {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
    'scale-unlimited/declaration-strict-value': [
      strictProperties,
      {
        ignoreValues: [
          'transparent',
          'inherit',
          'initial',
          'unset',
          'currentcolor',
          'none',
          'auto',
          '0',
          '100%',
        ],
        ignoreFunctions: false,
        disableFix: true,
        message:
          'Use a token: var(--token) from tokens.css, not a raw value "${value}" for "${property}". See CONTRIBUTING.md.',
      },
    ],
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'theme',
          'utility',
          'custom-variant',
          'variant',
          'apply',
          'source',
          'plugin',
          'config',
          'reference',
          'tailwind',
          'layer',
          'slot',
        ],
      },
    ],
    'import-notation': 'string',
    // oklch() values are written the way the design tools print them.
    'lightness-notation': null,
    'hue-degree-notation': null,
    'color-function-notation': null,
    'alpha-value-notation': null,
    // Tailwind's own at-rules and resets.
    'at-rule-prelude-no-invalid': null,
    'property-no-vendor-prefix': null,
    'value-keyword-case': null,
    'custom-property-pattern': null,
    'selector-class-pattern': null,
    'declaration-property-value-no-unknown': null,
    'at-rule-empty-line-before': null,
    'function-no-unknown': [true, { ignoreFunctions: ['theme', '--value', '--modifier'] }],
    // A Tailwind @utility or @custom-variant is a scoping root, so `&` and declarations may nest
    // inside it.
    'nesting-selector-no-missing-scoping-root': [
      true,
      { ignoreAtRules: ['utility', 'custom-variant'] },
    ],
    'no-invalid-position-declaration': [true, { ignoreAtRules: ['utility'] }],
  },
  overrides: [
    {
      files: ['src/web/styles/tokens.css', 'src/app/styles/tokens.css'],
      rules: { 'scale-unlimited/declaration-strict-value': null },
    },
  ],
}
