// Applies the theme the visitor chose on the coming-soon page before the first paint.
// Without a saved choice the page follows the system preference (coming-soon.css).
try {
  const theme = localStorage.getItem("passripple-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // Storage is blocked: the system preference applies.
}
