import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Layout } from "../components/Layout.tsx";
import DashboardApp from "../islands/DashboardApp.tsx";

export default define.page(function Dashboard() {
  return (
    <>
      <Head>
        <title>仪表盘 · TunTunShu</title>
      </Head>
      <Layout active="dashboard" footerIcons>
        <DashboardApp />
      </Layout>
    </>
  );
});
