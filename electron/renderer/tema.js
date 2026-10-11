(() => {
  let tema = "claro";
  try {
    const guardado = localStorage.getItem("vigencia-tema");
    if (guardado === "oscuro" || guardado === "claro") tema = guardado;
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) tema = "oscuro";
  } catch {
    /* el tema sigue en claro si el almacenamiento no está */
  }
  document.documentElement.dataset.tema = tema;
})();
