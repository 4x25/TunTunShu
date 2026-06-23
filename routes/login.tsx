import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import ThemeToggle from "../islands/ThemeToggle.tsx";
import LoginCard from "../islands/LoginCard.tsx";

export default define.page(function Login() {
  return (
    <>
      <Head>
        <title>登录 · TunTunShu</title>
      </Head>
      <div class="login-page">
        <ThemeToggle class="login-toggle" />
        <LoginCard />
      </div>
    </>
  );
});
