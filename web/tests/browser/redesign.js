// Run against the local preview with:
// playwright-cli run-code --filename=web/tests/browser/redesign.js
async (page) => {
  const context = await page.context().browser().newContext();
  const tab = await context.newPage();
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const account = "0x1111111111111111111111111111111111111111";
  const now = Date.now();
  const event = (id, title, host) => ({
    id, host, metadata: { title, starts_at: now + 86400000, ends_at: now + 90000000 },
    deposit: "10000000", mode: "Deposit", capacity: 50, status: "Open",
    guest_count: 1, attended_count: 0, total_pool: "10000000",
    payout_per_attendee: "0", created_at: now, closed_at: 0,
  });
  const fixtures = [event(1, "Guest event", "host.testnet"), event(2, "Owned event", account), event(3, "Door event", "host.testnet")];
  let failTeams = true;
  let failBalance = false;
  await context.addInitScript((account) => {
    localStorage.setItem("near-events:login", "evm");
    localStorage.setItem("near-me:appearance", "dark");
    window.ethereum = { request: async ({ method }) => {
      if (method === "eth_accounts") return [account];
      throw new Error("This check never signs or sends transactions");
    } };
  }, account);
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.url().includes("/api/cohosts?")) {
      return route.fulfill({ status: failTeams ? 503 : 200, json: failTeams ? { error: "Fixture outage" } : { cohosts: { 3: [account] } } });
    }
    if (request.url().includes("/api/event-visuals?")) return route.fulfill({ json: { visual: null, visuals: {} } });
    if (request.method() === "POST") {
      let body;
      try { body = request.postDataJSON(); } catch {}
      const method = body?.params?.method_name;
      if (method) {
        if (method === "balance_of" && failBalance) return route.fulfill({ json: { error: "Fixture outage" } });
        const value = {
          get_recent_events: fixtures, get_guest_statuses: ["Registered", null, null],
          get_event: fixtures[0], get_guests: [], balance_of: "0", ft_balance_of: "0", mt_balance_of: "0",
        }[method];
        if (value === undefined) throw new Error(`Unexpected fixture RPC: ${method}`);
        return route.fulfill({ json: { result: { result: Array.from(JSON.stringify(value), c => c.charCodeAt(0)) } } });
      }
    }
    return route.continue();
  });
  try {
    await tab.goto("http://localhost:3000/me");
    await tab.getByRole("button", { name: "Try again", exact: true }).waitFor();
    check(await tab.getByRole("heading", { name: "Guest event", exact: true }).count() > 0, "Door-team failure hid a registered guest's event");
    check(await tab.getByRole("heading", { name: "Owned event", exact: true }).count() > 0, "Door-team failure hid the owner's event");
    check(await tab.getByText("Door-team events could not be loaded.", { exact: false }).count() > 0, "Missing partial door-team error");
    failTeams = false;
    await tab.getByRole("button", { name: "Try again", exact: true }).click();
    await tab.getByRole("heading", { name: "Door event", exact: true }).waitFor();
    check(!await tab.getByText("Withdrawn", { exact: false }).count(), "Zero balance was described as withdrawn");
    failBalance = true;
    await tab.reload();
    await tab.getByText("Your Near Me balance is unavailable.", { exact: false }).waitFor();
    check((await tab.locator("#funds .gc-price").innerText()).includes("—"), "Failed balance was displayed as zero");

    await tab.setViewportSize({ width: 320, height: 900 });
    await tab.goto("http://localhost:3000/create?mode=Deposit&amount=10");
    await tab.getByRole("button", { name: "Change theme", exact: true }).click();
    check(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Create/theme picker overflows at 320px");
    await tab.getByRole("combobox", { name: "Appearance" }).selectOption("light");
    check(await tab.evaluate(() => document.documentElement.dataset.theme === "light"), "Light appearance did not apply");

    await tab.goto("http://localhost:3000/embed/e/1?theme=light&accent=%236550b9");
    await tab.locator(".btn-accent").waitFor();
    const buttonColor = await tab.locator(".btn-accent").evaluate(el => getComputedStyle(el).color);
    check(buttonColor === "rgb(255, 255, 255)", "Custom iris embed button inherited dark text");
    const semanticColor = await tab.locator(".embed").evaluate(el => getComputedStyle(el).getPropertyValue("--good").trim());
    check(semanticColor === "#237a57", "Forced light embed inherited dark status colors");
    if (failures.length) throw new Error(failures.join("\n"));
    return "Passed: partial profile outage/retry, zero/failed balances, mobile creator, appearance, embed contrast";
  } finally {
    await context.close();
  }
}
