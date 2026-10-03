# Manual FFmpeg Queue / 手动 FFmpeg 队列

## English

Add files or folders to use a preset. Regular files are accepted without an extension whitelist; inaccessible paths, symbolic links and non-regular files are reported as skipped. Use a preset whose codecs and container match your intended output. Invalid presets and FFmpeg failures produce explicit diagnostics instead of silently selecting another preset.

### Preset-based file conversion

1. Configure and save a preset in **Parameter presets**. For AAC audio, use the audio tab to select AAC and the container tab to select MP4/M4A. Audio encoding is independent of the video encoder, including video Copy.
2. For other codecs or media recipes, save a custom **command template** in the preset editor, for example `ffmpeg -i INPUT -vn -c:a libmp3lame -b:a 192k -f mp3 OUTPUT`. Specify the output muxer with `-f` when changing formats. Under the default output policy it also determines the planned `OUTPUT` extension; output policy overrides can change the planned address, but not the template's parameters.
3. Open **Parameter settings** in the task queue to select **Unified preset** or **By input type**, then drop files/folders or click **Add files** / **Add folder**. The toolbar shows one preset summary in unified mode or three input-specific summaries beside the same button. Unified mode applies one preset to every file, including extracting audio from video. Per-input mode selects separate presets for video, audio and image inputs; unset and unknown types follow the unified preset, which is also configurable in the popover. Missing configured presets produce diagnostics before the selection is enqueued, not silent replacements. Expanded file order is preserved. Incompatible inputs fail with diagnostics.

You do not need the **Add command** button for this workflow. That separate entry is for one-off advanced invocations, not for applying a preset to added files.

Hover over the parameter-settings button or its summaries to see the full preset names in a compact settings panel without moving keyboard focus. Move into the panel to change selections. Clicking the button or interacting with the panel keeps it open; Escape, an outside click or another button click closes it. Keyboard and touch users can open it with the button. The preset and output controls share the same capsule style; long toolbar summaries truncate while their full names remain visible in the panel.

### Saved preferences

Default-preset mode, the unified preset and the per-input preset IDs are saved in application settings, together with output formats, directory, filename and timestamp preferences. Edits wait for existing settings to load, merge with the latest values and save without waiting for an idle callback. File, folder and drop enqueue waits for settings persistence before planning tasks; a save failure is visible and prevents enqueue against stale settings. Retrying the operation retries persistence. Rebuilding the executable does not reset these preferences when the same application data directory is used.

Output editing becomes available after settings load; load errors do not authorize saving default settings over an unreadable file. Manual enqueue also waits for the backend preset list and rejects missing configured IDs instead of substituting another preset.

Preset sorting, direction, view and selection-bar pin preferences also restore on startup. Batch Compress retains its last submitted configuration independently of manual queue output settings. Normal window close waits for a bounded settings flush; failure or timeout keeps the window open with a diagnostic for retry. After successful saving, the backend applies the active-task exit policy; confirmed exit flushes settings again and remains cancellable if that flush fails or times out. Forced termination or an unavailable data directory cannot guarantee the latest edits reach disk. Unsaved preset-editor changes, command-dialog drafts, open popovers and preview playback positions are session state, not saved presets or application settings.

Queue history follows **Queue persistence** in application settings: **Restore queue** retains finished tasks, while **Unfinished only** deliberately excludes them. Settings and history must load before queue persistence may replace an existing snapshot. A history read or decode failure preserves the file and reports its diagnostic; repair the file and restart to retry. Unsupported settings remain unavailable; malformed settings JSON and read failures report errors without replacing preferences with defaults or automatically restoring a backup. Existing backups remain untouched. Ordinary saves preserve unknown object fields and reject replacements that would discard them. Configuration imports interpret each document using its own schema before merging, so absent output preferences retain their meaning.

### Preset targets and output formats

**Output settings** offers **Default (follow preset/template)**, **Keep input container**, **Unified format**, or **Specify formats by output type**. Input type selects the preset; the preset's target output type selects the format. Video processed with an audio-extraction preset uses the audio format; a frame-extraction preset uses the image format. Unset and unresolved output types follow the preset. A unified format explicitly applies to every task and must be compatible with its codecs and mappings. Known video-to-audio-container and AAC-to-MP3 conflicts produce invalid-plan diagnostics instead of silently changing codecs.

Click or tap outside an open format menu, or press Escape, to dismiss only that menu without changing its selection or closing **Output settings**. With no menu open, clicking outside or pressing Escape closes the settings dialog.

Structured targets follow the selected streams and input resource. Custom command presets conservatively recognize simple recipes; use **Target output type** in the preset editor to declare video, audio, image or custom/multiple outputs when recognition is insufficient. The declaration selects a policy category without rewriting command arguments. MP4/MKV can contain audio without video; their extension alone does not define the target. Unknown inputs remain executable.

The queue header shows one badge for a unified policy, or three category-icon badges extending to the left of **Output settings** for a per-output policy. Settings-file version 2 preserves explicit unified formats. Recognized single-format settings in older files migrate once to their category; unknown custom formats keep their global behavior. Existing task snapshots retain their saved policy and command. New manual tasks snapshot the selected preset and resolved output policy at enqueue time. Re-enqueue failed tasks after changing settings. Batch Compress's native image/audio targets remain controlled by their encoding configuration.

A forced WebM format incompatible with the preset's codecs resolves to Matroska (`.mkv`), with a task warning; output examples show the resolved path. A resumed video's final mux uses the same saved format policy as its segments, including this fallback.

Preset and queue format selectors support video, audio and image formats. Choose codecs compatible with the selected container; selecting a format does not select an encoder. ALAC is an audio codec, normally stored in M4A, not a separate output container. AAC files use the ADTS muxer. With custom command templates, output policy plans the `OUTPUT` address without rewriting codecs, maps or filters. An explicitly selected format conflicting with the template's output `-f` or identifiable image encoder produces a diagnostic, rather than media with a misleading extension. Simple `image2` output groups with an identifiable PNG, MJPEG, BMP or TIFF encoder determine the default extension. Complex options or stream selectors require an explicit output format selection; FFUI does not fully interpret FFmpeg arguments. Transparent image task thumbnails prefer a prepared preview, then the input image; a bound output address alone does not replace an available input thumbnail.

A preset template's explicitly bound `OUTPUT` address is saved with the task and can be copied or located from its context menu, including for transparent execution. This address does not grant FFUI ownership of the output or prove that a file was produced. Raw advanced commands without a recorded output address have disabled output-path actions; FFUI does not substitute the input path or discover arbitrary outputs. For existing transparent records that lack this address, inspect the task's saved FFmpeg command to locate its destination.

Structured video jobs retain two-pass encoding, segment-based resume and existing replacement behavior. Other structured jobs use a managed single-file output: FFUI reserves a temporary file alongside the output, publishes a non-empty result only after FFmpeg exits successfully, and never overwrites a file that appeared at the destination. Failed, cancelled and waited executions remove only their owned temporary output. Relative managed file addresses are bound to absolute paths at enqueue time. Multi-file muxers and image sequences require transparent mode; the effective output policy, not just the preset container, determines this restriction. Manual jobs do not use Batch Compress's minimum-saving gate. Their preset and output policy are captured at enqueue time, including across a restart.

Use **Add command** in the lower-left sidebar, in the same row as the compression action. Its tooltip and accessible name are **Add FFmpeg command**. Paste a complete command starting with `ffmpeg` or `ffmpeg.exe`; a quoted executable path is also accepted. FFUI uses its configured FFmpeg, not the pasted executable path. A task name is supplied automatically. The optional name and working directory are under **Advanced settings**. With no working directory specified, FFmpeg inherits the application's working directory. For example:

```text
ffmpeg -f lavfi -i "sine=frequency=440:duration=1" -c:a pcm_s16le "C:\media\tone.wav"
```

The argument preview only parses the command; it never executes or probes inputs. Single and double quotes group arguments, including empty arguments; within double quotes, `\"` represents a literal double quote. Other backslashes are retained, including Windows path separators. Arguments are passed directly to FFmpeg in order, preserving duplicates, Unicode and filter expressions. Shell expansion is not performed: variables, wildcards and shell escape rules are not interpreted. Unquoted shell operators, chaining and redirection are rejected; quote literal values containing these characters. Invalid syntax shows a diagnostic and cannot be enqueued.

This transparent mode supports multiple inputs/outputs, generated sources and analysis without a file-input or ffprobe gate. Advanced preset commands also use this mode. Only complete `INPUT` and `OUTPUT` tokens in a preset template are bound; other tokens are unchanged. The output policy may plan the `OUTPUT` token but does not rewrite an explicit output address.

Transparent commands own their side effects: FFUI does not discover, publish, roll back or delete their outputs, inject overwrite/progress arguments, or rewrite mapping, media flags, seek or containers. FFmpeg's exit status determines command success; the queue makes no stronger promise about external outputs. Cancellation may leave partial files. Review your parameters before starting or explicitly restarting a command.

Audio tasks show embedded cover art when available, an audio placeholder otherwise, and probed duration, codec, sample rate, channels and tags. Metadata and cover probing are optional: failure does not prevent execution. Managed structured audio recipes that preserve the input timeline show measured percentage progress when a single audio stream has a usable duration and FFmpeg reports valid processed timestamps. Seek, looping, custom filter chains, ambiguous streams, `N/A` timestamps and transparent commands retain indeterminate progress, with logs and elapsed time. Progress configuration belongs to the queued execution snapshot. Running percentages stay below 100% until successful output publication; `progress=end` alone is not success. Managed jobs can be waited and resumed **from the beginning**, not from a checkpoint. Transparent jobs cannot be waited or automatically resumed/replayed after an application restart; use an explicit restart if repeating the side effects is safe. Cancellation remains available.

For offset-origin audio whose probe duration may represent a timestamp endpoint rather than an elapsed span, duration and percentage remain unknown. MP3's frame-count duration supports its normal codec delay. Managed progress follows the current backend measurements without video resume extrapolation; elapsed wall time and owned temporary paths do not imply resumable media progress.

### Playback and image viewing

Click a queue thumbnail to preview the selected input or output. FFUI probes that file to choose audio controls, an image viewer or a video player; an audio-only MKV remains audio, and a video-to-image result uses the image viewer. Preview inspection errors do not change the task's execution result.

Media Info also chooses its preview from probed streams and container metadata, ignoring embedded cover art as a timeline video stream. Task detail distinguishes loading, empty logs and failed log reads; a failed read can be retried in place or by reopening the detail view.

Audio and images try native decoding first. If the WebView cannot decode them, FFmpeg prepares a separate cached preview: stereo 48 kHz AAC/M4A for audio, or a PNG fitting within 4096 × 4096 for images. Image conversion shows the first frame and preserves transparency; AVIF/HEIF with auxiliary alpha is rejected when the configured decoder cannot retain that alpha. The preview copy is not a lossless comparison of the original. Preparation has a 120-second timeout and a 256 MiB size limit. Failed preparation shows a diagnostic and a system-open action. Compatible previews never replace the selected source, task output or copy-path target. Completed cached copies share a 512 MiB budget; older copies can be evicted, including copies previously returned to a viewer. A new copy fails if sufficient space cannot be reclaimed. Seven-day expiration is applied when the cache is accessed; copies also participate in explicit preview-cache cleanup. In-flight temporary files are separate from this completed-copy budget. Video retains native playback and frame-scrubbing fallback.

Concurrency classification follows each task's saved execution recipe rather than the current preset list. Editing or deleting a preset cannot move saved hardware-encoding jobs into CPU slots. Transparent calls with explicit hardware codec arguments conservatively occupy a hardware slot, including multi-output calls.

Once a managed process observes a wait request, that stop reason survives a rapid Continue action: the task is queued to execute from the beginning, not treated as a failed conversion. Cancellation still prevents this automatic continuation. Transparent calls are not automatically replayed.

Compatible preview conversion holds an exclusive lease on an application-owned temporary workspace. Cache access and explicit cleanup reclaim abandoned workspaces after process termination while preserving active conversions and directories containing unrecognized files. Unmarked temporary files, including legacy bare `.part` files, are not deleted because ownership cannot be established.

Legacy tasks whose preset is missing, or which need an unavailable global output policy because they have no task-level snapshot, retain an invalid execution snapshot with a diagnostic. Existing valid execution or output-policy snapshots remain authoritative. Importing a preset or fixing settings later does not change an invalid snapshot or authorize replay; enqueue a new task after configuring the preset and output policy.

Terminal legacy records without an execution snapshot only clean recorded temporary paths and their associated `.noaudio.done` sidecar markers. Restarting or deleting their history does not infer video artifacts from display type or output filenames.

Media data over application-fed/received stdin/stdout (`-`, `pipe:`, `fd:`) is not supported. Progress-channel pipe targets are allowed, but only stderr is captured. There is no generic DAG, multi-output transaction, automatic output discovery or generic checkpoint/resume guarantee. Batch Compress and native image encoding remain separate workflows.

## 中文

添加文件或文件夹后使用预设执行。普通文件不受扩展名白名单限制；无法访问的路径、符号链接和非普通文件会提示已跳过。请选择编码器、容器与目标输出匹配的预设；无效预设和 FFmpeg 执行失败会给出诊断，不会静默换用其他预设。

### 按预设转码文件

1. 在 **参数预设** 中配置并保存预设。转为 AAC 音频时，在音频页选择 AAC，在封装页选择 MP4/M4A。音频编码独立于视频编码器，视频选直拷贝也可转码音频。
2. 其他编码器或媒体处理方案可在预设编辑器中保存自定义 **命令模板**，例如 `ffmpeg -i INPUT -vn -c:a libmp3lame -b:a 192k -f mp3 OUTPUT`。转换格式时用 `-f` 指定输出封装；默认输出策略下，它也决定规划的 `OUTPUT` 扩展名。输出策略覆盖可改变规划地址，但不改写模板参数。
3. 点击转码任务页面的 **参数设置**，在弹层中选择 **统一预设** 或 **按输入类型**，再拖入文件/文件夹，或点击 **添加文件** / **添加文件夹**。工具栏在同一个按钮左侧显示统一预设摘要，或三个按输入类型划分的摘要。统一模式对所有文件使用同一预设，支持从视频提取音频等跨类型处理。分类模式为视频、音频、图片输入分别选择预设；未指定及未知类型跟随统一预设，统一预设也可在该弹层内调整。明确配置但已缺失的预设，在本次选择入队前给出诊断，不静默替换。展开后的文件顺序保持不变；不兼容输入会给出失败诊断。

这条路径不需要点击 **添加命令任务** 按钮。该独立入口用于一次性的高级调用，不用于把预设应用到添加的文件。

鼠标悬浮在参数设置按钮或摘要上，即可在紧凑的设置面板内查看完整预设名称，不会抢走键盘焦点。移入面板可修改选择；点击按钮或操作面板后，面板保持打开，按 Escape、点击外部或再次点击按钮关闭。键盘和触屏用户可通过按钮打开。预设与输出控件使用相同的胶囊样式，工具栏的长摘要截断显示，面板内保留完整名称。

### 设置保存

默认预设的模式、统一预设及各输入类型的预设 ID，与输出格式、目录、文件名和文件时间策略一起保存在应用设置中。修改等待原有设置加载完成，再与最新值合并并即时保存，不依赖空闲回调。添加文件、文件夹和拖入任务会等待设置保存后再规划任务；保存失败会显示诊断，并阻止使用陈旧设置入队。重试操作会重新尝试保存。使用相同应用数据目录时，重新编译 EXE 不会重置这些偏好。

输出设置加载完成后才允许编辑；加载错误不会授权用默认设置覆盖不可读取的文件。手动入队也会等待后端预设列表，配置引用缺失时明确报错，不替换成其他预设。

预设排序、方向、视图和选择栏固定偏好也会在启动时恢复。Batch Compress 保留最近提交的配置，与手动队列的输出设置独立。正常关闭窗口会在限定时间内等待保存，失败或超时保留窗口并显示可重试诊断；保存成功后由后端执行活动任务的退出策略，确认退出时再次保存设置，保存失败或超时可取消退出。强制终止或数据目录不可用时，无法保证最新修改落盘。尚未保存的预设编辑、命令弹窗草稿、弹层展开状态和预览播放位置属于会话状态，不属于已保存预设或应用设置。

任务历史由应用设置中的 **任务队列持久化** 决定：**恢复队列** 保留已结束任务，**仅恢复未完成** 明确不保留这些任务。设置及历史加载完成前，队列保存不得替换已有快照。历史读取或解析失败时保留原文件并显示诊断；修复文件后重启可重试。不支持的设置保持不可用；设置 JSON 损坏或读取失败时明确报错，不用默认值替换偏好，也不自动恢复备份。已有备份保持不变。普通保存保留未知对象字段，拒绝会丢失这些字段的整体替换。配置导入分别按各文档自己的 schema 解释后合并，未导入的输出偏好保持原有语义。

### 预设目标与输出格式

**输出设置** 支持 **默认（走预设/模板）**、**维持原文件容器**、**统一指定格式** 和 **按输出类型指定格式**。输入类型用于选择预设，预设的目标输出类型用于选择格式。视频使用音频提取预设时走音频格式，使用截帧预设时走图片格式；未指定及无法确定的输出类型跟随预设。统一格式明确作用于所有任务，须与编码器和媒体映射兼容。已知的视频写入纯音频容器、AAC 写入 MP3 等冲突，会给出无效计划诊断，不静默更换编码器。

格式下拉展开时，点击或轻触下拉外部、按 Escape，只关闭下拉，不改变原选择，**输出设置** 保持打开。没有下拉展开时，点击外部或按 Escape 关闭设置窗口。

结构化目标按映射的媒体流与输入资源确定。自定义命令预设对简单配方进行保守识别；识别不足时，在预设编辑器的 **目标输出类型** 中明确选择视频、纯音频、图片或自定义／多输出。该声明只选择格式策略分类，不改写命令。MP4/MKV 可以只包含音频，不能仅按其扩展名确定输出类型。未知输入仍可执行。

队列顶部的统一策略显示一个徽标；分类输出策略显示三个带分类图标的徽标，向 **输出设置** 左侧展开。版本 2 设置文件保留明确的统一格式；更早文件中的单一已知格式仅在加载时迁移一次，未知自定义格式保留全局语义。已有任务快照保留其策略及命令；新手动任务在入队时快照所选预设和已解析的输出策略。失败任务调整设置后需重新入队。Batch Compress 的原生图片、音频目标仍由各自编码配置决定。

强制 WebM 与预设编码器不兼容时，输出回退为 Matroska（`.mkv`），任务给出警告，输出示例展示生效路径。恢复执行的视频，其最终封装与分段使用相同的已保存格式策略，包括这一回退。

预设和队列的格式选择器支持视频、音频及图片格式。请选择与容器匹配的编码器；选择格式不会自动选择编码器。ALAC 是音频编码，通常放在 M4A 容器中，不是独立输出容器。AAC 文件使用 ADTS 封装。自定义命令模板下，输出策略规划 `OUTPUT` 地址，不改写编码器、映射或过滤器。明确指定的格式与模板输出 `-f` 或可识别的图片编码器冲突时，会给出诊断，不会产出后缀误导的媒体文件。简单的 `image2` 输出组选项可明确识别 PNG、MJPEG、BMP 或 TIFF 编码器时，默认扩展名跟随该图片格式。复杂选项或流选择器需指定输出格式；应用不完整解释 FFmpeg 参数。透明图片任务缩略图优先使用已准备的预览，再使用输入图片；仅绑定输出地址不会替换可用的输入缩略图。

预设模板明确绑定的 `OUTPUT` 地址随任务保存，透明执行任务也可在右键菜单复制或定位该地址。地址不意味着应用拥有输出文件，也不证明已经产出文件。未记录输出地址的原始高级命令禁用输出路径操作；应用不拿输入路径代替输出，也不自动发现任意产物。已有透明记录若缺少该地址，可查看任务中保存的完整 FFmpeg 命令确认目的地。

结构化视频任务保留双遍编码、分段续跑和现有输出替换行为。其他结构化任务托管单文件输出：在目标目录预留临时文件，仅在 FFmpeg 成功退出且文件非空后发布；目标被其他程序占用时失败，不覆盖。失败、取消和等待仅清理本任务拥有的临时输出。托管任务的相对文件地址在入队时绑定为绝对路径。多文件 muxer 和图片序列必须使用透明模式；限制按生效的输出策略判定，而不只是看预设容器。手动任务不使用 Batch Compress 的节省门槛。预设和输出策略在入队时形成快照，重启后仍使用该快照。

点击左下角侧栏的 **添加命令任务** 按钮，它与添加压缩任务位于同一行，提示文字和可访问名称为 **添加 FFmpeg 命令**。粘贴以 `ffmpeg` 或 `ffmpeg.exe` 开头的完整命令即可，也接受带引号的程序路径。实际使用 FFUI 配置的 FFmpeg，不使用粘贴的程序路径。任务名称自动提供；可选名称和工作目录位于折叠的 **高级设置** 中。不指定工作目录时继承应用工作目录。上方命令示例生成一秒正弦波音频。

参数预览只解析命令，不执行、不探测输入。单、双引号用于参数分组，也可表示空参数；双引号内的 `\"` 表示字面双引号。其他反斜杠保留，包括 Windows 路径分隔符。参数按顺序直接传给 FFmpeg，保留重复项、Unicode 和过滤表达式。不进行 shell 展开：变量、通配符和 shell 转义规则不会被解释。引号外的 shell 运算符、命令串联和重定向会被拒绝；含这些字符的字面值请加引号。语法错误显示诊断并禁止入队。

透明模式支持多输入、多输出、生成源和分析任务，不要求文件输入或 ffprobe 成功。高级预设命令也走透明模式，仅替换完整的 `INPUT`、`OUTPUT` 参数；其他参数不变。输出策略可规划 `OUTPUT` 占位参数，但不会改写显式输出地址。

透明命令自行承担外部副作用：FFUI 不发现、发布、回滚或删除其产物，不注入覆盖或进度参数，也不改写映射、媒体开关、seek 或容器。命令成功以 FFmpeg 退出状态为准，不额外担保外部输出。取消后可能留下部分文件；运行或显式重启前请确认参数。

音频任务有内嵌封面时展示封面，否则显示音频占位图，并提供探测到的时长、编码、采样率、声道和标签。元信息与封面探测是可选步骤，失败不阻止执行。保持输入时间轴的结构化托管音频任务，在单个音频流具有可用时长且 FFmpeg 提供有效已处理时间时显示实际百分比；seek、循环、自定义过滤链、工作量不明确的流、`N/A` 时间反馈及透明命令显示不定进度，并提供日志和已用时间。进度配置属于入队执行快照。运行中的百分比保持低于 100%，成功发布输出后才完成；`progress=end` 不代表任务成功。托管任务可以等待后恢复，但会**从头执行**，不保证断点续跑。透明任务不能等待，也不会在应用重启后自动恢复或重放；仅在确认重复副作用安全时显式重启。仍可取消任务。

当音频输入具有非零时间起点、探测时长可能是时间戳终点而非实际跨度时，时长和百分比保持未知。MP3 按帧计数的时长支持其正常编码延迟。托管任务进度使用当前后端测量，不采用视频续跑外推；累计已用时间和临时文件归属不意味着可以从媒体断点续跑。

### 播放音频与查看图片

点击队列缩略图可预览选中的输入或输出。FFUI 探测当前文件，再选择音频播放控件、图片查看器或视频播放器；只有音轨的 MKV 仍按音频播放，视频转出的图片使用图片查看器。预览探测失败不改变任务的执行结果。

媒体信息页也使用探测到的媒体流与容器元信息选择预览，内嵌封面不算时间轴视频流。任务详情区分加载中、空日志及读取失败；读取失败可以就地重试，也可以重新打开详情重试。

音频和图片优先原生解码。WebView 无法解码时，FFmpeg 生成独立的缓存预览副本：音频为双声道 48 kHz AAC/M4A，图片为不超过 4096 × 4096 的 PNG。图片兼容转换显示第一帧并保留透明度；AVIF/HEIF 使用辅助 alpha 而当前解码器无法保留它时，明确拒绝兼容转换。预览副本不用于原文件的无损对比。生成过程有 120 秒超时和 256 MiB 大小限制，失败时显示诊断并提供系统打开操作。兼容预览不替换选中的源文件、任务输出或复制路径的目标。已完成的缓存副本共享 512 MiB 预算，较旧副本可能被淘汰，包括已返回给查看器的副本；无法回收足够空间时，新副本生成失败。访问缓存时应用七天过期规则，副本也纳入显式预览缓存清理。生成中的临时文件不计入已完成副本预算。视频保留原生播放与抽帧回退。

并发分类使用每个任务保存的执行配方，不读取当前预设列表。编辑或删除预设不会把已保存的硬件编码任务移入 CPU 槽位。透明调用含有明确的硬件编码参数时，保守占用硬件槽位，包括多输出调用。

托管进程一旦观察到等待请求，停止原因不会因快速点击继续而丢失：任务会从头排队执行，不会被判为转码失败。取消仍会阻止这一自动继续。透明调用不会自动重放。

兼容预览转换在应用拥有的临时工作目录上持有独占租约。访问缓存及主动清理会回收进程终止后遗留的工作目录，保留活动转换及含有未知文件的目录。无法证明归属的临时文件，包括旧版裸 `.part` 文件，不会被删除。

旧记录缺少引用的预设，或缺少任务级快照且所需全局输出策略不可用时，保留无效执行快照及诊断。已有合法执行或输出策略快照仍为权威。之后导入预设或修复设置不会改变无效快照或授权重放；配置好预设及输出策略后需要重新入队。

缺少执行快照的终态旧记录仅清理记录的临时路径及其关联的 `.noaudio.done` 标记文件。重启任务或删除历史记录时，不根据展示类型或输出文件名推测视频产物。

暂不支持应用供给或接收媒体数据的 stdin/stdout（`-`、`pipe:`、`fd:`）。允许进度通道管道地址，但仅捕获 stderr。没有通用 DAG、多输出事务、自动产物发现或通用断点恢复保证。Batch Compress 和原生图片编码仍为独立流程。
