/// <reference types="vite/client" />

import type { AppSettings } from "./types";

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare global {
  interface Window {
    __FFUI_PRELOADED_APP_SETTINGS__?: AppSettings;
  }
}

export {};
