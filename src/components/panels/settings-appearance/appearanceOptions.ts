export const percentOptions = Array.from({ length: 31 }, (_, i) => 50 + i * 5);
export const fontSizePxOptions = Array.from({ length: 21 }, (_, i) => 12 + i);

export const scaleOptionTone = (percent: number) =>
  percent === 100
    ? "ffui-select-option--default"
    : percent < 80 || percent > 140
      ? "ffui-select-option--extreme"
      : percent >= 90 && percent <= 120
        ? "ffui-select-option--recommended"
        : "";

export const fontSizeOptionTone = (px: number) =>
  px === 16
    ? "ffui-select-option--default"
    : px < 13 || px > 22
      ? "ffui-select-option--extreme"
      : px >= 14 && px <= 20
        ? "ffui-select-option--recommended"
        : "";
