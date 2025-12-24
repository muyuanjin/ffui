import { Film, Image, Music } from "lucide-vue-next";
import type { QueueListItem } from "@/composables";
import type { JobStatus, JobType } from "@/types";
import type { ProgressVariant } from "@/components/ui/progress";

const clampNumber = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

export const getTypeIcon = (type: JobType | string) => {
  switch (type) {
    case "video":
      return Film;
    case "image":
      return Image;
    case "audio":
      return Music;
    default:
      return Film;
  }
};

export const getStatusClass = (status: JobStatus) => {
  switch (status) {
    case "completed":
      return "border-emerald-500/60 text-emerald-200 bg-emerald-500/20";
    case "processing":
      return "border-blue-500/60 text-blue-200 bg-blue-500/20";
    case "waiting":
    case "queued":
    case "paused":
      return "border-amber-500/60 text-amber-200 bg-amber-500/20";
    case "failed":
      return "border-red-500/60 text-red-200 bg-red-500/20";
    case "skipped":
    case "cancelled":
      return "border-muted-foreground/40 text-muted-foreground bg-muted/40";
    default:
      return "border-border text-muted-foreground bg-muted/40";
  }
};

export const getProgressVariant = (status: JobStatus): ProgressVariant => {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "paused":
    case "waiting":
    case "queued":
      return "warning";
    case "cancelled":
    case "skipped":
      return "muted";
    default:
      return "default";
  }
};

export const isCarouselCardVisible = (index: number, activeIndex: number, maxLayers: number) => {
  const relativeIndex = Math.abs(index - activeIndex);
  return relativeIndex <= maxLayers;
};

export type Carousel3DLayout = Readonly<{
  stageWidth: number;
  stageHeight: number;
  cardWidth: number;
  cardHeight: number;
  translateXStep: number;
  translateZStep: number;
  perspectivePx: number;
  dragPixelsPerStep: number;
}>;

export const computeCarousel3DLayout = (params: { stageWidth: number; stageHeight: number }): Carousel3DLayout => {
  const stageWidth = Number(params.stageWidth);
  const stageHeight = Number(params.stageHeight);

  // Fallback values for test environments (e.g. jsdom) where layout measurement can be 0.
  if (!Number.isFinite(stageWidth) || !Number.isFinite(stageHeight) || stageWidth <= 0 || stageHeight <= 0) {
    return {
      stageWidth: 0,
      stageHeight: 0,
      cardWidth: 920,
      cardHeight: 520,
      translateXStep: 150,
      translateZStep: 110,
      perspectivePx: 1400,
      dragPixelsPerStep: 200,
    };
  }

  // Keep some breathing room so adjacent cards remain visible (3D "jukebox" feel),
  // while still filling most of the vertical space.
  const paddingX = 32; // matches `calc(100% - 2rem)` used previously
  const paddingY = 16; // matches `calc(100% - 1rem)` used previously

  const availableWidth = Math.max(0, stageWidth - paddingX);
  const availableHeight = Math.max(0, stageHeight - paddingY);

  const minCardWidth = Math.min(560, availableWidth);
  const maxCardWidth = availableWidth;

  const widthByStage = availableWidth * 0.84;
  // Keep the card from becoming an ultra-wide banner; allow a more "poster-like"
  // shape so the preview has enough vertical space.
  const widthByHeight = availableHeight * 1.55;
  const cardWidth = clampNumber(Math.min(widthByStage, widthByHeight), minCardWidth, maxCardWidth);

  const minCardHeight = Math.min(340, availableHeight);
  const cardHeight = clampNumber(availableHeight * 0.985, minCardHeight, availableHeight);

  const translateXStep = clampNumber(cardWidth * 0.36, 90, 420);
  const translateZStep = clampNumber(cardWidth * 0.26, 70, 320);
  const perspectivePx = clampNumber(cardWidth * 1.25, 900, 2200);
  const dragPixelsPerStep = clampNumber(cardWidth * 0.22, 140, 320);

  return {
    stageWidth,
    stageHeight,
    cardWidth,
    cardHeight,
    translateXStep,
    translateZStep,
    perspectivePx,
    dragPixelsPerStep,
  };
};

export const computeCarouselCardStyle = (params: {
  index: number;
  activeIndex: number;
  totalCards: number;
  isDragging: boolean;
  dragOffset: number;
  layout: Carousel3DLayout;
}) => {
  const relativeIndex = params.index - params.activeIndex;

  let baseOffset = relativeIndex;
  if (params.isDragging) {
    const step = params.layout.dragPixelsPerStep || 150;
    baseOffset = relativeIndex - params.dragOffset / step;
  }

  const rotateY = Math.max(-60, Math.min(60, baseOffset * 12));
  const translateX = baseOffset * params.layout.translateXStep;
  const translateZ = -Math.abs(baseOffset) * params.layout.translateZStep;
  const scale = Math.max(0.68, 1 - Math.abs(baseOffset) * 0.075);
  const opacity = Math.max(0.15, 1 - Math.abs(baseOffset) * 0.18);
  const zIndex = params.totalCards - Math.abs(relativeIndex);
  const rotateX = Math.abs(baseOffset) > 0.5 ? 3 : 0;

  return {
    transform: `
      perspective(${params.layout.perspectivePx}px)
      translateX(${translateX}px)
      translateZ(${translateZ}px)
      rotateY(${rotateY}deg)
      rotateX(${rotateX}deg)
      scale(${scale})
    `,
    opacity,
    zIndex,
    transition: params.isDragging
      ? "none"
      : "transform 0.4s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.4s cubic-bezier(0.23, 1, 0.32, 1)",
  };
};

export const isCarouselItemSelected = (item: QueueListItem, selectedJobIds: Set<string>): boolean => {
  if (item.kind === "job") {
    return selectedJobIds.has(item.job.id);
  }
  return item.batch.jobs.every((j) => selectedJobIds.has(j.id));
};

export const getCarouselDisplayFilename = (item: QueueListItem, t: (key: string) => string): string => {
  if (item.kind === "batch") {
    return item.batch.rootPath?.split(/[/\\]/).pop() || t("batchCompress.title");
  }
  const name = item.job.filename || "";
  const slash = name.lastIndexOf("/");
  const backslash = name.lastIndexOf("\\");
  const idx = Math.max(slash, backslash);
  return idx >= 0 ? name.slice(idx + 1) : name;
};
