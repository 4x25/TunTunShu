import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Layout } from "../components/Layout.tsx";
import LogsApp from "../islands/LogsApp.tsx";

export default define.page(function Logs() {
  return (
    <>
      <Head>
        <title>日志 · TunTunShu</title>
      </Head>
      <Layout active="logs">
        <LogsApp />
      </Layout>
    </>
  );
});
