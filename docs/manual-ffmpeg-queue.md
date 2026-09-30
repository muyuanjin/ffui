# Manual FFmpeg Queue / 手动 FFmpeg 队列

## English

Add files or folders to use a preset. Regular files are accepted without an extension whitelist; inaccessible paths, symbolic links and non-regular files are reported as skipped. Use a preset whose codecs and container match your intended output. Invalid presets and FFmpeg failures produce explicit diagnostics instead of silently selecting another preset.

Structured video jobs retain two-pass encoding, segment-based resume and existing replacement behavior. Other structured jobs use a managed single-file output: FFUI reserves a temporary file alongside the output, publishes a non-empty result only after FFmpeg exits successfully, and never overwrites a file that appeared at the destination. Failed, cancelled and waited executions remove only their owned temporary output. Relative managed file addresses are bound to absolute paths at enqueue time. Multi-file muxers and image sequences require transparent mode; the effective output policy, not just the preset container, determines this restriction. Manual jobs do not use Batch Compress's minimum-saving gate. Their preset and output policy are captured at enqueue time, including across a restart.

The queue's **FFmpeg command** button accepts a task name, an ordered JSON array of arguments (without the executable) and an optional working directory. Arguments are passed directly to FFmpeg, not to a shell; duplicates, empty arguments, Unicode and filter expressions are preserved. With no working directory specified, FFmpeg inherits the application's working directory. For example:

```json
["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", "C:\\media\\tone.wav"]
```

This transparent mode supports multiple inputs/outputs, generated sources and analysis without a file-input or ffprobe gate. Advanced preset commands also use this mode. Only complete `INPUT` and `OUTPUT` tokens in a preset template are bound; other tokens are unchanged. The output policy may plan the `OUTPUT` token but does not rewrite an explicit output address.

Transparent commands own their side effects: FFUI does not discover, publish, roll back or delete their outputs, inject overwrite/progress arguments, or rewrite mapping, media flags, seek or containers. FFmpeg's exit status determines command success; the queue makes no stronger promise about external outputs. Cancellation may leave partial files. Review your parameters before starting or explicitly restarting a command.

Generic executions show indeterminate progress, with logs and elapsed time. `progress=end` alone is not success. Managed jobs can be waited and resumed **from the beginning**, not from a checkpoint. Transparent jobs cannot be waited or automatically resumed/replayed after an application restart; use an explicit restart if repeating the side effects is safe. Cancellation remains available.

Legacy tasks whose preset is missing retain an invalid execution snapshot. Importing a preset later does not change that snapshot or authorize replay; enqueue a new task after configuring the preset.

Terminal legacy records without an execution snapshot only clean recorded temporary paths and their associated `.noaudio.done` sidecar markers. Restarting or deleting their history does not infer video artifacts from display type or output filenames.

Media data over application-fed/received stdin/stdout (`-`, `pipe:`, `fd:`) is not supported. Progress-channel pipe targets are allowed, but only stderr is captured. There is no generic DAG, multi-output transaction, automatic output discovery or generic checkpoint/resume guarantee. Batch Compress and native image encoding remain separate workflows.

## 中文

添加文件或文件夹后使用预设执行。普通文件不受扩展名白名单限制；无法访问的路径、符号链接和非普通文件会提示已跳过。请选择编码器、容器与目标输出匹配的预设；无效预设和 FFmpeg 执行失败会给出诊断，不会静默换用其他预设。

结构化视频任务保留双遍编码、分段续跑和现有输出替换行为。其他结构化任务托管单文件输出：在目标目录预留临时文件，仅在 FFmpeg 成功退出且文件非空后发布；目标被其他程序占用时失败，不覆盖。失败、取消和等待仅清理本任务拥有的临时输出。托管任务的相对文件地址在入队时绑定为绝对路径。多文件 muxer 和图片序列必须使用透明模式；限制按生效的输出策略判定，而不只是看预设容器。手动任务不使用 Batch Compress 的节省门槛。预设和输出策略在入队时形成快照，重启后仍使用该快照。

队列中的 **FFmpeg 命令** 按钮接受任务名称、有序 JSON 参数数组（不包含程序名）和可选工作目录。参数直接传给 FFmpeg，不经过 shell；重复参数、空参数、Unicode 和过滤表达式保持原样。不指定工作目录时继承应用工作目录。上方 JSON 示例生成一秒正弦波音频。

透明模式支持多输入、多输出、生成源和分析任务，不要求文件输入或 ffprobe 成功。高级预设命令也走透明模式，仅替换完整的 `INPUT`、`OUTPUT` 参数；其他参数不变。输出策略可规划 `OUTPUT` 占位参数，但不会改写显式输出地址。

透明命令自行承担外部副作用：FFUI 不发现、发布、回滚或删除其产物，不注入覆盖或进度参数，也不改写映射、媒体开关、seek 或容器。命令成功以 FFmpeg 退出状态为准，不额外担保外部输出。取消后可能留下部分文件；运行或显式重启前请确认参数。

通用执行显示不定进度，并提供日志和已用时间；`progress=end` 不代表任务成功。托管任务可以等待后恢复，但会**从头执行**，不保证断点续跑。透明任务不能等待，也不会在应用重启后自动恢复或重放；仅在确认重复副作用安全时显式重启。仍可取消任务。

旧记录缺少引用的预设时保留无效执行快照。之后导入预设不会改变该快照或授权重放；配置好预设后需要重新入队。

缺少执行快照的终态旧记录仅清理记录的临时路径及其关联的 `.noaudio.done` 标记文件。重启任务或删除历史记录时，不根据展示类型或输出文件名推测视频产物。

暂不支持应用供给或接收媒体数据的 stdin/stdout（`-`、`pipe:`、`fd:`）。允许进度通道管道地址，但仅捕获 stderr。没有通用 DAG、多输出事务、自动产物发现或通用断点恢复保证。Batch Compress 和原生图片编码仍为独立流程。
