import type { CommandToken } from "./tokenizer";

/**
 * 移除字符串首尾的引号（双引号和单引号）
 */
const stripQuotes = (value: string): string => value.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

/**
 * 为命令行标记分配分组信息
 *
 * 该函数遍历命令标记数组，识别 FFmpeg 选项参数，并为每个选项及其对应的值分配：
 * - `group`: 高级参数分组（global/video/audio/filters 等），用于 UI 导航
 * - `field`: 组内的具体字段标识符（可选），用于未来的细粒度映射
 *
 * 分组规则：
 * - **global**: 全局命令级选项（-progress, -nostdin, -y/-n, -loglevel, -hide_banner, -report）
 * - **input**: 输入和时间轴选项（-ss, -t, -to, -accurate_seek, -stream_loop, -itsoffset）
 * - **mapping**: 流映射和元数据（-map, -map_metadata, -map_chapters, -metadata, -disposition, -attach, -dump_attachment）
 * - **video**: 视频编码参数（-c:v, -crf, -cq, -b:v, -maxrate, -bufsize, -pass, -preset, -tune, -profile:v, -level, -g, -bf, -pix_fmt）
 * - **audio**: 音频编码参数（-c:a, -b:a, -ar, -ac, -channel_layout）
 * - **filters**: 滤镜（-vf, -filter_complex, -af）
 * - **container**: 容器和混流器（-f, -movflags, -segment_*, -hls_*, -dash*）
 * - **hardware**: 硬件加速和比特流滤镜（-hwaccel, -hwaccel_device, -hwaccel_output_format, -bsf）
 *
 * @param tokens - 输入的命令标记数组
 * @returns 带有分组信息的新标记数组（原数组不会被修改）
 */
export const assignCommandTokenGroups = (tokens: CommandToken[]): CommandToken[] => {
  const result = tokens.map((t) => ({ ...t }));

  const mark = (index: number, group: string, field?: string) => {
    const token = result[index];
    if (!token) return;
    token.group = token.group ?? group;
    token.field = token.field ?? field;
  };

  const len = result.length;
  for (let i = 0; i < len; i += 1) {
    const token = result[i];
    if (token.kind !== "option") continue;
    const opt = stripQuotes(token.text).toLowerCase();

    let group: string | undefined;
    let field: string | undefined;

    // Global / command-level options.
    if (opt === "-progress") {
      group = "global";
      field = "progress";
    } else if (opt === "-nostdin") {
      group = "global";
      field = "nostdin";
    } else if (opt === "-y" || opt === "-n") {
      group = "global";
      field = "overwrite";
    } else if (opt === "-loglevel") {
      group = "global";
      field = "loglevel";
    } else if (opt === "-hide_banner") {
      group = "global";
      field = "hideBanner";
    } else if (opt === "-report") {
      group = "global";
      field = "report";
    }

    // Input / timeline.
    if (!group) {
      if (opt === "-ss" || opt === "-t" || opt === "-to") {
        group = "input";
        field = "timeline";
      } else if (opt === "-accurate_seek") {
        group = "input";
        field = "accurateSeek";
      } else if (opt === "-stream_loop" || opt === "-itsoffset") {
        group = "input";
        field = "inputAdvanced";
      }
    }

    // Mapping & metadata.
    if (!group) {
      if (opt === "-map") {
        group = "mapping";
        field = "map";
      } else if (opt === "-map_metadata" || opt === "-map_chapters") {
        group = "mapping";
        field = "mapMeta";
      } else if (opt === "-metadata") {
        group = "mapping";
        field = "metadata";
      } else if (opt === "-disposition") {
        group = "mapping";
        field = "disposition";
      } else if (opt === "-attach" || opt === "-dump_attachment") {
        group = "mapping";
        field = "attachments";
      }
    }

    // Video.
    if (!group) {
      if (opt === "-c:v" || opt === "-codec:v") {
        group = "video";
        field = "encoder";
      } else if (opt === "-crf" || opt === "-cq") {
        group = "video";
        field = "quality";
      } else if (opt === "-b:v" || opt === "-maxrate" || opt === "-bufsize" || opt === "-pass") {
        group = "video";
        field = "bitrate";
      } else if (opt === "-preset" || opt === "-tune" || opt === "-profile:v") {
        group = "video";
        field = "preset";
      } else if (opt === "-level" || opt === "-g" || opt === "-bf" || opt === "-pix_fmt") {
        group = "video";
        field = "advanced";
      }
    }

    // Audio.
    if (!group) {
      if (opt === "-c:a" || opt === "-codec:a") {
        group = "audio";
        field = "codec";
      } else if (opt === "-b:a" || opt === "-ar" || opt === "-ac" || opt === "-channel_layout") {
        group = "audio";
        field = "params";
      }
    }

    // Filters (video/audio/complex).
    if (!group) {
      if (opt === "-vf" || opt === "-filter_complex") {
        group = "filters";
        field = "videoFilters";
      } else if (opt === "-af") {
        group = "filters";
        field = "audioFilters";
      }
    }

    // Container / muxer.
    if (!group) {
      if (opt === "-f") {
        group = "container";
        field = "format";
      } else if (opt === "-movflags") {
        group = "container";
        field = "movflags";
      } else if (opt.startsWith("-segment_") || opt.startsWith("-hls_") || opt.startsWith("-dash")) {
        group = "container";
        field = "segmenting";
      }
    }

    // Hardware & bitstream filters.
    if (!group) {
      if (opt === "-hwaccel" || opt === "-hwaccel_device" || opt === "-hwaccel_output_format") {
        group = "hardware";
        field = "hwaccel";
      } else if (opt === "-bsf") {
        group = "hardware";
        field = "bitstreamFilters";
      }
    }

    if (!group) continue;

    mark(i, group, field);

    // Also mark the immediate value token so clicking it still navigates.
    let j = i + 1;
    while (j < len && result[j].kind === "whitespace") j += 1;
    if (j < len && result[j].kind !== "option") {
      mark(j, group, field);
    }
  }

  return result;
};
