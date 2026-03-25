(function () {
  var t = localStorage.getItem("yt-dlp-ext:theme");
  var dark =
    t === "dark" ||
    (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
})();
