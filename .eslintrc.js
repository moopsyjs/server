module.exports = {
  "env": {
    "browser": true,
    "es2021": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended"
  ],
  "overrides": [
    {
      "env": {
        "node": true
      },
      "files": [
        ".eslintrc.{js,cjs}"
      ],
      "parserOptions": {
        "sourceType": "script"
      }
    }
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": "latest",
    "sourceType": "module",
    "project": "./tsconfig.json"
  },
  "plugins": [
    "promise",
    "@typescript-eslint",
    "react"
  ],
  "rules": {
    "@typescript-eslint/explicit-member-accessibility": [
      "error",
      {
        "accessibility": "explicit",
      }
    ],
    "@typescript-eslint/no-confusing-void-expression": "error",
    "@typescript-eslint/no-confusing-non-null-assertion": "error",
    "@typescript-eslint/method-signature-style": ["error", "property"],
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/consistent-type-assertions": ["error", {assertionStyle:"never"}],
    "@typescript-eslint/consistent-indexed-object-style": "error",
    "@typescript-eslint/consistent-generic-constructors": ["error", "type-annotation"],
    "@typescript-eslint/class-literal-property-style": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/adjacent-overload-signatures": "error",
    "@typescript-eslint/no-inferrable-types": 0,
    "@typescript-eslint/typedef": [
      "error",
      {
        "variableDeclaration": true,
      }
    ],
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-explicit-any": "off",
    "promise/no-return-wrap": "error",
    "promise/param-names": "error",
    "promise/catch-or-return": "error",
    "promise/no-native": "off",
    "promise/no-nesting": "warn",
    "promise/no-promise-in-callback": "warn",
    "promise/no-callback-in-promise": "warn",
    "promise/no-new-statics": "error",
    "promise/no-return-in-finally": "warn",
    "promise/valid-params": "warn",		
    "indent": [
      "error",
      2
    ],
    "linebreak-style": [
      "error",
      "unix"
    ],
    "quotes": [
      "error",
      "double"
    ],
    "semi": [
      "error",
      "always"
    ]
  }
};
