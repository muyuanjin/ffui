export type FieldWidth = "full" | "half";

export interface BaseFieldDef<Model> {
  id: string;
  labelKey: string;
  helpKey?: string;
  descriptionKey?: string;
  placeholderKey?: string;
  testId?: string;
  width?: FieldWidth;
  /**
   * Optional command preview field mapping (used for token↔field navigation).
   * `group` is inferred from the parent tab; `commandField` is the token-level field id.
   */
  commandField?: string;
  /** Optional unit suffix displayed next to range/recommendation hints (e.g. "fps", "kbps"). */
  unit?: string;
  /** Optional i18n key for the unit label (preferred over `unit`). */
  unitKey?: string;
  visibleWhen?: (model: Model) => boolean;
  disabledWhen?: (model: Model) => boolean;
  /** Optional disabled reason shown below the control when disabled. */
  disabledReason?: (model: Model) => string | undefined;
  disabledReasonKey?: string;
  /** Optional recommendation hint shown below the control. */
  recommended?: (model: Model) => { value: string | number; labelKey?: string } | null;
}

export interface EnumOption {
  value: string;
  labelKey?: string;
  label?: string;
  recommended?: boolean;
}

export interface EnumFieldDef<Model> extends BaseFieldDef<Model> {
  kind: "enum";
  getValue: (model: Model) => string | undefined;
  setValue: (model: Model, value: string | undefined) => void;
  options: EnumOption[];
  allowUnset?: boolean;
  unsetLabelKey?: string;
}

export interface StringFieldDef<Model> extends BaseFieldDef<Model> {
  kind: "string";
  getValue: (model: Model) => string | undefined;
  setValue: (model: Model, value: string | undefined) => void;
  mono?: boolean;
  trim?: boolean;
}

export interface NumberFieldDef<Model> extends BaseFieldDef<Model> {
  kind: "number";
  getValue: (model: Model) => number | undefined;
  setValue: (model: Model, value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
}

export interface StringListFieldDef<Model> extends BaseFieldDef<Model> {
  kind: "stringList";
  getValue: (model: Model) => string[] | undefined;
  setValue: (model: Model, value: string[] | undefined) => void;
  /** Join/display separator, e.g. `+` for movflags. */
  joiner: string;
  /** Split expression: string is treated as a regexp source. */
  splitter: string;
  mono?: boolean;
}

export interface StringLinesFieldDef<Model> extends BaseFieldDef<Model> {
  kind: "stringLines";
  getValue: (model: Model) => string[] | undefined;
  setValue: (model: Model, value: string[] | undefined) => void;
  mono?: boolean;
  minRows?: number;
}

export interface TextFieldDef<Model> extends BaseFieldDef<Model> {
  kind: "text";
  getValue: (model: Model) => string | undefined;
  setValue: (model: Model, value: string | undefined) => void;
  mono?: boolean;
  minRows?: number;
  trim?: boolean;
}

export interface InputFileIndexMappingFieldDef<Model> extends BaseFieldDef<Model> {
  kind: "inputFileIndexMapping";
  /** Returns undefined (auto), -1 (disable), or >=0 (copy from index). */
  getIndex: (model: Model) => number | undefined;
  setIndex: (model: Model, value: number | undefined) => void;
  autoLabelKey: string;
  disableLabelKey: string;
  copyFromInput0LabelKey: string;
  copyFromInputNLabelKey: string;
  /** Default index used when switching to "custom copy". */
  defaultCustomIndex?: number;
  /** If true, allow selecting "copy from input #0" explicitly. */
  includeZero?: boolean;
}

export interface LoopCountFieldDef<Model> extends BaseFieldDef<Model> {
  kind: "loopCount";
  /** Returns undefined (auto), 0 (no loop), -1 (infinite), or >0 (loop times). */
  getCount: (model: Model) => number | undefined;
  setCount: (model: Model, value: number | undefined) => void;
  autoLabelKey: string;
  noLoopLabelKey: string;
  infiniteLabelKey: string;
  timesLabelKey: string;
  /** Default count used when switching to custom times. */
  defaultTimes?: number;
  /** Quick-pick loop counts to list in the dropdown (besides 0/-1). */
  quickTimes?: number[];
}

export interface TimeExpressionPresetOption {
  value: string;
  labelKey: string;
}

export interface TimeExpressionFieldDef<Model> extends BaseFieldDef<Model> {
  kind: "timeExpression";
  /** Undefined means unset (ffmpeg default). */
  getValue: (model: Model) => string | undefined;
  setValue: (model: Model, value: string | undefined) => void;
  presets: TimeExpressionPresetOption[];
  /** Value to set when switching to custom mode while empty. */
  defaultCustomValue?: string;
  customOptionLabelKey: string;
}

export type PresetFieldDef<Model> =
  | EnumFieldDef<Model>
  | StringFieldDef<Model>
  | NumberFieldDef<Model>
  | StringListFieldDef<Model>
  | StringLinesFieldDef<Model>
  | TextFieldDef<Model>
  | InputFileIndexMappingFieldDef<Model>
  | LoopCountFieldDef<Model>
  | TimeExpressionFieldDef<Model>;
