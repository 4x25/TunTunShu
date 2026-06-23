import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Layout } from "../components/Layout.tsx";
import UpstreamApp from "../islands/UpstreamApp.tsx";

export default define.page(function Upstream() {
  return (
    <>
      <Head>
        <title>上游管理 · TunTunShu</title>
      </Head>
      <Layout active="upstream">
        <UpstreamApp />
      </Layout>
    </>
  );
});
