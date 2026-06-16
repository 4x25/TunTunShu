export interface JobSummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  results: { id: number; result: unknown }[];
}

function defaultClassify(result: unknown): "success" | "failed" | "skipped" {
  return result && (result as { ok?: boolean }).ok ? "success" : "failed";
}

/**
 * 串行地对一组 id 调用 handler,汇总成功/失败/跳过计数。
 * handler 自身抛出的异常被捕获并计为 failed,不会中断整个批次。
 * service 层函数已各自写 system_task_logs,这里只负责遍历与汇总。
 */
export async function runForIds(
  ids: number[],
  handler: (id: number) => Promise<unknown>,
  classify: (result: unknown) => "success" | "failed" | "skipped" =
    defaultClassify,
): Promise<JobSummary> {
  const results: { id: number; result: unknown }[] = [];
  let success = 0;
  let failed = 0;
  let skipped = 0;
  for (const id of ids) {
    let result: unknown;
    try {
      result = await handler(id);
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const klass = classify(result);
    if (klass === "success") success += 1;
    else if (klass === "skipped") skipped += 1;
    else failed += 1;
    results.push({ id, result });
  }
  return { total: ids.length, success, failed, skipped, results };
}
