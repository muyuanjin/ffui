import { Film, Image, Music } from "lucide-vue-next";

export const getTypeIcon = (type: string) => {
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

export const getStatusClass = (status: string) => {
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

export const getProgressVariant = (status: string) => {
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

export const computeCarouselCardStyle = (params: {
  index: number;
  activeIndex: number;
  totalCards: number;
  isDragging: boolean;
  dragOffset: number;
}) => {
  const relativeIndex = params.index - params.activeIndex;

  let baseOffset = relativeIndex;
  if (params.isDragging) {
    baseOffset = relativeIndex - params.dragOffset / 100;
  }

  const rotateY = Math.max(-65, Math.min(65, baseOffset * 15));
  const translateX = baseOffset * 80;
  const translateZ = -Math.abs(baseOffset) * 50;
  const scale = Math.max(0.6, 1 - Math.abs(baseOffset) * 0.08);
  const opacity = Math.max(0.2, 1 - Math.abs(baseOffset) * 0.2);
  const zIndex = params.totalCards - Math.abs(relativeIndex);
  const rotateX = Math.abs(baseOffset) > 0.5 ? 4 : 0;

  return {
    transform: `
      perspective(1000px)
      translateX(${translateX}px)
      translateZ(${translateZ}px)
      rotateY(${rotateY}deg)
      rotateX(${rotateX}deg)
      scale(${scale})
    `,
    opacity,
    zIndex,
    transition: params.isDragging ? "none" : "all 0.4s cubic-bezier(0.23, 1, 0.32, 1)",
  };
};
