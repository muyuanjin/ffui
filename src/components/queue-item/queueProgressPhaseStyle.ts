import type { ProgressPhase } from "@/types";

export const progressColorClassForPhase = (phase: ProgressPhase | undefined): string => {
  switch (phase) {
    case "audioFinalizing":
      return "bg-cyan-400";
    case "muxing":
      return "bg-emerald-400";
    case "concatenating":
      return "bg-amber-400";
    default:
      return "bg-primary";
  }
};
