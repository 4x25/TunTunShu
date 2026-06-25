// 代理会话启动页。后台「登录」按钮打开 /up/start?ticket=<会话令牌>。
// 本页注册 Service Worker、把令牌交给它(等待 ack 以避免竞态),再导航到 /?__ttsup=1 进入代理。
import { define } from "../../utils.ts";
import { verifyProxyToken } from "../../lib/proxy_session.ts";

const LAUNCHER_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>进入上游后台…</title>
<meta name="robots" content="noindex">
<style>body{font:14px/1.6 system-ui,-apple-system,sans-serif;color:#475569;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}</style>
</head>
<body>
<div id="msg">正在进入上游后台…</div>
<script>
(async function(){
  var msg=document.getElementById('msg');
  function fail(t){msg.textContent=t;}
  try{
    var ticket=new URLSearchParams(location.search).get('ticket');
    if(!ticket){return fail('缺少登录票据');}
    if(!('serviceWorker' in navigator)){return fail('当前环境不支持 Service Worker(需经 HTTPS 访问)');}
    var reg=await navigator.serviceWorker.register('/tts-proxy-sw.js');
    await navigator.serviceWorker.ready;
    var sw=reg.active||navigator.serviceWorker.controller;
    if(!sw){return fail('Service Worker 未激活,请重试');}
    await new Promise(function(res){
      var ch=new MessageChannel();var done=false;
      ch.port1.onmessage=function(){if(!done){done=true;res();}};
      setTimeout(function(){if(!done){done=true;res();}},3000);
      sw.postMessage({type:'start',token:ticket},[ch.port2]);
    });
    location.replace('/?__ttsup=1');
  }catch(e){fail('启动失败:'+((e&&e.message)||e));}
})();
</script>
</body>
</html>`;

export const handler = define.handlers({
  async GET(ctx) {
    const ticket = new URL(ctx.req.url).searchParams.get("ticket");
    if (!ticket || (await verifyProxyToken(ticket)) == null) {
      return new Response("无效或过期的登录票据", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(LAUNCHER_HTML, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
});
