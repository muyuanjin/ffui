# FFmpeg 参数空间参考（最新版 ffmpeg-all）

> 数据源：`https://ffmpeg.org/ffmpeg-all.html`（通过 MCP Context7 `/websites/ffmpeg_ffmpeg-all` 获取，涵盖 2024 最新发布版）。示例引用包括 *Stream Discarding Options*、*HTTP Options*、*image2 muxer options*、*libwebp encoder*, *webm_chunk muxer*, *ts_number_layers* 等章节。

## 1. 命令级/全局开关

| 选项 | 值域/格式 | 依赖或互斥 | 校验提示 / 备注 |
| --- | --- | --- | --- |
| `-y` / `-n` | flag | 互斥 | 控制是否自动覆盖输出文件。 |
| `-loglevel` | `quiet|panic|fatal|error|warning|info|verbose|debug|trace`（可附 `repeat+level+`） | — | UI 用枚举；允许 `repeat+info` 等组合。 |
| `-report` | flag | — | 会在执行目录生成日志文件，向导需提示写权限。 |
| `-hide_banner` | flag | — | 适合蓝图“精简输出”开关。 |
| `-stats` / `-stats_period` | flag / float(秒) | `-stats_period` 依赖 `-stats` | `period > 0`；驱动前端进度刷新。 |
| `-progress` | 文件/管道 URL | — | 供 FlowCoder 监控面板读取（命名管道或 HTTP）。 |
| `-benchmark` / `-benchmark_all` | flag | — | 仅调试场景，提示额外 CPU 消耗。 |
| `-bitexact` | flag | 会启用 `-fflags +bitexact` | 回归测试使用，禁止与随机化滤镜同用。 |
| `-abort_on` | 逗号分隔：`empty`,`empty_output`… | — | 在 UI 中做多选；枚举取自 `ffmpeg-all`。 |
| `-xerror` / `-max_error_rate` | flag / float(0-1) | `-xerror` 影响整体退出策略 | `max_error_rate` 仅容器识别错误时有效。 |
| `-target` | `vcd|svcd|dvd|dv|pal-dvd|ntsc-svcd|...` | 可与 `-bf`、`-g` 等叠加 | 使用示例：`-target vcd -bf 2`（来自 ffmpeg-all Target 章节）。 |
| `-dumpgraph` | `0/1` | — | 结合蓝图调试滤镜图。 |

## 2. 输入与时间轴

| 选项 | 值域 | 依赖/限制 | 说明 |
| --- | --- | --- | --- |
| `-i` | 路径/URL | 每调用一次生成输入索引 | Windows 需转换盘符；路径用 Windows 风格（见 AGENTS 指南）。 |
| `-f`（输入） | 格式名 | 必须出现在 `ffmpeg -formats` 列表 | 向导提供下拉。 |
| `-ss` / `-to` / `-t` | `[[hh:]mm:]ss[.ms]` | `-to` 与 `-t` 互斥；`-ss` 在 `-i` 前后含义不同 | 需在 UI 中提示“输入寻址 vs 输出裁剪”。 |
| `-accurate_seek` | flag | 与 `-ss` 配合 | 需提醒流媒体性能影响。 |
| `-stream_loop N` | 整数（-1 无限） | 输入为可回放文件 | 验证整型。 |
| `-itsoffset` | 时间戳 | 与 `-copyts` 协同 | 可为负；调整输入时间基。 |
| `-copyts` / `-copytb` | flag | 影响输出时间戳 | 须提示后果（PTS 不归零）。 |
| `-analyzeduration` | μs / 整数 | — | 大型 TS 建议调大。 |
| `-probesize` | 字节数 | ≥ 32K | 小于默认易探测失败。 |
| `-readrate` / `-re` | float / flag | `-readrate` 仅部分协议支持 | 控制读取速率。 |
| `-thread_queue_size` | int | 与输入源绑定 | 大值占内存，给范围提示。 |
| `-discard` | `none|default|noref|bidir|nokey|all`（可加流选择） | 仅解码有效 | 来源：Stream Discarding Options 示例。 |
| `-seek_timestamp` | flag | 与 `-ss` 共同影响 | 仅少数 demuxer 支持。 |

## 3. 流映射与元数据

| 类别 | 语法 | 校验重点 |
| --- | --- | --- |
| `-map` | `[input_index][:stream_spec]`（例如 `0:v:0`, `0:s:m:language:eng`） | 确保目标流存在；支持 `?` 可选映射。 |
| `-map_channel` | `in.ch → out.ch` | 仅音频，需校验布局。 |
| `-map_metadata` / `-map_chapters` | `out_spec[,in_spec]` / `input_index|-1` | `-1` 清空。 |
| `-disposition` | `:stream flag`，flag 来自 `ffmpeg -disposition help` | 多选（`default|dub|original|lyrics|comment|forced|attached_pic`⋯）。 |
| `-metadata[:scope]` | `key=value`，scope 为 `g`、`s:#`、`c:#` 等 | 建议键值校验，禁止空键。 |
| `-attach` / `-dump_attachment` | 文件路径 / codec 名 | MKV/MP4 附件；需 Windows 路径提示。 |

## 4. 编解码器参数

| 选项族 | 值域 / 约束 | 依赖 |
| --- | --- | --- |
| `-c[:stream]` / `-codec` | `copy` 或特定编码器（`ffmpeg -encoders` 列表） | 切换后需刷新 profile/preset/pix_fmt。 |
| `-b:v`/`-b:a`/`-b:s` | 比特率（支持 `k/m/g`） | 若与 `-crf` 同时出现需提示行为。 |
| `-maxrate`/`-minrate`/`-bufsize` | 比特率 / buffer | CBR 需三者配合；`bufsize ≥ maxrate`。 |
| `-profile`/`-level` | 编码器枚举 | 使用 `ffmpeg -h encoder=libx264` 等动态列举。 |
| `-preset`/`-tune` | 取自编码器帮助 | 例如 libx264: `ultrafast`→`placebo`；libvpx 另有 `good`/`best`。 |
| `-crf` / `-qp` / `-qscale` | 整数或浮点（x264 0–51，libvpx 0–63 等） | 与 `-b` 互斥（除特殊模式）。 |
| `-g`/`-keyint_min` | 帧数 | `g ≥ keyint_min ≥ 1`。 |
| `-bf` | B 帧数 | 硬件编码器常受限（需要能力矩阵）。 |
| `-refs`/`-subq`/`-me_range` | 整数 | 高级调优，默认隐藏。 |
| `-pix_fmt` | `ffmpeg -pix_fmts` 结果 | 需校验编码器支持，否则 fallback。 |
| `-vf`/`-af`/`-filter` | AVFilter 表达式 | 语法见第 5 节。 |
| `-frames[:type]` | 整数 | 允许 `-frames:v 120`。 |
| `-qmin`/`-qmax` | 1–69 | 旧接口，与 `-qscale` 一致。 |
| 音频 | `-ar`(采样率), `-ac`(声道), `-sample_fmt`, `-channel_layout`, `-drc_scale(0-1)` | 需交叉验证布局与声道数一致。 |
| 字幕 | `-scodec`, `-canvas_size=WxH`, `-fix_sub_duration` | 画布大小必须为偶数像素。 |

## 5. 滤镜与 AVFilter

| 特性 | 规则 |
| --- | --- |
| 简单滤镜（`-vf`/`-af`） | `filter[=key=value[:...]]`；支持表达式引用 `n`,`t`,`pts`。 |
| 复杂滤镜（`-filter_complex`） | `[...]filter=...;[...]` 语法；节点名 `[in]`/`[out]`，可通过 `overlay@my` 添加实例名（参考 coreimage/zmq 示例）。 |
| `-filter_complex_threads` | 整数 ≥ 1，仅影响复杂滤镜。 |
| 脚本输入 | `-filter_complex_script file`，文件需可读。 |
| 动态控制 | `zmq`、`sendcmd`、`zmq` overlay 等（见 ffmpeg-all ZMQ 章节）。 |
| Lavfi 虚拟源 | `-f lavfi -i "color=s=...``, `aevalsrc`, `amovie` 等。 |
| 常用校验 | overlay 分辨率、scale 像素格式、音频滤镜的采样率/声道；UI 应通过节点编辑器自动校验连线。 |

## 6. 容器、切片与协议

| 选项 | 说明 |
| --- | --- |
| `-f`（输出） | 选择 muxer，列表来自 `ffmpeg -muxers`。 |
| `-muxdelay`/`-muxpreload` | 单位秒，控制输出缓冲。 |
| `-movflags` | `faststart`,`frag_keyframe`,`negative_cts_offsets` 等；MP4/HLS 常用。 |
| `-segment_*` | `-segment_time`, `_format`, `_atclocktime`, `_list_size`，需 `-f segment`；校验时间>0。 |
| `-hls_*` | `-hls_time`, `_list_size`, `_flags`, `_segment_type`, `_fmp4_init_filename` 等。 |
| DASH/WebM | `-f dash`, `-dash_segment_filename`, `webm_chunk` 示例：头文件 `.hdr` + chunk `%d.chk`（引用 WebM Chunk 文档）。 |
| HTTP 输出 | `http_opts`, `http_persistent`, `http_user_agent`（来自 HTTP Options 章节）。 |
| 网络缓冲 | `-rtbufsize`, `-stimeout`, `-reconnect_*`。 |
| 协议名单 | `protocol_whitelist=file,rtp,udp:protocol_blacklist=http`（movie filter 示例）。 |
| `-protocol_opts` | 将协议参数透传给容器（image2 章节示例）。 |

## 7. 比特流过滤器与硬件

| 选项/模块 | 要点 |
| --- | --- |
| `-bsf[:stream]` | List 取自 `ffmpeg -bsfs`；常见 `h264_mp4toannexb`、`aac_adtstoasc`。 |
| `-dframes` | 丢弃帧计数，用于测试。 |
| 硬件解码 | `-hwaccel [cuda|qsv|vaapi…]`，`-hwaccel_device`, `-init_hw_device`, `-hwaccel_output_format`；`chromakey_cuda` 示例展示完整链路。 |
| `-hwaccel_flags` | 例如 `allow_profile_mismatch`。 |
| 旋转 | `-autorotate` / `-noautorotate`。 |
| 关键帧复制 | `-copyinkf`。 |

## 8. 设备与虚拟源

| 类型 | 关键选项 |
| --- | --- |
| 视频采集（`v4l2`, `dshow`, `avfoundation`） | `-list_devices true`、`-list_options true`（DirectShow 示例）。 |
| 音频采集（`jack`, `alsa`, `pulse`） | JACK 示例：`ffmpeg -f jack -i ffmpeg` + `jack_connect`。 |
| 特殊源 | `coreimagesrc=list_generators=true`（列出 CoreImage generators）；`aevalsrc`, `testsrc`. |
| 其他硬件 | `decklink`, `ndi`, `srt` 等需额外库；按照 `ffmpeg -devices` 校验。 |

## 9. 动态查询 & 同步机制

为保证 FlowCoder 覆盖“完整参数空间”，在蓝图或后端中加入以下命令的解析流程：

```
ffmpeg -help
ffmpeg -h full
ffmpeg -h long
ffmpeg -h encoder=<name>
ffmpeg -h decoder=<name>
ffmpeg -h muxer=<name>
ffmpeg -pix_fmts
ffmpeg -sample_fmts
ffmpeg -layouts
ffmpeg -protocols
ffmpeg -filters
ffmpeg -devices
```

解析输出后可缓存成 schema，用于实时刷新 preset、profile、pix_fmt、filter 列表。

## 10. I18N 与 FlowCoder 向导联动建议

1. 所有描述性字符串放入 `src/i18n/copy.ts`，新增 `en-US` 与 `zh-CN` 键值。
2. 对存在依赖/互斥的参数（如 `-crf` vs `-b:v`、`-ss` 位置差异）在 UI 中实时提示，并阻止组合错误。
3. 滤镜编辑器建议采用节点式界面，输出时自动处理空格/转义（例如 `overlay@my=x=100`）。
4. 编码器能力矩阵：当用户切换 `-c:v` 时，调用 `ffmpeg -h encoder=...` 更新时间、色彩、硬件支持等枚举。
5. 在向导和蓝图中附上本文件与官方 docs 链接，确保使用者可跳转查阅细节。

---

如需扩展，此文档可追加新章节（例如协议专属参数、滤镜参数索引）。更新流程：先查 `ffmpeg-all` → 对应 `FFmpeg -h` 命令 → 补充表格 → 在此文件中同步。
