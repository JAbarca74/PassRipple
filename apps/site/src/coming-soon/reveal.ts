/** Fades sections in as they scroll into view, and shades the nav once the page scrolls. */
const reveals = document.querySelectorAll(".reveal");
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.12 },
);
for (const el of reveals) observer.observe(el);

const nav = document.querySelector("nav");
const shadeNav = () => nav?.classList.toggle("is-scrolled", window.scrollY > 8);
window.addEventListener("scroll", shadeNav, { passive: true });
shadeNav();
