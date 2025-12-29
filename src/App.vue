<script setup lang="ts">
// 直接挂载完整控制台，避免“加载壳 → 再切到主界面”的二段式闪烁。
// 首屏空白由 index.html 里的静态 boot-shell 负责兜底。
import MainApp from "./MainApp.impl.vue";
import { Toaster } from "@/components/ui/sonner";
</script>

<template>
  <Toaster position="bottom-right" :rich-colors="true" :close-button="true" close-button-position="top-right" />
  <div class="ffui-ui-scale-root">
    <MainApp />
  </div>
</template>
