import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Layout } from "../components/Layout.tsx";
import ModelsApp from "../islands/ModelsApp.tsx";

export default define.page(function Models() {
  return (
    <>
      <Head>
        <title>模型管理 · TunTunShu</title>
      </Head>
      <Layout active="models">
        <ModelsApp />
      </Layout>
    </>
  );
});
