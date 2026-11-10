"use client";

import { useEffect, useState } from "react";

type Appearance = "system" | "light" | "dark";

export function AppearancePicker() {
  const [appearance, setAppearance] = useState<Appearance>("system");
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setAppearance(current === "light" || current === "dark" ? current : "system");
  }, []);

  function change(value: Appearance) {
    setAppearance(value);
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    try { localStorage.setItem("near-me:appearance", value); } catch {}
  }

  return (
    <label className="gc-appearance">
      <span>Appearance</span>
      <select aria-label="Appearance" value={appearance} onChange={(event) => change(event.target.value as Appearance)}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
