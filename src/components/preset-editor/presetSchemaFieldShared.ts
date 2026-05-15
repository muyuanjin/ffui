import { useI18n } from "vue-i18n";
import type { PresetFieldDef } from "@/lib/presetEditorContract/parameterSchema";
import { selectItemLabelForField } from "./presetSchemaFieldLabels";

export type PresetSchemaFieldComponentProps = {
  field: PresetFieldDef<any>;
  model: any;
  isDisabled: boolean;
  commandGroupAttr?: string;
  commandFieldAttr?: string;
};

export type PresetSchemaSelectOption = {
  value: string;
  label: string;
};

export function usePresetSchemaFieldLabel(props: PresetSchemaFieldComponentProps) {
  const { t } = useI18n();
  const labelFor = (value: string) => selectItemLabelForField(props.field, props.model, value, t);
  return { t, labelFor };
}
