// Zoom della mappa a passi (doppio clic su un punto vuoto, pulsanti + e −): animato, agli stessi limiti della rotella.
export const ZOOM_MAX = 2.4;
const PASSO_ZOOM = 1.5;
let anim = 0;
// `centro` (punto del mondo): la vista si porta lì; senza, resta sul centro attuale. Un nuovo zoom o la rotella (`ferma`) interrompono quello in corso.
function zoomAnimato(M, zMin, zFine, centro, tocca) {
  const da = { x: M.cam.x, y: M.cam.y, z: M.cam.z }, z1 = Math.min(ZOOM_MAX, Math.max(zMin, zFine)), a = centro || da;
  const t0 = performance.now(), id = ++anim;
  const passo = (t) => {
    if (id !== anim) return;
    const k = Math.min(1, (t - t0) / 220), e = 1 - (1 - k) ** 3;
    M.cam.x = da.x + (a.x - da.x) * e; M.cam.y = da.y + (a.y - da.y) * e; M.cam.z = da.z + (z1 - da.z) * e;
    tocca(); if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}
export const fermaZoom = () => { anim++; };
// doppio clic su un punto vuoto (`vuoto(x, y)`, in pixel della tela): un passo avanti, centrato lì; i pulsanti + e − zoomano sul centro della vista
export function initZoom({ M, zMin, mondo, tocca, vuoto }) {
  const zoom = (z, centro) => zoomAnimato(M, zMin, z, centro, tocca);
  M.cv.addEventListener("dblclick", (e) => {
    const r = M.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (vuoto(x, y)) zoom(M.cam.z * PASSO_ZOOM, mondo(x, y));
  });
  document.getElementById("m-zoom-piu").onclick = () => zoom(M.cam.z * PASSO_ZOOM);
  document.getElementById("m-zoom-meno").onclick = () => zoom(M.cam.z / PASSO_ZOOM);
}
