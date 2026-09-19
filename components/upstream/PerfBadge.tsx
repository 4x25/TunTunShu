import classNames from "classnames";
import { perfLevel, perfTooltip, type UpstreamPerf } from "./perf.ts";

const SLOTS = [0, 1, 2];

/**
 * 上游模型行的最近 3 个时段成功率迷你柱。
 * 无数据/站点不支持/抓取失败时同样渲染 3 根灰柱占位,细节只在 tooltip 里说明,
 * 保证同一列里每行的按钮与柱子宽度一致。
 */
export function PerfBadge({ perf }: { perf?: UpstreamPerf }) {
  const tooltip = perfTooltip(perf);
  const slots = SLOTS.map((index) => perf?.slots?.[index] ?? null);
  return (
    <div
      class="perf-chart tooltip tooltip-bottom tooltip-start"
      data-tip={tooltip}
      aria-label={tooltip}
    >
      {slots.map((rate, index) => (
        <span
          key={index}
          class={classNames("perf-bar", `perf-bar-${perfLevel(rate)}`)}
        />
      ))}
    </div>
  );
}
