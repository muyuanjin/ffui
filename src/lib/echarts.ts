import { use } from "echarts/core";
import { HeatmapChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

use([CanvasRenderer, LineChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent]);
