// Lo stile della barra comune, del cassetto Artifax e della tendina Consumo. Colori dalla palette (palette.css), nei due temi.
// L'altezza della barra sta nella variabile --nav-h, che la barra imposta su <html>.

export const CSS_BARRA = `
.rdnav button.tema{
  font:inherit; cursor:pointer; background:none; color:var(--pl-text2); width:32px; height:30px; padding:0; border:1px solid var(--pl-line2);
  border-radius:999px; margin-right:6px; display:grid; place-items:center;}
.rdnav button.tema:hover{color:var(--pl-text)}
.rdnav button.tema svg{width:16px;height:16px}
.rdnav{
  position:sticky; top:0; z-index:2147482000; height:var(--nav-h,44px); display:flex; align-items:center; gap:6px; padding:0 14px;
  background:var(--pl-deep); border-bottom:1px solid var(--pl-line); font:13px/1 system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--pl-text);}
.rdnav .marchio{display:flex;align-items:center;gap:8px;font-weight:650;letter-spacing:.2px;margin-right:12px;white-space:nowrap}
.rdnav .marchio i{width:8px;height:8px;border-radius:50%;background:var(--pl-sonar);box-shadow:0 0 10px var(--pl-sonar)}
.rdnav a.voce{color:var(--pl-text2);text-decoration:none;padding:7px 12px;border-radius:999px;white-space:nowrap}
.rdnav a.voce:hover{color:var(--pl-text);background:rgb(var(--pl-tinta-rgb) / .05)}
.rdnav a.voce[aria-current=page]{color:var(--pl-su-sonar);background:var(--pl-sonar);font-weight:600}
.rdnav a.voce small{opacity:.65;margin-left:6px;font-size:11.5px}
.rdnav a.voce[aria-current=page] small{opacity:.75}
.rdnav .sp{flex:1}
.rdnav details{position:relative}
.rdnav summary{list-style:none;cursor:pointer;color:var(--pl-text2);padding:7px 12px;border:1px solid var(--pl-line2);border-radius:999px}
.rdnav summary::-webkit-details-marker{display:none}
.rdnav details[open] summary{color:var(--pl-sonar);border-color:var(--pl-sonar-dim)}
.rdnav .pop{
  position:absolute; right:0; top:calc(100% + 8px); width:300px; background:var(--pl-deep); border:1px solid var(--pl-line2); border-radius:12px;
  box-shadow:0 18px 40px rgb(var(--pl-ombra-rgb) / calc(.45 * var(--pl-ombra-k))); padding:12px; display:grid; gap:10px; line-height:1.4;}
.rdnav .pop label{display:grid;gap:5px;color:var(--pl-text2)}
.rdnav .pop b{color:var(--pl-text)}
.rdnav .pop select,.rdnav .pop textarea{font:inherit;background:var(--pl-campo);border:1px solid var(--pl-line2);border-radius:8px;padding:6px 8px;color:var(--pl-text)}
.rdnav .pop textarea{resize:vertical;font-size:12.5px}
.rdnav .pop input[type=range]{accent-color:var(--pl-sonar)}
.rdnav .pop button{
  font:inherit; border:0; background:var(--pl-sonar); color:var(--pl-su-sonar); font-weight:600; border-radius:999px; padding:6px 14px; cursor:pointer;
  justify-self:start;}
.rdnav .esito{color:var(--pl-muted);font-size:12px}
.rdnav button.artifax{
  font:inherit; cursor:pointer; background:none; color:var(--pl-text2); padding:7px 12px; border:1px solid var(--pl-line2); border-radius:999px;
  margin-right:6px;}
.rdnav button.artifax[aria-expanded=true]{color:var(--pl-sonar);border-color:var(--pl-sonar-dim)}
.rdnav details.consumo summary{display:flex;align-items:center;gap:7px;white-space:nowrap;font-variant-numeric:tabular-nums}
.rdnav details.consumo summary i{width:8px;height:8px;border-radius:50%;background:var(--pl-sonar);flex:none}
.rdnav details.consumo summary b{color:var(--pl-text);font-weight:600}
.rdnav details.consumo[data-livello=attenz] summary{border-color:var(--pl-attenz)}
.rdnav details.consumo[data-livello=attenz] i{background:var(--pl-attenz)}
.rdnav details.consumo[data-livello=critico] summary{border-color:var(--pl-critico)}
.rdnav details.consumo[data-livello=critico] i{background:var(--pl-critico)}
.rdnav details.consumo[data-vecchio] summary b{color:var(--pl-text2);font-weight:500}
.rdnav details.consumo .seg{font-weight:700}
.rdnav .rdc{gap:12px;font-size:12.5px;color:var(--pl-text2);font-variant-numeric:tabular-nums}
.rdnav .rdc .r{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.rdnav .rdc .r b{font-size:16px}
.rdnav .rdc .barra{position:relative;height:6px;border-radius:3px;background:rgb(var(--pl-tinta-rgb) / .1);margin:5px 0 4px;overflow:hidden}
.rdnav .rdc .barra i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--pl-sonar)}
.rdnav .rdc .barra u{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(135deg,var(--pl-sonar) 0 2px,transparent 2px 5px);opacity:.8}
.rdnav .rdc [data-livello=attenz] .barra i{background:var(--pl-attenz)}
.rdnav .rdc [data-livello=critico] .barra i{background:var(--pl-critico)}
.rdnav .rdc .barra.oltre u{background:repeating-linear-gradient(135deg,var(--pl-critico) 0 2px,transparent 2px 5px)}
.rdnav .rdc .m{color:var(--pl-muted);font-size:11.5px}
.rdnav .rdc .stima{border-top:1px solid var(--pl-line);padding-top:10px}
.rdnav .rdc .mod{display:flex;flex-wrap:wrap;gap:4px 12px}
.rdnav .rdc .mod span::before{content:"";display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;background:var(--c)}
.rdnav .rdc .piede{display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--pl-line);padding-top:8px}
.rdnav .rdc .piede a{color:var(--pl-sonar);cursor:pointer;text-decoration:none}
.rdnav .rdc .piede a:hover{text-decoration:underline}
@media (max-width:900px){.rdnav details.consumo .et{display:none}}
.rdartifax{
  position:fixed; z-index:2147482100; top:var(--nav-h,44px); right:0; bottom:0; width:min(420px,100vw); display:flex; flex-direction:column;
  background:var(--pl-deep); border-left:1px solid var(--pl-line2); box-shadow:-18px 0 40px rgb(var(--pl-ombra-rgb) / calc(.4 * var(--pl-ombra-k)));
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--pl-text);}
.rdartifax[hidden]{display:none}
.rdartifax .t{display:flex;align-items:center;gap:8px;padding:12px 14px 6px}
.rdartifax .t b{font-size:15px;flex:1}
.rdartifax .t button{font:inherit;background:none;border:0;color:var(--pl-text2);cursor:pointer;font-size:16px}
.rdartifax input{margin:4px 14px 10px;font:inherit;background:var(--pl-campo);border:1px solid var(--pl-line2);border-radius:8px;padding:7px 10px;color:var(--pl-text)}
.rdartifax ul{list-style:none;margin:0;padding:0 8px 14px;overflow:auto;flex:1}
.rdartifax li button{all:unset;box-sizing:border-box;display:grid;grid-template-columns:62px 1fr;gap:2px 10px;width:100%;padding:8px 8px;border-radius:8px;cursor:pointer}
.rdartifax li button:hover,.rdartifax li button:focus-visible{background:rgb(var(--pl-tinta-rgb) / .06)}
.rdartifax li button:focus-visible{outline:2px solid var(--pl-sonar)}
.rdartifax li .k{
  grid-row:span 2; align-self:start; font-size:11px; color:var(--pl-su-sonar); background:var(--pl-sonar); border-radius:999px; padding:2px 0;
  text-align:center; font-weight:600;}
.rdartifax li .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rdartifax li .m{color:var(--pl-muted);font-size:12px}
.rdartifax li.manca .n{opacity:.5;text-decoration:line-through}
.rdartifax .vuoto{color:var(--pl-muted);padding:14px;font-size:12.5px}
.rdnav :focus-visible{outline:2px solid var(--pl-sonar);outline-offset:2px}
@media (max-width:640px){.rdnav .marchio span,.rdnav a.voce small{display:none}.rdnav{gap:2px;padding:0 8px}}`;
