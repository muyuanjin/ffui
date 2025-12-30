<script setup lang="ts">
import MainAppRootShell from "@/components/main/MainAppRootShell.vue";
import { createMainAppContext, provideMainAppContext } from "@/MainApp.setup";

const setup = createMainAppContext();
provideMainAppContext(setup);
</script>
<template>
  <MainAppRootShell />
</template>
