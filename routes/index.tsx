import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Layout } from "../components/Layout.tsx";
import {
  IconChartLine,
  IconColumns,
  IconGear,
  IconLayers,
  IconLock,
  IconLogList,
} from "../components/icons.tsx";

const CARDS = [
  {
    href: "/dashboard",
    icon: IconChartLine,
    title: "首页仪表盘",
    desc:
      "请求成功率趋势（成功 / 失败分系列、小时维度），核心指标与上游状态概览。",
    go: "/dashboard →",
  },
  {
    href: "/upstream",
    icon: IconColumns,
    title: "上游管理",
    desc: "站点 → 账号 → APIKey → 模型 四列联动下钻，逐列关键词筛选与创建。",
    go: "/upstream →",
  },
  {
    href: "/models",
    icon: IconLayers,
    title: "模型管理",
    desc: "统一对外模型名、所属系列、可用通道健康度、调用量与延迟。",
    go: "/models →",
  },
  {
    href: "/logs",
    icon: IconLogList,
    title: "请求日志",
    desc:
      "高密度请求流水：状态、模型映射、上游、HTTP、Tokens、延迟，失败可展开。",
    go: "/logs →",
  },
  {
    href: "/settings",
    icon: IconGear,
    title: "系统设置",
    desc: "访问安全、中转策略、定时任务、数据与日志、外观主题等实例级配置。",
    go: "/settings →",
  },
  {
    href: "/login",
    icon: IconLock,
    title: "登录页",
    desc: "居中密码卡片，校验后进入上中下结构的控制台。",
    go: "/login →",
    dashed: true,
  },
];

export default define.page(function Home() {
  return (
    <>
      <Head>
        <title>TunTunShu · 多 AI 接口聚合中转站</title>
      </Head>
      <Layout
        brandHref="/"
        actions={<a class="btn btn-primary btn-sm" href="/login">进入控制台</a>}
      >
        <section class="lead-card">
          <span class="logo-mark">TT</span>
          <div>
            <h1>TunTunShu</h1>
            <p>
              面向个人单人使用的多 AI 接口（new-api）聚合中转站 ·
              信息密度优先的控制台
            </p>
            <div class="meta-row">
              <span class="tag">响应式 Web</span>
              <span class="tag">深 / 浅双主题</span>
              <span class="tag">青蓝 · Tech-utility</span>
              <span class="pill pill-ok">
                <span class="dot"></span>原型预览
              </span>
            </div>
          </div>
          <span class="spacer"></span>
          <a class="btn btn-primary" href="/dashboard">打开仪表盘 →</a>
        </section>

        <div class="page-head" style="margin-bottom:12px">
          <h2 class="page-title" style="font-size:15px">页面一览</h2>
        </div>

        <div class="launch-grid">
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <a
                class={c.dashed ? "lcard login-card-lc" : "lcard"}
                href={c.href}
              >
                <span class="ico">
                  <Icon />
                </span>
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
                <span class="go">{c.go}</span>
              </a>
            );
          })}
        </div>
      </Layout>
    </>
  );
});
