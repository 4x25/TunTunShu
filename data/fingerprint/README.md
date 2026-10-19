# 模型指纹参考数据

本目录的检测器与参考库来自
[Ikaleio/lm-detector](https://github.com/Ikaleio/lm-detector)(MIT)。

- 快照 commit:`654c8334bb53951aaf04cbd61252d163649e1369`
- 参考库 `built_at`:`2026-10-17T09:36:07.798950+00:00`
- 模型数:60

## 文件

| 文件                  | 说明                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `shared_detector.bin` | 上游发布的检测器权重(原始 4.2MB 二进制,运行时由 `lib/fingerprint/detector_codec.ts` 解码) |
| `bank.json`           | 从上游 `unified_bank.json` 提取的模型元数据(id、显示名、家族、参考回答数),约 10KB         |
| `LICENSE`             | 上游 MIT 许可证                                                                           |

## 更新

```sh
deno task fingerprint:sync
```

脚本默认使用上面的固定 commit;需要跟随上游更新时:

```sh
TTS_FINGERPRINT_SOURCE_COMMIT=<commit> deno task fingerprint:sync
```

脚本会校验参考库 `built_at`、`reference_sha256`、模型
id/回答数与检测器一致后才写入。 更新后请运行 `deno test -A`,确认
`lib/fingerprint/analyze_test.ts` 的固定参考样本仍能正确预测。

## 注意

- 运行时只读取 `bank.json` 与 `shared_detector.bin`;不访问 lm.ikale.io 或
  GitHub。
- 构建时 `scripts/copy_fingerprint_data.ts` 会把两个运行时文件复制到
  `_fresh/fingerprint-data/` 与 `_fresh/server/fingerprint-data/`。
- 排名是参考库内的闭集排序,不是模型身份证明;库外模型也会得到“最接近”的候选。
