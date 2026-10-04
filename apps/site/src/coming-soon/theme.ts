/**
 * Light and dark switch. The page follows the system preference until the visitor picks a
 * theme; the choice is saved and applied before the first paint by /coming-soon-theme.js.
 */
const STORAGE_KEY = "passripple-theme";
const THEME_COLORS = { light: "#FAF9F6", dark: "#0F172A" } as const;
type Theme = keyof typeof THEME_COLORS;

const root = document.documentElement;
const toggle = document.querySelector<HTMLButtonElement>(".theme-toggle");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function chosenTheme(): Theme | undefined {
  const theme = root.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : undefined;
}

function currentTheme(): Theme {
  return chosenTheme() ?? (systemDark.matches ? "dark" : "light");
}

/** Keeps the button label and the browser bar color in step with the visible theme. */
function sync(): void {
  const theme = currentTheme();
  toggle?.setAttribute(
    "aria-label",
    theme === "dark" ? "Activar modo claro" : "Activar modo oscuro",
  );
  if (chosenTheme()) {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = THEME_COLORS[theme];
    }
  }
}

toggle?.addEventListener("click", () => {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage is blocked: the choice lasts until the page is closed.
  }
  sync();
});
systemDark.addEventListener("change", sync);
sync();
