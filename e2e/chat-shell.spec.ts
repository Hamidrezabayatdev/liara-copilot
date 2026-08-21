import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const DISCONNECTED_ACCOUNT = {
  connected: false,
  source: null,
  teamId: null,
  canConnect: true,
  sharedTokenAllowed: false,
};

async function mockAccount(page: Page) {
  await page.route("**/api/account", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(DISCONNECTED_ACCOUNT),
    });
  });
}

async function fulfillAssistantStream(route: Route, markdown: string) {
  const chunks = [
    { type: "start", messageId: "assistant-e2e" },
    { type: "start-step" },
    { type: "text-start", id: "answer" },
    { type: "text-delta", id: "answer", delta: markdown },
    { type: "text-end", id: "answer" },
    { type: "finish-step" },
    { type: "finish", finishReason: "stop" },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;

  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
    body,
  });
}

async function fulfillToolThenAnswerStream(route: Route, markdown: string) {
  const chunks = [
    { type: "start", messageId: "assistant-tool-e2e" },
    { type: "start-step" },
    {
      type: "tool-input-available",
      toolCallId: "docs-e2e",
      toolName: "searchDocs",
      input: { query: "Health Check" },
    },
    {
      type: "tool-output-available",
      toolCallId: "docs-e2e",
      output: {
        ok: true,
        data: {
          sources: [
            {
              id: "health-check-doc",
              kind: "docs",
              title: "Health Check",
              snippet: "تنظیمات Health Check اپلیکیشن",
              url: "https://docs.liara.ir/paas/details/health-check/",
            },
          ],
        },
      },
    },
    { type: "finish-step" },
    { type: "start-step" },
    { type: "text-start", id: "answer-after-tool" },
    { type: "text-delta", id: "answer-after-tool", delta: markdown },
    { type: "text-end", id: "answer-after-tool" },
    { type: "finish-step" },
    { type: "finish", finishReason: "stop" },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;

  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
    body,
  });
}

async function expectNoAccessibilityViolations(page: Page) {
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await mockAccount(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "چه چیزی را بررسی کنیم؟" })).toBeVisible();
});

test("the primary chat journey is keyboard-friendly and renders streamed Markdown", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let chatRequests = 0;
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await fulfillAssistantStream(
      route,
      "## پاسخ آزمایشی\n\nسرویس **پایدار** است و دستور `pnpm build` آمادهٔ اجراست.",
    );
  });

  const skipLink = page.getByRole("link", { name: "رفتن به گفتگو" });
  // Explicit focus avoids the Next.js development toolbar becoming the first
  // tab stop locally; production has no injected toolbar.
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");
  await expect(page.locator("#conversation-main")).toBeFocused();

  const composer = page.getByRole("textbox", { name: "پیام به دستیار" });
  await composer.fill("وضعیت سرویس را بگو");
  await composer.press("Shift+Enter");
  await composer.type("و منبع را هم نشان بده");
  expect(chatRequests).toBe(0);

  await composer.press("Enter");

  await expect(page.getByText("وضعیت سرویس را بگو\nو منبع را هم نشان بده")).toBeVisible();
  const userText = page.locator('[data-role="user"] p').last();
  await expect(userText).toHaveCSS("overflow-wrap", "anywhere");
  await expect(page.getByRole("heading", { name: "پاسخ آزمایشی" })).toBeVisible();
  await expect(page.getByText("pnpm build", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("");
  expect(chatRequests).toBe(1);
  await expectNoAccessibilityViolations(page);
});

test("tool activity is shown before the final answer", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    await fulfillToolThenAnswerStream(
      route,
      "## پاسخ نهایی\n\nHealth Check برای سرویس فعال است.",
    );
  });

  const composer = page.getByRole("textbox", { name: "پیام به دستیار" });
  await composer.fill("Health Check را بررسی کن");
  await composer.press("Enter");

  const assistant = page.locator('[data-role="assistant"]').last();
  const activity = assistant.locator('[data-slot="assistant-activity"]');
  const answer = assistant.locator('[data-slot="assistant-answer"]');
  await expect(activity.getByRole("button", { name: /منبع رسمی پیدا شد/ })).toBeVisible();
  await expect(answer.getByRole("heading", { name: "پاسخ نهایی" })).toBeVisible();
  await expect(answer).toBeInViewport();

  const activityComesFirst = await assistant.evaluate((message) => {
    const activityNode = message.querySelector('[data-slot="assistant-activity"]');
    const answerNode = message.querySelector('[data-slot="assistant-answer"]');
    return Boolean(
      activityNode &&
        answerNode &&
        activityNode.compareDocumentPosition(answerNode) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(activityComesFirst).toBe(true);
});

test("Markdown tables use one clean surface with centered cells", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/chat", async (route) => {
    await fulfillAssistantStream(
      route,
      [
        "| نام برنامه | وضعیت | دامنه پیش‌فرض |",
        "| --- | --- | --- |",
        "| `liara-copilot-ir` | ACTIVE | `liara-copilot-ir.iran.liara.run` |",
      ].join("\n"),
    );
  });

  const composer = page.getByRole("textbox", { name: "پیام به دستیار" });
  await composer.fill("برنامه‌ها را به شکل جدول نشان بده");
  await composer.press("Enter");

  const wrapper = page.locator('[data-streamdown="table-wrapper"]');
  const scrollSurface = wrapper.locator(":scope > div").last();
  const table = wrapper.getByRole("table");
  await expect(table).toBeVisible();
  await expect(wrapper).toHaveCSS("border-top-width", "0px");
  await expect(scrollSurface).toHaveCSS("border-top-width", "0px");
  await expect(table).toHaveCSS("display", "table");
  await expect(table.getByRole("columnheader").first()).toHaveCSS("text-align", "center");
  await expect(table.getByRole("cell").first()).toHaveCSS("text-align", "center");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("disconnected account actions are gated and typed account requests explain the next step", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: "برنامه‌ها" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "مستندات" })).toBeVisible();

  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: "برای بررسی منابع و وضعیت حساب، ابتدا حساب Liara خود را متصل کنید.",
      }),
    });
  });

  const composer = page.getByRole("textbox", { name: "پیام به دستیار" });
  await composer.fill("برنامه‌های حسابم را بررسی کن");
  await composer.press("Enter");

  await expect(
    page.getByText("برای بررسی منابع و وضعیت حساب، ابتدا حساب Liara خود را متصل کنید."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "تلاش مجدد" })).toHaveCount(0);
});

test("theme, account dialog, layout, and accessibility work without secrets", async ({
  page,
}) => {
  // Keep axe snapshots deterministic: Radix briefly blends foreground colors
  // during its fade/zoom transition, which is not the settled UI users read.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const root = page.locator("html");
  const themeToggle = page.getByRole("button", { name: "حالت روشن" });
  await expect(themeToggle).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await themeToggle.click();
  await expect(root).not.toHaveClass(/\bdark\b/);
  await expect(page.getByRole("button", { name: "حالت تیره" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "چه چیزی را بررسی کنیم؟" })).toBeVisible();
  await expect(page.getByRole("button", { name: "حالت تیره" })).toBeVisible();

  const accountButton = page.getByRole("button", { name: "اتصال حساب" });
  await accountButton.click();
  await expect(page.getByRole("dialog", { name: "اتصال حساب لیارا" })).toBeVisible();
  await expect(page.getByLabel("Liara API key")).toBeFocused();

  await expectNoAccessibilityViolations(page);

  await page.keyboard.press("Escape");
  await expect(accountButton).toBeFocused();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
