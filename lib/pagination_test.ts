import { PageParamError, pageResult, parsePageParams } from "./pagination.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`assertEquals failed: ${a} !== ${b}`);
  }
}

function assertThrows(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof PageParamError) return;
    throw new Error(`unexpected error: ${String(error)}`);
  }
  throw new Error("expected PageParamError");
}

function req(query = ""): Request {
  return new Request(`http://local.test/api/sites${query}`);
}

Deno.test("parsePageParams 使用默认分页", () => {
  assertEquals(parsePageParams(req()), {
    pageSize: 50,
    pageIndex: 1,
    offset: 0,
    q: "",
    siteQ: "",
    accountQ: "",
    apiKeyQ: "",
    modelQ: "",
  });
});

Deno.test("parsePageParams pageSize 最大为 50", () => {
  assertEquals(parsePageParams(req("?pageSize=999&pageIndex=2")), {
    pageSize: 50,
    pageIndex: 2,
    offset: 50,
    q: "",
    siteQ: "",
    accountQ: "",
    apiKeyQ: "",
    modelQ: "",
  });
});

Deno.test("parsePageParams 解析搜索词和父级 id", () => {
  assertEquals(
    parsePageParams(
      req(
        "?pageSize=20&pageIndex=3&q=%20abc%20&siteQ=s&accountQ=a&apiKeyQ=k&modelQ=m&siteId=11&accountId=22",
      ),
      ["siteId", "accountId"],
    ),
    {
      pageSize: 20,
      pageIndex: 3,
      offset: 40,
      q: "abc",
      siteQ: "s",
      accountQ: "a",
      apiKeyQ: "k",
      modelQ: "m",
      siteId: 11,
      accountId: 22,
    },
  );
});

Deno.test("parsePageParams q 按接口别名映射到路径搜索字段", () => {
  assertEquals(parsePageParams(req("?q=%20abc%20"), [], "modelQ"), {
    pageSize: 50,
    pageIndex: 1,
    offset: 0,
    q: "abc",
    siteQ: "",
    accountQ: "",
    apiKeyQ: "",
    modelQ: "abc",
  });
  assertEquals(parsePageParams(req("?q=old&modelQ=new"), [], "modelQ"), {
    pageSize: 50,
    pageIndex: 1,
    offset: 0,
    q: "old",
    siteQ: "",
    accountQ: "",
    apiKeyQ: "",
    modelQ: "new",
  });
});

Deno.test("parsePageParams 非法参数返回 PageParamError", () => {
  assertThrows(() => parsePageParams(req("?pageSize=0")));
  assertThrows(() => parsePageParams(req("?pageIndex=abc")));
  assertThrows(() => parsePageParams(req("?siteId=-1"), ["siteId"]));
  assertThrows(() => parsePageParams(req("?apiKeyId=x"), ["apiKeyId"]));
});

Deno.test("pageResult 返回分页对象形状", () => {
  const params = parsePageParams(req("?pageSize=2&pageIndex=2"));
  assertEquals(pageResult([{ id: 3 }], params, 3), {
    items: [{ id: 3 }],
    pageSize: 2,
    pageIndex: 2,
    totalCount: 3,
  });
});
