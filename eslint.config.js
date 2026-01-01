import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import globals from "globals";
import vue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";

const tsRecommended = tsPlugin.configs["flat/recommended"];
const tsRecommendedRules = Object.assign({}, ...tsRecommended.map((cfg) => cfg.rules ?? {}));
const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const tsRecommendedForTsFiles = tsRecommended.map((cfg) => (cfg.files ? cfg : { ...cfg, files: tsFiles }));

const vueCompilerMacroGlobals = {
  defineProps: "readonly",
  defineEmits: "readonly",
  defineExpose: "readonly",
  defineSlots: "readonly",
  defineModel: "readonly",
  withDefaults: "readonly",
};

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    ignores: [
      "**/.jscpd/**",
      "**/.cache/**",
      "**/dist/**",
      "**/dist-perf-audit-*/**",
      "**/node_modules/**",
      "**/recovery/**",
      "target/**",
      "target-perf-audit-*/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
    ],
  },

  js.configs.recommended,

  ...vue.configs["flat/recommended"],
  ...tsRecommendedForTsFiles,

  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: [".vue"],
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...vueCompilerMacroGlobals,
      },
    },
    plugins: {
      vue,
      "@typescript-eslint": tsPlugin,
    },
    rules: tsRecommendedRules,
  },

  {
    files: ["src/**/*.{js,mjs,ts,tsx,vue}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...vueCompilerMacroGlobals,
      },
    },
  },
  {
    files: [
      "scripts/**/*.{js,mjs,cjs,ts}",
      "tools/**/*.{js,mjs,cjs,ts}",
      "*.{js,mjs,cjs}",
      "postcss.config.cjs",
      "tailwind.config.cjs",
      "vite.config.ts",
      "vitest.config.ts",
      "vitest.setup.ts",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,vue}"],
    rules: prettier.rules,
  },

  {
    files: ["**/*.{ts,tsx,vue}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "vue/v-on-event-hyphenation": "off",
      "vue/multi-word-component-names": "off",
      "vue/no-reserved-component-names": "off",
      "vue/one-component-per-file": "off",
    },
  },

  {
    files: ["**/*.{spec,test}.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },

  {
    files: ["src/composables/main-app/presets/usePresetLibraryActions.ts"],
    rules: {
      "no-control-regex": "off",
    },
  },

  {
    files: ["src/**/*.{ts,tsx,vue}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              importNames: ["invoke"],
              message:
                "Use invokeCommand() from src/lib/backend/invokeCommand.ts instead of importing invoke directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx,vue}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              importNames: ["invoke"],
              message:
                "Use invokeCommand() from src/lib/backend/invokeCommand.ts instead of importing invoke directly.",
            },
            {
              name: "@/MainApp.setup",
              importNames: ["useMainAppContext"],
              message:
                "Do not access the global MainAppContext bag from UI components; use domain hooks (useQueueDomain/usePresetsDomain/...) and explicit orchestrators.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/main/**/*Host.vue"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              importNames: ["invoke"],
              message:
                "Use invokeCommand() from src/lib/backend/invokeCommand.ts instead of importing invoke directly.",
            },
            {
              name: "@/MainApp.setup",
              importNames: [
                "useMainAppContext",
                "useShellDomain",
                "useDialogsDomain",
                "useQueueDomain",
                "usePresetsDomain",
                "useSettingsDomain",
                "useMediaDomain",
                "usePreviewDomain",
              ],
              message: "Do not import domain hooks from Host components; use orchestrators instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/main/**/*Shell.vue"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              importNames: ["invoke"],
              message:
                "Use invokeCommand() from src/lib/backend/invokeCommand.ts instead of importing invoke directly.",
            },
            {
              name: "@/MainApp.setup",
              importNames: [
                "useMainAppContext",
                "useShellDomain",
                "useDialogsDomain",
                "useQueueDomain",
                "usePresetsDomain",
                "useSettingsDomain",
                "useMediaDomain",
                "usePreviewDomain",
              ],
              message:
                "Do not import MainApp domain hooks from Shell components; use orchestrators instead to keep the shell assembly-only.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/backend/invokeCommand.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },

  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    files: ["tools/docs-screenshots/**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  {
    files: [
      "tools/docs-screenshots/mocks/**/*.{ts,tsx,js,mjs,cjs}",
      "scripts/generate-ffmpeg-command-corpus-fixture.mjs",
    ],
    rules: {
      "no-useless-escape": "off",
    },
  },
];
