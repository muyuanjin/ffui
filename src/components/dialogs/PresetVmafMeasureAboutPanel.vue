<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown } from "lucide-vue-next";
import { openExternalUrl } from "@/lib/externalLinks";

const props = defineProps<{
  dialogOpen: boolean;
}>();

const { t } = useI18n();

const aboutOpen = ref<boolean>(false);
watch(
  () => props.dialogOpen,
  (open) => {
    if (open) aboutOpen.value = false;
  },
  { immediate: true },
);

const vqLinks = [
  { id: "vmaf", url: "https://github.com/Netflix/vmaf", labelKey: "presets.vmafMeasureLinkVmafRepo" as const },
  {
    id: "vmaf-datasets",
    url: "https://github.com/Netflix/vmaf/blob/master/resource/doc/datasets.md",
    labelKey: "presets.vmafMeasureLinkNetflixDatasets" as const,
  },
  {
    id: "avt-vqdb-hdr",
    url: "https://avtshare01.rz.tu-ilmenau.de/avt-vqdb-uhd-1-hdr/",
    labelKey: "presets.vmafMeasureLinkAvtVqdbHdr" as const,
  },
  {
    id: "avt-vqdb-appeal",
    url: "https://github.com/Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1-Appeal",
    labelKey: "presets.vmafMeasureLinkAvtVqdbAppeal" as const,
  },
];

const prefersReducedMotion = (): boolean => {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
};

const resetAboutPanelInlineStyles = (node: HTMLElement) => {
  node.style.height = "";
  node.style.opacity = "";
  node.style.transition = "";
  node.style.willChange = "";
};

const beforeAboutEnter = (el: Element) => {
  const node = el as HTMLElement;
  resetAboutPanelInlineStyles(node);
  node.style.height = "0px";
  node.style.opacity = "0";
  node.style.willChange = "height, opacity";
};

const onAboutEnter = (el: Element, done: () => void) => {
  const node = el as HTMLElement;
  if (prefersReducedMotion()) {
    resetAboutPanelInlineStyles(node);
    done();
    return;
  }

  const target = node.scrollHeight;
  requestAnimationFrame(() => {
    node.style.transition = "height 260ms ease, opacity 260ms ease";
    node.style.height = `${target}px`;
    node.style.opacity = "1";
  });

  const onEnd = (event: TransitionEvent) => {
    if (event.target !== node || event.propertyName !== "height") return;
    node.removeEventListener("transitionend", onEnd);
    done();
  };
  node.addEventListener("transitionend", onEnd);
};

const afterAboutEnter = (el: Element) => {
  const node = el as HTMLElement;
  node.style.height = "auto";
  node.style.transition = "";
  node.style.willChange = "";
};

const beforeAboutLeave = (el: Element) => {
  const node = el as HTMLElement;
  resetAboutPanelInlineStyles(node);
  node.style.height = `${node.scrollHeight}px`;
  node.style.opacity = "1";
  node.style.willChange = "height, opacity";
};

const onAboutLeave = (el: Element, done: () => void) => {
  const node = el as HTMLElement;
  if (prefersReducedMotion()) {
    resetAboutPanelInlineStyles(node);
    done();
    return;
  }

  requestAnimationFrame(() => {
    node.style.transition = "height 220ms ease, opacity 220ms ease";
    node.style.height = "0px";
    node.style.opacity = "0";
  });

  const onEnd = (event: TransitionEvent) => {
    if (event.target !== node || event.propertyName !== "height") return;
    node.removeEventListener("transitionend", onEnd);
    done();
  };
  node.addEventListener("transitionend", onEnd);
};

const afterAboutLeave = (el: Element) => {
  resetAboutPanelInlineStyles(el as HTMLElement);
};
</script>

<template>
  <div class="rounded-md border border-border/50 bg-card/50">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      :aria-expanded="aboutOpen"
      aria-controls="preset-vmaf-measure-about"
      data-testid="preset-vmaf-measure-about-toggle"
      @click="aboutOpen = !aboutOpen"
    >
      <span class="text-[11px] font-medium">{{ t("presets.vmafMeasureAboutTitle") }}</span>
      <ChevronDown
        class="h-4 w-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none"
        :class="aboutOpen ? 'rotate-180' : ''"
      />
    </button>

    <div class="px-3 pb-3">
      <Transition
        @before-enter="beforeAboutEnter"
        @enter="onAboutEnter"
        @after-enter="afterAboutEnter"
        @before-leave="beforeAboutLeave"
        @leave="onAboutLeave"
        @after-leave="afterAboutLeave"
      >
        <div v-show="aboutOpen" id="preset-vmaf-measure-about" class="overflow-hidden">
          <div class="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed select-text">
            {{ t("presets.vmafMeasureAboutBody") }}
          </div>
          <div class="mt-3 space-y-2">
            <div class="text-[11px] font-medium text-foreground">{{ t("presets.vmafMeasureLinksTitle") }}</div>
            <div class="text-[10px] text-muted-foreground">{{ t("presets.vmafMeasureLinksHint") }}</div>
            <div class="space-y-1">
              <div
                v-for="link in vqLinks"
                :key="link.id"
                class="flex items-start justify-between gap-3 rounded px-2 py-1 hover:bg-accent/20"
              >
                <a
                  class="text-[11px] underline underline-offset-2 text-foreground hover:text-primary"
                  :href="link.url"
                  target="_blank"
                  rel="noreferrer"
                  :data-testid="`preset-vmaf-link-${link.id}`"
                  @click.prevent="openExternalUrl(link.url)"
                >
                  {{ t(link.labelKey) }}
                </a>
                <code
                  class="font-mono text-[10px] text-muted-foreground select-text break-all"
                  :data-testid="`preset-vmaf-link-url-${link.id}`"
                >
                  {{ link.url }}
                </code>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>
