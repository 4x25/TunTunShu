import { define } from "../utils.ts";

// 进首屏前根据 localStorage / 系统偏好设置 data-theme，避免主题闪烁（FOUC）。
// 与原型各页 <head> 中的内联脚本保持一致（key = tts-theme）。
const themeBootstrap =
  `(function(){try{var t=localStorage.getItem('tts-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default define.page(function App({ Component }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>TunTunShu · 多 AI 接口聚合中转站</title>
        {/* 内联引导脚本（常量、无 HTML 特殊字符），首屏前设定主题 */}
        <script>{themeBootstrap}</script>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});
