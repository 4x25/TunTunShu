import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Layout } from "../components/Layout.tsx";
import SettingsApp from "../islands/SettingsApp.tsx";

export default define.page(function Settings() {
  return (
    <>
      <Head>
        <title>系统设置 · TunTunShu</title>
      </Head>
      <Layout active="settings">
        <SettingsApp />
      </Layout>
    </>
  );
});
