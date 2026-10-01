"use strict";
/* Resultado RJ — votação detalhada (TSE). App estático: lê os JSON gerados por processar.py */

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const NF = new Intl.NumberFormat("pt-BR");
const CORES_CARGO = { 7: "#16a0e6", 6: "#e30613", 5: "#e30613", 3: "#1717a6", 1: "#e30613" };
const CURTO = { 7: "Dep. Estadual", 6: "Dep. Federal", 5: "Senador", 3: "Governador", 1: "Presidente" };
const MAJ = new Set([1, 3, 5]);
const FAV_PADRAO = ["7:13567", "5:131", "6:1300", "3:55", "1:13"];
const PASSO = 20;
const zerado = () => IDX && IDX.modelo;

let IDX = null, VER = "";
const cache = new Map();
const estado = { t: 1, c: 7, aba: {}, ordMun: "nome", mostrar: {}, verPor: "cand", grupo: "" };

/* ---------------- utilidades ---------------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = x => NF.format(x || 0);
function pct(a, b) {
  if (!b) return "–";
  const p = (100 * a) / b;
  return (p < 1 && p > 0 ? p.toFixed(2) : p.toFixed(1)).replace(".", ",") + "%";
}
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const titulo = s => String(s || "").toLowerCase().replace(/(^|[\s\-/(])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Da|Do|Das|Dos|E)\b/g, w => w.toLowerCase());

function json(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url + (VER ? "?v=" + VER : "")).then(r => {
      if (!r.ok) throw new Error(r.status + " em " + url);
      return r.json();
    }).catch(e => { cache.delete(url); throw e; }));
  }
  return cache.get(url);
}
const base = () => `data/t${estado.t}/c${estado.c}`;
const cargoArq = (t = estado.t, c = estado.c) => json(`data/t${t}/c${c}.json`);
const munArq = m => json(`${base()}/m${m}.json`);
const zonaArq = (m, z) => json(`${base()}/m${m}/z${z}.json`);
const candArq = nr => json(`${base()}/cand/${nr}.json`);
const zlArq = () => json(`${base()}/zl.json`);
const locaisArq = () => json("data/locais.json");

/* favoritos (acompanhados) — só neste aparelho */
let FAVS;
try { FAVS = new Set(JSON.parse(localStorage.getItem("favs2") || "null") || FAV_PADRAO); } catch { FAVS = new Set(FAV_PADRAO); }
const ehFav = nr => FAVS.has(estado.c + ":" + nr);
function alternaFav(nr) {
  const k = estado.c + ":" + nr;
  FAVS.has(k) ? FAVS.delete(k) : FAVS.add(k);
  try { localStorage.setItem("favs2", JSON.stringify([...FAVS])); } catch {}
}

/* candidatos do cargo indexados por número */
const mapas = new Map();
async function candMap(t = estado.t, c = estado.c) {
  const k = t + ":" + c;
  if (!mapas.has(k)) {
    const d = await cargoArq(t, c);
    const m = new Map();
    d.cand.forEach((x, i) => m.set(x[0], { nr: x[0], nome: x[1], partido: x[2], sq: x[3], sit: x[4], votos: x[5], np: x[6], pos: i + 1 }));
    mapas.set(k, m);
  }
  return mapas.get(k);
}
const corPartido = np => (IDX.partidos[np] || [])[1] || "#5b6475";
const siglaPartido = np => (IDX.partidos[np] || [])[0] || String(np);
const nomeMun = cd => (IDX.munNome.get(+cd) || String(cd));

function foto(c, cls = "foto") {
  const cor = corPartido(c.np);
  const ini = (c.nome || "").split(/\s+/).filter(w => w.length > 2).slice(0, 2).map(w => w[0]).join("") || "?";
  if (c.sq) return `<span class="${cls}" style="background:${cor}"><img src="img/f/${c.sq}.webp" alt="" loading="lazy" decoding="async"></span>`;
  return `<span class="${cls}" style="background:${cor}">${esc(ini)}</span>`;
}
function selo(sit) {
  if (!sit) return "";
  if (/^ELEITO/.test(sit)) return `<span class="selo">${esc(sit.replace("ELEITO POR ", "ELEITO · "))}</span>`;
  if (/2º TURNO/.test(sit)) return `<span class="selo">2º turno</span>`;
  if (/SUPLENTE/.test(sit)) return `<span class="selo sup">Suplente</span>`;
  return "";
}

/* ---------------- blocos de tela ---------------- */
function stats(tot, extra = "") {
  const [aptos, comp, abst, val, br, nul] = tot;
  const temAptos = aptos > 0;
  if (!comp) return `<div class="stats">
    <div class="stat dest l2"><span>Eleitores aptos</span><b>${n(aptos)}</b><small>${n(tot[7])} ${tot[7] === 1 ? "seção" : "seções"}</small></div>
    <div class="stat l2 espera"><span>Resultado</span><b>Aguardando o TSE</b><small>votação em 4 de outubro</small></div></div>${extra}`;
  return `<div class="stats">
    ${temAptos ? `<div class="stat dest l2"><span>Comparecimento</span><b>${pct(comp, aptos)}</b><small>${n(comp)} de ${n(aptos)}</small></div>
    <div class="stat"><span>Abstenção</span><b>${pct(abst, aptos)}</b><small>${n(abst)}</small></div>`
      : `<div class="stat dest l2"><span>Votos</span><b>${n(comp)}</b><small>total</small></div>`}
    <div class="stat"><span>Válidos</span><b>${pct(val, comp)}</b><small>${n(val)}</small></div>
    <div class="stat"><span>Brancos</span><b>${pct(br, comp)}</b><small>${n(br)}</small></div>
    <div class="stat"><span>Nulos</span><b>${pct(nul, comp)}</b><small>${n(nul)}</small></div>
  </div>${extra}`;
}
function cab(num, txt, dir = "") {
  return `<div class="cab"><span class="num">${num}</span><h2>${txt}</h2>${dir ? `<span class="dir">${dir}</span>` : ""}</div>`;
}
function migalha(partes) {
  return `<nav class="migalha">${partes.map((p, i) => (i < partes.length - 1 && p[1] ? `<a href="${p[1]}">${esc(p[0])}</a><i>›</i>` : `<span>${esc(p[0])}</span>`)).join("")}</nav>`;
}

/* ---------- partidos e federações ---------- */
const fedDe = np => ((IDX.partidos[np] || [])[2]) || 0;
function grupoDe(np, modo) {
  const f = fedDe(np);
  return modo === "fed" && f ? "f" + f : "p" + np;
}
function infoGrupo(k) {
  const id = +k.slice(1);
  if (k[0] === "f") { const f = IDX.fed[id] || ["Federação " + id, "", "#5b6475"]; return { nome: f[0], sigla: f[1], cor: f[2], fed: true }; }
  const sg = siglaPartido(id), f = fedDe(id);
  return { nome: sg, sigla: String(id), cor: corPartido(id), fed: false, emFed: f ? (IDX.fed[f] || [""])[0] : "" };
}
function noGrupo(np, k) { return k[0] === "f" ? fedDe(np) === +k.slice(1) : np === +k.slice(1); }
function barraVerPor() {
  const vp = estado.verPor, temFed = IDX.fed && Object.keys(IDX.fed).length;
  let h = `<div class="verpor" role="tablist"><span class="rotulo">Ver por</span>
    <button data-verpor="cand" class="${vp === "cand" ? "on" : ""}">Por candidato</button>
    <button data-verpor="fed" class="${vp !== "cand" ? "on" : ""}">Por partido / federação</button></div>`;
  if (estado.grupo && vp === "cand") {
    const g = infoGrupo(estado.grupo);
    h += `<div class="filtro-ativo" style="--cor:${g.cor}"><span>Só <b>${esc(g.nome)}</b>${g.fed ? ` <small>${esc(g.sigla)}</small>` : ""}</span><button data-limpa aria-label="Tirar filtro">✕ Tirar filtro</button></div>`;
  }
  return h;
}
function rankingGrupos(cm, votos, validos, modo) {
  const acc = new Map();
  const soma = (k) => { if (!acc.has(k)) acc.set(k, { k, nom: 0, leg: 0, nc: 0, por: {} }); return acc.get(k); };
  const somaP = (g, np, v) => { g.por[np] = (g.por[np] || 0) + v; };
  for (const [nr, v] of votos) {
    if (nr > 0) { const c = cm.get(nr); const np = c ? c.np : +String(nr).slice(0, 2); const g = soma(grupoDe(np, modo)); g.nom += v; somaP(g, np, v); if (v) g.nc++; }
    else { const g = soma(grupoDe(-nr, modo)); g.leg += v; somaP(g, -nr, v); }
  }
  if (!validos) for (const c of cm.values()) { const g = soma(grupoDe(c.np, modo)); g.nc++; }
  const rows = [...acc.values()].map(g => ({ ...g, tot: g.nom + g.leg, ...infoGrupo(g.k) }))
    .sort((a, b) => b.tot - a.tot || a.nome.localeCompare(b.nome, "pt"));
  const max = rows.length ? rows[0].tot || 1 : 1;
  const tam = sg => sg.length <= 4 ? "" : sg.length <= 7 ? " m" : " p";
  return `<div class="lista">${rows.map((g, i) => `<button class="cand grupo" data-grupo="${g.k}" style="--cor:${g.cor}">
      <span class="pos">${g.tot ? i + 1 + "º" : ""}</span>
      <span class="sig${g.fed ? " p" : tam(g.nome)}">${g.fed ? esc(g.sigla).replace(/\//g, " ") : esc(g.nome)}</span>
      <span class="meio"><span class="nome">${esc(g.fed ? g.nome : g.nome)}</span>
        <span class="info">${g.fed ? `<span class="part">Federação</span>` : `<span class="part">Partido</span>`}
          <span>${n(g.nc)} ${g.nc === 1 ? "candidato" : "candidatos"}${validos && g.leg ? ` · legenda ${n(g.leg)}` : ""}</span></span>
        ${g.fed && validos ? `<span class="membros">${Object.entries(g.por).sort((a, b) => b[1] - a[1]).map(([np, v]) => `${esc(siglaPartido(+np))} <b>${n(v)}</b>`).join(" · ")}</span>` : ""}
        ${g.fed && !validos ? `<span class="membros">${esc(g.sigla.replace(/\//g, " · "))}</span>` : ""}
        ${validos ? `<span class="barra-v"><i style="width:${(100 * g.tot / max).toFixed(1)}%"></i></span>` : ""}</span>
      ${validos ? `<span class="votos"><b>${pct(g.tot, validos)}</b><span>${n(g.tot)}</span><small>votos</small></span>` : ""}</button>`).join("")
    || `<div class="vazio">Sem votos.</div>`}</div>
    <p class="nota">Federação conta como um partido só (soma dos partidos dela, com legenda). Toque para ver só os candidatos dela aqui. % sobre os votos válidos deste lugar.</p>`;
}

/** Ranking: votos = [[nr, v]] (nr negativo = legenda) */
function ranking(cm, votos, validos, id, opts = {}) {
  const topo = opts.semFiltro ? "" : barraVerPor();
  if (!opts.semFiltro && estado.verPor !== "cand") return topo + rankingGrupos(cm, votos, validos, "fed");
  const grp = opts.semFiltro ? "" : estado.grupo;
  if (grp) votos = votos.filter(([nr]) => { const np = nr > 0 ? ((cm.get(nr) || {}).np ?? +String(nr).slice(0, 2)) : -nr; return noGrupo(np, grp); });
  let cands = votos.filter(x => x[0] > 0);
  if (!cands.length && !validos) cands = [...cm.values()].filter(c => !grp || noGrupo(c.np, grp)).sort((a, b) => a.nome.localeCompare(b.nome, "pt")).map(c => [c.nr, 0]);
  const legs = votos.filter(x => x[0] < 0);
  const max = cands.length ? cands[0][1] : 1;
  const qtd = MAJ.has(estado.c) ? cands.length : (estado.mostrar[id] || (opts.passo || PASSO));
  const favs = grp ? [] : cands.map((x, i) => [x, i]).filter(([x]) => ehFav(x[0]));
  const linha = ([nr, v], i) => {
    const c = cm.get(nr) || { nr, nome: "Número " + nr, partido: "", np: +String(nr).slice(0, 2) };
    return `<a class="cand${ehFav(nr) ? " fav" : ""}" href="#/t${estado.t}/c${estado.c}/cand/${nr}" style="--cor:${corPartido(c.np)}">
      <span class="pos${i === 0 && v ? " r" : ""}">${v ? i + 1 + "º" : ""}</span>${foto(c)}
      <span class="meio"><span class="nome">${esc(c.nome)}</span>
        <span class="info"><span class="part">${esc(c.partido || siglaPartido(c.np))}</span>${nr}${opts.selo ? selo(c.sit) : ""}</span>
        <span class="barra-v"><i style="width:${(100 * v / max).toFixed(1)}%"></i></span></span>
      ${validos ? `<span class="votos"><b>${pct(v, validos)}</b><span>${n(v)}</span><small>votos</small></span>` : ""}</a>`;
  };
  let h = topo;
  if (favs.length && !MAJ.has(estado.c) && opts.favTopo !== false) {
    h += `<div class="rotulo" style="margin:0 2px 8px">Acompanhados aqui</div><div class="lista" style="margin-bottom:16px">${favs.map(([x, i]) => linha(x, i)).join("")}</div>
      <div class="rotulo" style="margin:0 2px 8px">Ranking</div>`;
  }
  h += `<div class="lista">${cands.slice(0, qtd).map(linha).join("") || `<div class="vazio">Sem votos.</div>`}</div>`;
  if (cands.length > qtd) h += `<button class="btn" data-mais="${id}" data-tot="${cands.length}">Ver mais (${n(cands.length - qtd)} restantes)</button>`;
  if (legs.length) {
    h += `<details class="leg" style="margin-top:10px"><summary>Votos de legenda (${n(legs.reduce((a, x) => a + x[1], 0))})</summary><table>${legs.map(([np, v]) => `<tr><td><span class="part" style="--cor:${corPartido(-np)}">${esc(siglaPartido(-np))}</span> ${-np}</td><td>${n(v)} <small style="color:var(--cinza);font-weight:500">${pct(v, validos)}</small></td></tr>`).join("")}</table></details>`;
  }
  return h;
}
function lider(cm, votos, validos) {
  const x = votos && votos.find(v => v[0] > 0);
  if (!x) return "";
  const c = cm.get(x[0]) || { nome: String(x[0]), np: 0 };
  return `<span class="lider">${foto(c, "mini")}<em>${esc(c.nome)}</em> · ${pct(x[1], validos)}</span>`;
}
const SETA = `<svg class="seta" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function abas(id, itens) {
  const at = estado.aba[id] || itens[0][0];
  return `<div class="abas" role="tablist">${itens.map(([k, t]) => `<button class="aba${k === at ? " on" : ""}" data-aba="${id}" data-k="${k}">${t}</button>`).join("")}</div>`;
}
const abaAtual = (id, padrao) => estado.aba[id] || padrao;

/* ---------------- telas ---------------- */
function hero(tit, sub, dentro) {
  $("#titulo").innerHTML = tit;
  $("#titulo").classList.toggle("longo", tit.replace(/<[^>]+>/g, "").length > 20);
  $("#sub").textContent = sub;
  document.body.classList.toggle("dentro", !!dentro);
  $("#voltar").hidden = !dentro;
}
const vagasTxt = () => { const c = IDX.turnos[estado.t].find(x => x.cd === estado.c); return c && c.vagas > 1 ? ` · ${c.vagas} vagas` : ""; };
const subCargo = () => `${IDX.cargoNome[estado.c] || ""} · ${estado.t}º turno`;

async function telaEstado() {
  hero(`RESULTADO <em>DETALHADO</em>`, `${subCargo()} — por município, zona, local e seção.`, false);
  const [d, cm] = await Promise.all([cargoArq(), candMap()]);
  const val = d.tot[3];
  const votos = d.cand.map(c => [c[0], c[5]]).concat(d.leg.map(([np, v]) => [-np, v]));
  const ordem = estado.ordMun;
  let muns = IDX.mun.filter(m => d.mun[m[0]]);
  if (ordem === "eleit") muns.sort((a, b) => d.mun[b[0]][0][0] - d.mun[a[0]][0][0]);
  const favsDoCargo = [...FAVS].filter(k => k.startsWith(estado.c + ":")).map(k => +k.split(":")[1]).filter(nr => cm.has(nr));
  app.innerHTML = `
    ${zerado() ? `<div class="aviso"><b>Modelo 2026</b>Candidatos, fotos, municípios, zonas, locais e seções já estão carregados. Os votos entram quando o TSE divulgar o resultado.</div>` : ""}
    <section class="card">${cab(1, "Rio de Janeiro", `${n(d.tot[7])} seções`)}${stats(d.tot)}</section>
    ${favsDoCargo.length ? `<section class="card">${cab(2, "Acompanhados", "toque para ver por lugar")}
      <div class="lista">${favsDoCargo.map(nr => cm.get(nr)).sort((a, b) => b.votos - a.votos).map(c => `
        <a class="cand fav" href="#/t${estado.t}/c${estado.c}/cand/${c.nr}" style="--cor:${corPartido(c.np)}">
        <span class="pos">${c.votos ? c.pos + "º" : ""}</span>${foto(c)}<span class="meio"><span class="nome">${esc(c.nome)}</span>
        <span class="info"><span class="part">${esc(c.partido)}</span>${c.nr}${selo(c.sit)}</span></span>
        ${val ? `<span class="votos"><b>${pct(c.votos, val)}</b><span>${n(c.votos)}</span><small>votos</small></span>` : ""}</a>`).join("")}</div></section>` : ""}
    <section class="card">${cab(favsDoCargo.length ? 3 : 2, "Votação", `${n(d.cand.length)} ${zerado() ? "candidatos" : "com voto"}${vagasTxt()}`)}
      <label class="campo"${estado.verPor !== "cand" ? " hidden" : ""}><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>
      <input id="fCand" type="search" placeholder="Filtrar por nome, número ou partido" autocomplete="off"></label>
      <div id="rk">${ranking(cm, votos, val, "est", { selo: true, favTopo: false })}</div></section>
    <section class="card">${cab(favsDoCargo.length ? 4 : 3, "Municípios", "92")}
      <label class="campo"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>
      <input id="fMun" type="search" placeholder="Buscar município" autocomplete="off"></label>
      <div class="ord"><button data-ord="nome" class="${ordem === "nome" ? "on" : ""}">A–Z</button><button data-ord="eleit" class="${ordem === "eleit" ? "on" : ""}">Maior eleitorado</button></div>
      <div id="lMun">${muns.map(([cd, nm]) => {
        const [tot, top] = d.mun[cd];
        return `<a class="linha" data-nm="${esc(norm(nm))}" href="#/t${estado.t}/c${estado.c}/m/${cd}">
          <span class="meio"><b>${esc(titulo(nm))}</b><small>${n(tot[0] || tot[1])} ${tot[0] ? "eleitores" : "votos"} · ${n(tot[7])} seções</small>${lider(cm, top, tot[3])}</span>${SETA}</a>`;
      }).join("")}</div></section>`;
  filtroLista("#fMun", "#lMun .linha");
  const f = $("#fCand");
  f.addEventListener("input", () => {
    const q = norm(f.value.trim());
    const vs = !q ? votos : d.cand.filter(c => String(c[0]).startsWith(q) || norm(c[1]).includes(q) || norm(c[2]) === q).map(c => [c[0], c[5]]);
    if (q) estado.mostrar.est = 60;
    $("#rk").innerHTML = ranking(cm, vs, val, "est", { selo: true, favTopo: false });
  });
}

function filtroLista(inp, itens) {
  const i = $(inp);
  i && i.addEventListener("input", () => {
    const q = norm(i.value.trim());
    document.querySelectorAll(itens).forEach(el => { el.hidden = q && !el.dataset.nm.includes(q); });
  });
}

async function telaMun(cd) {
  const nm = titulo(nomeMun(cd));
  hero(esc(nm).toUpperCase(), subCargo(), true);
  const [d, cm, loc] = await Promise.all([munArq(cd), candMap(), locaisArq()]);
  const aba = abaAtual("mun", "cand");
  const rot = `#/t${estado.t}/c${estado.c}/m/${cd}`;
  let corpo = "";
  if (aba === "cand") corpo = ranking(cm, d.v, d.tot[3], "m" + cd, { selo: true });
  else if (aba === "zona") corpo = d.z.map(([z, tot, v]) => `<a class="linha" href="${rot}/z/${z}"><span class="tag">${z}</span>
      <span class="meio"><b>Zona ${z}</b><small>${n(tot[7])} seções · ${tot[0] ? n(tot[0]) + " eleitores" : n(tot[1]) + " votos"}</small>${lider(cm, v, tot[3])}</span>${SETA}</a>`).join("");
  else corpo = `<label class="campo"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>
      <input id="fLoc" type="search" placeholder="Buscar escola, bairro ou endereço" autocomplete="off"></label><div id="lLoc">` +
    d.l.map(([z, lv, tot]) => {
      const [nmL, en, , bairro] = loc[`${cd}-${z}-${lv}`] || ["Local " + lv, ""];
      return `<a class="linha" data-nm="${esc(norm(nmL + " " + en + " " + (bairro || "")))}" href="${rot}/z/${z}/l/${lv}"><span class="meio"><b>${esc(titulo(nmL))}</b>
        <small>${esc(titulo(en))}${bairro ? " · " + esc(titulo(bairro)) : ""}</small><small>Zona ${z} · ${n(tot[7])} seções · ${tot[0] ? n(tot[0]) + " eleitores" : n(tot[1]) + " votos"}</small></span>${SETA}</a>`;
    }).join("") + `</div>`;
  app.innerHTML = `${migalha([["RJ", `#/t${estado.t}/c${estado.c}`], [nm]])}
    <section class="card">${cab(1, esc(nm), `${n(d.tot[7])} seções`)}${stats(d.tot)}</section>
    <section class="card">${abas("mun", [["cand", "Votação"], ["zona", `Zonas (${d.z.length})`], ["local", `Locais (${d.l.length})`]])}${corpo}</section>`;
  filtroLista("#fLoc", "#lLoc .linha");
}

async function telaZona(cd, z) {
  const nm = titulo(nomeMun(cd));
  hero(`ZONA <em>${z}</em>`, `${nm} · ${subCargo()}`, true);
  const [dm, dz, cm, loc] = await Promise.all([munArq(cd), zonaArq(cd, z), candMap(), locaisArq()]);
  const zz = dm.z.find(x => x[0] === +z);
  if (!zz) throw new Error("Zona não encontrada");
  const [, tot, v] = zz;
  const aba = abaAtual("zona", "cand");
  const rot = `#/t${estado.t}/c${estado.c}/m/${cd}/z/${z}`;
  const corpo = aba === "cand" ? ranking(cm, v, tot[3], `z${cd}-${z}`, { selo: true })
    : dz.l.map(([lv, t, vv]) => {
      const [nmL, en] = loc[`${cd}-${z}-${lv}`] || ["Local " + lv, ""];
      return `<a class="linha" href="${rot}/l/${lv}"><span class="meio"><b>${esc(titulo(nmL))}</b><small>${esc(titulo(en))} · ${n(t[7])} seções</small>${lider(cm, vv, t[3])}</span>${SETA}</a>`;
    }).join("");
  app.innerHTML = `${migalha([["RJ", `#/t${estado.t}/c${estado.c}`], [nm, `#/t${estado.t}/c${estado.c}/m/${cd}`], ["Zona " + z]])}
    <section class="card">${cab(1, "Zona " + z, `${n(tot[7])} seções`)}${stats(tot)}</section>
    <section class="card">${abas("zona", [["cand", "Votação"], ["local", `Locais (${dz.l.length})`]])}${corpo}</section>`;
}

async function telaLocal(cd, z, lv) {
  const nm = titulo(nomeMun(cd));
  const [dz, cm, loc] = await Promise.all([zonaArq(cd, z), candMap(), locaisArq()]);
  const l = dz.l.find(x => x[0] === +lv);
  if (!l) throw new Error("Local não encontrado");
  const [, tot, v] = l;
  const [nmL, en, , bairro, ll] = loc[`${cd}-${z}-${lv}`] || ["Local " + lv, ""];
  hero(esc(titulo(nmL)).toUpperCase(), `${nm} · Zona ${z} · ${subCargo()}`, true);
  const secs = dz.s.filter(s => s[1] === +lv);
  const aba = abaAtual("local", "cand");
  const rot = `#/t${estado.t}/c${estado.c}/m/${cd}/z/${z}`;
  const mapa = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ll ? ll.join(",") : `${nmL}, ${en}, ${nm} - RJ`);
  const corpo = aba === "cand" ? ranking(cm, v, tot[3], `l${cd}-${z}-${lv}`, { selo: true })
    : secs.map(([s, , t, vv]) => `<a class="linha" href="${rot}/s/${s}"><span class="tag am">${s}</span><span class="meio"><b>Seção ${s}</b>
      <small>${t[0] ? `${n(t[1])} de ${n(t[0])} votaram (${pct(t[1], t[0])})` : n(t[1]) + " votos"}</small>${lider(cm, vv, t[3])}</span>${SETA}</a>`).join("");
  app.innerHTML = `${migalha([["RJ", `#/t${estado.t}/c${estado.c}`], [nm, `#/t${estado.t}/c${estado.c}/m/${cd}`], ["Zona " + z, rot], [titulo(nmL)]])}
    <section class="card">${cab(1, "Local de votação", `${secs.length} seções`)}
      <p style="margin:-6px 0 12px;font-size:13.5px;color:var(--cinza)">${esc(titulo(en))}${bairro ? " · " + esc(titulo(bairro)) : ""}<br><a class="mapa" href="${mapa}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/></svg>Abrir no mapa</a></p>${stats(tot)}</section>
    <section class="card">${abas("local", [["cand", "Votação"], ["secao", `Seções (${secs.length})`]])}${corpo}</section>`;
}

async function telaSecao(cd, z, s) {
  const nm = titulo(nomeMun(cd));
  const [dz, cm, loc] = await Promise.all([zonaArq(cd, z), candMap(), locaisArq()]);
  const sec = dz.s.find(x => x[0] === +s);
  if (!sec) throw new Error("Seção não encontrada");
  const [, lv, t, v] = sec;
  const [nmL] = loc[`${cd}-${z}-${lv}`] || ["Local " + lv];
  hero(`SEÇÃO <em>${s}</em>`, `${nm} · Zona ${z} · ${subCargo()}`, true);
  const rot = `#/t${estado.t}/c${estado.c}/m/${cd}/z/${z}`;
  const tot = [t[0], t[1], t[2], t[3], t[4], t[5], t[6], 1];
  estado.mostrar[`s${cd}-${z}-${s}`] = estado.mostrar[`s${cd}-${z}-${s}`] || 1000;
  app.innerHTML = `${migalha([["RJ", `#/t${estado.t}/c${estado.c}`], [nm, `#/t${estado.t}/c${estado.c}/m/${cd}`], ["Zona " + z, rot], [titulo(nmL), `${rot}/l/${lv}`], ["Seção " + s]])}
    <section class="card">${cab(1, "Seção " + s, esc(titulo(nmL)))}${stats(tot)}</section>
    <section class="card">${cab(2, "Votação na seção")}${ranking(cm, v, t[3], `s${cd}-${z}-${s}`, { selo: true })}</section>`;
}

async function telaCand(nr, cdFiltro) {
  const [d, cm, dc, zl, loc, vic] = await Promise.all([cargoArq(), candMap(), (zerado() ? Promise.resolve({ m: [], z: [], l: [] }) : candArq(nr).catch(() => ({ m: [], z: [], l: [] }))), zlArq(), locaisArq(), json("data/vices.json").catch(() => ({}))]);
  const vices = ((vic[estado.c] || {})[nr] || []).sort((a, b) => a[0] - b[0]);
  const ROT_VICE = { 2: "Vice", 4: "Vice", 9: "1º suplente", 10: "2º suplente" };
  const c = cm.get(+nr);
  if (!c) throw new Error("Candidato " + nr + " sem votos neste cargo");
  const cor = corPartido(c.np);
  hero(esc(c.nome), `${IDX.cargoNome[estado.c]} · ${c.partido} · ${nr}`, true);
  const rot = `#/t${estado.t}/c${estado.c}/cand/${nr}`;
  const filtra = arr => cdFiltro ? arr.filter(x => x[0] === +cdFiltro) : arr;
  const total = cdFiltro ? (dc.m.find(x => x[0] === +cdFiltro) || [0, 0])[1] : c.votos;
  const aba = abaAtual("cand", cdFiltro ? "zona" : "mun");
  const barra = v => `<span class="barra-v" style="--cor:${cor}"><i style="width:${(100 * v / (total || 1)).toFixed(1)}%"></i></span>`;
  let corpo = "";
  if (aba === "mun" && !cdFiltro) {
    corpo = `<label class="campo"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>
      <input id="fCm" type="search" placeholder="Buscar município" autocomplete="off"></label><div id="lCm">` +
      dc.m.map(([m, v, p]) => `<a class="linha" data-nm="${esc(norm(nomeMun(m)))}" href="${rot}/m/${m}"><span class="tag${p === 1 ? " am" : ""}">${p}º</span>
      <span class="meio"><b>${esc(titulo(nomeMun(m)))}</b><small>${pct(v, d.mun[m] ? d.mun[m][0][3] : 0)} dos válidos · ${pct(v, total)} do total dele(a)</small>${barra(v)}</span>
      <span class="dirv"><b>${n(v)}</b><small>votos</small></span></a>`).join("") + "</div>";
  } else if (aba === "zona" || (aba === "mun" && cdFiltro)) {
    corpo = filtra(dc.z).map(([m, z, v, p]) => `<a class="linha" href="#/t${estado.t}/c${estado.c}/m/${m}/z/${z}"><span class="tag${p === 1 ? " am" : ""}">${p}º</span>
      <span class="meio"><b>Zona ${z}${cdFiltro ? "" : " · " + esc(titulo(nomeMun(m)))}</b><small>${pct(v, zl.z[m + "-" + z])} dos válidos · ${pct(v, total)} do total</small>${barra(v)}</span>
      <span class="dirv"><b>${n(v)}</b><small>votos</small></span></a>`).join("") || `<div class="vazio">Sem votos.</div>`;
  } else {
    const ls = filtra(dc.l);
    const qtd = estado.mostrar["cl" + nr + cdFiltro] || 40;
    corpo = `<label class="campo"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>
      <input id="fCl" type="search" placeholder="Buscar escola, bairro ou endereço" autocomplete="off"></label><div id="lCl">` +
      ls.map(([m, z, lv, v, p], i) => {
        const [nmL, en] = loc[`${m}-${z}-${lv}`] || ["Local " + lv, ""];
        return `<a class="linha" ${i >= qtd ? "hidden data-x" : ""} data-nm="${esc(norm(nmL + " " + en + " " + nomeMun(m)))}" href="#/t${estado.t}/c${estado.c}/m/${m}/z/${z}/l/${lv}"><span class="tag${p === 1 ? " am" : ""}">${p}º</span>
        <span class="meio"><b>${esc(titulo(nmL))}</b><small>${cdFiltro ? "" : esc(titulo(nomeMun(m))) + " · "}Zona ${z} · ${pct(v, zl.l[`${m}-${z}-${lv}`])} dos válidos</small>${barra(v)}</span>
        <span class="dirv"><b>${n(v)}</b><small>votos</small></span></a>`;
      }).join("") + `</div>${ls.length > qtd ? `<button class="btn" id="maisCl">Ver todos os ${n(ls.length)} locais</button>` : ""}`;
  }
  const fav = ehFav(nr);
  const nMun = dc.m.length;
  const muni = cdFiltro ? titulo(nomeMun(cdFiltro)) : "";
  const posMun = cdFiltro ? (dc.m.find(x => x[0] === +cdFiltro) || [])[2] : 0;
  const valMun = cdFiltro && d.mun[cdFiltro] ? d.mun[cdFiltro][0][3] : 0;
  const nCandLugar = cdFiltro ? (await munArq(cdFiltro)).v.filter(x => x[0] > 0).length : d.cand.length;
  app.innerHTML = `${migalha([["RJ", `#/t${estado.t}/c${estado.c}`], [c.nome, cdFiltro ? rot : ""], ...(cdFiltro ? [[muni]] : [])])}
    <section class="card" style="--cor:${cor}">
      <div class="ficha">${foto(c, "foto g")}
        <div class="dados"><span class="faixa" style="background:${CORES_CARGO[estado.c]}">${esc(IDX.cargoNome[estado.c])}</span>
          <div class="nm">${esc(c.nome)}</div><div class="info"><span class="part">${esc(c.partido)}</span>${selo(c.sit)}</div>
          <div class="nrbox" style="margin-top:10px"><span class="nr">${nr}</span></div></div></div>
      ${vices.length ? `<div class="vices">${vices.map(([cg, nmv, sg]) => `<span><em>${ROT_VICE[cg] || "Vice"}</em>${esc(titulo(nmv))} <small>${esc(sg)}</small></span>`).join("")}</div>` : ""}
      <button class="favbtn${fav ? " on" : ""}" id="fav" style="margin-top:14px"><span class="ck"></span>${fav ? "Acompanhando" : "Acompanhar"}</button>
    </section>
    <section class="card">${cab(1, cdFiltro ? esc(muni) : "Rio de Janeiro", cdFiltro ? `<a href="#/t${estado.t}/c${estado.c}/m/${cdFiltro}" style="color:var(--azul);font-weight:700">resultado completo ›</a>` : "")}
      ${!total ? `<div class="stats"><div class="stat l2 espera"><span>Votos</span><b>Aguardando o TSE</b><small>votação em 4 de outubro</small></div></div>` : ""}
      <div class="stats"${!total ? " hidden" : ""}>
        <div class="stat dest l2"><span>Votos</span><b>${n(total)}</b><small>${cdFiltro ? pct(total, c.votos) + " do total no RJ" : "no estado"}</small></div>
        <div class="stat"><span>% válidos</span><b>${pct(total, cdFiltro ? valMun : d.tot[3])}</b><small>${cdFiltro ? "no município" : "no RJ"}</small></div>
        <div class="stat"><span>Posição</span><b>${!total ? "–" : (cdFiltro ? posMun : c.pos) + "º"}</b><small>de ${n(nCandLugar)} candidatos</small></div>
        <div class="stat"><span>${cdFiltro ? "Zonas" : "Municípios"}</span><b>${cdFiltro ? filtra(dc.z).length : nMun}</b><small>com voto</small></div>
        <div class="stat"><span>Locais</span><b>${n(filtra(dc.l).length)}</b><small>com voto</small></div>
      </div></section>
    ${!c.votos ? `<section class="card"><div class="vazio">Os votos por município, zona, local e seção aparecem aqui quando o TSE divulgar o resultado.</div></section>` : ""}
    <section class="card"${!c.votos ? " hidden" : ""}>${abas("cand", cdFiltro ? [["zona", "Zonas"], ["local", "Locais"]] : [["mun", "Municípios"], ["zona", "Zonas"], ["local", "Locais"]])}${corpo}</section>`;
  $("#fav").onclick = () => { alternaFav(nr); render(); };
  filtroLista("#fCm", "#lCm .linha");
  const fcl = $("#fCl");
  if (fcl) fcl.addEventListener("input", () => {
    const q = norm(fcl.value.trim());
    document.querySelectorAll("#lCl .linha").forEach(el => { el.hidden = q ? !el.dataset.nm.includes(q) : el.hasAttribute("data-x"); });
  });
  const mcl = $("#maisCl");
  if (mcl) mcl.onclick = () => { document.querySelectorAll("#lCl .linha[data-x]").forEach(el => { el.hidden = false; el.removeAttribute("data-x"); }); mcl.remove(); };
}

/* ---------------- busca global ---------------- */
async function abrirBusca() {
  $("#busca").hidden = false;
  document.body.style.overflow = "hidden";
  const q = $("#q");
  q.value = "";
  q.focus();
  $("#resBusca").innerHTML = `<div class="vazio">Digite o nome de urna, o número ou um município.</div>`;
  const cargos = IDX.turnos[estado.t].map(x => x.cd);
  await Promise.all(cargos.map(c => candMap(estado.t, c)));
}
function fecharBusca() { $("#busca").hidden = true; document.body.style.overflow = ""; }
async function buscar() {
  const raw = $("#q").value.trim();
  const q = norm(raw);
  const out = $("#resBusca");
  if (q.length < 2) { out.innerHTML = `<div class="vazio">Digite pelo menos 2 letras ou números.</div>`; return; }
  const muns = IDX.mun.filter(m => norm(m[1]).includes(q)).slice(0, 8);
  let h = "";
  if (muns.length) h += `<h3 class="rotulo">Municípios</h3><div class="card" style="padding:4px 14px">${muns.map(([cd, nm]) => `<a class="linha" href="#/t${estado.t}/c${estado.c}/m/${cd}"><span class="meio"><b>${esc(titulo(nm))}</b></span>${SETA}</a>`).join("")}</div>`;
  for (const cg of IDX.turnos[estado.t]) {
    const cm = await candMap(estado.t, cg.cd);
    const achados = [];
    for (const c of cm.values()) {
      if (String(c.nr) === q || (q.length >= 3 && norm(c.nome).includes(q)) || (/^\d+$/.test(q) && String(c.nr).startsWith(q))) achados.push(c);
      if (achados.length >= 12) break;
    }
    if (!achados.length) continue;
    h += `<h3 class="rotulo">${esc(cg.nome)}</h3><div class="lista" style="margin-bottom:14px">${achados.map(c => `
      <a class="cand" href="#/t${estado.t}/c${cg.cd}/cand/${c.nr}" style="--cor:${corPartido(c.np)}"><span class="pos">${c.votos ? c.pos + "º" : ""}</span>${foto(c)}
      <span class="meio"><span class="nome">${esc(c.nome)}</span><span class="info"><span class="part">${esc(c.partido)}</span>${c.nr}${selo(c.sit)}</span></span>
      ${c.votos ? `<span class="votos"><span>${n(c.votos)}</span><small>votos</small></span>` : ""}</a>`).join("")}</div>`;
  }
  out.innerHTML = h || `<div class="vazio">Nada encontrado para “${esc(raw)}”.</div>`;
}

/* ---------------- roteamento ---------------- */
function rota() {
  const p = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const r = { t: estado.t, c: estado.c };
  let i = 0;
  if (/^t\d$/.test(p[i])) r.t = +p[i++].slice(1);
  if (/^c\d$/.test(p[i])) r.c = +p[i++].slice(1);
  for (; i < p.length; i += 2) r[p[i]] = p[i + 1];
  return r;
}
let renderId = 0, ultimaChave = "";
async function render() {
  const r = rota();
  const turnos = IDX.turnos;
  if (!turnos[r.t]) r.t = +Object.keys(turnos)[0];
  if (!turnos[r.t].some(x => x.cd === r.c)) r.c = turnos[r.t][0].cd;
  estado.t = r.t; estado.c = r.c;
  try { localStorage.setItem("ult", JSON.stringify({ t: r.t, c: r.c })); } catch {}
  desenhaBarra(r);
  const chave = location.hash.replace(/\/c\d/, "");
  if (chave !== ultimaChave) { estado.mostrar = {}; ultimaChave = chave; }
  const id = ++renderId;
  const rolagem = window.scrollY;
  const mesmaTela = app.dataset.h === location.hash;
  if (!mesmaTela) app.innerHTML = `<div class="carregando"><span></span></div>`;
  try {
    if (r.cand) await telaCand(r.cand, r.m);
    else if (r.m && r.z && r.l) await telaLocal(r.m, r.z, r.l);
    else if (r.m && r.z && r.s) await telaSecao(r.m, r.z, r.s);
    else if (r.m && r.z) await telaZona(r.m, r.z);
    else if (r.m) await telaMun(r.m);
    else await telaEstado();
    if (id !== renderId) return;
    app.dataset.h = location.hash;
    if (mesmaTela) window.scrollTo(0, rolagem);
  } catch (e) {
    if (id !== renderId) return;
    app.innerHTML = `<div class="erro"><b>Não deu para abrir.</b><br>${esc(e.message)}<br><a href="#/t${estado.t}/c${estado.c}" style="font-weight:700;text-decoration:underline">Voltar ao início</a></div>`;
  }
}
function desenhaBarra(r) {
  const cargos = IDX.turnos[r.t];
  const resto = location.hash.replace(/^#\/?(t\d\/)?(c\d\/?)?/, "");
  const manter = resto.startsWith("cand") ? "" : resto;
  $("#cargos").innerHTML = cargos.map(c => `<a class="chip${c.cd === r.c ? " on" : ""}" role="tab" href="#/t${r.t}/c${c.cd}${manter ? "/" + manter : ""}">${CURTO[c.cd] || c.nome}</a>`).join("");
  const ts = Object.keys(IDX.turnos);
  $("#turnos").hidden = ts.length < 2;
  $("#turnos").innerHTML = ts.map(t => `<a class="chip${+t === r.t ? " on" : ""}" href="#/t${t}">${t}º turno</a>`).join("");
  const on = $("#cargos .on");
  if (on) { const box = $("#cargos"); box.scrollLeft = on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2; }
}

/* ---------------- eventos ---------------- */
document.addEventListener("error", e => { if (e.target.tagName === "IMG") e.target.remove(); }, true);
document.addEventListener("click", e => {
  const a = e.target.closest("[data-aba]");
  if (a) { estado.aba[a.dataset.aba] = a.dataset.k; render(); return; }
  const m = e.target.closest("[data-mais]");
  if (m) { estado.mostrar[m.dataset.mais] = (estado.mostrar[m.dataset.mais] || PASSO) + 60; render(); return; }
  const vp = e.target.closest("[data-verpor]");
  if (vp) { estado.verPor = vp.dataset.verpor; if (vp.dataset.verpor !== "cand") estado.grupo = ""; render(); return; }
  const gr = e.target.closest("[data-grupo]");
  if (gr) { estado.grupo = gr.dataset.grupo; estado.verPor = "cand"; render(); return; }
  if (e.target.closest("[data-limpa]")) { estado.grupo = ""; render(); return; }
  const o = e.target.closest("[data-ord]");
  if (o) { estado.ordMun = o.dataset.ord; render(); return; }
  if (e.target.closest("#resBusca a")) fecharBusca();
});
$("#voltar").addEventListener("click", e => {
  e.preventDefault();
  const p = location.hash.split("/");
  if (history.length > 1 && sessionStorage.getItem("nav")) history.back();
  else location.hash = p.slice(0, Math.max(3, p.length - 2)).join("/");
});
$("#btnBusca").addEventListener("click", abrirBusca);
$("#fecharBusca").addEventListener("click", fecharBusca);
$("#busca").addEventListener("click", e => { if (e.target.id === "busca") fecharBusca(); });
let tb;
$("#q").addEventListener("input", () => { clearTimeout(tb); tb = setTimeout(buscar, 160); });
window.addEventListener("hashchange", () => {
  try { sessionStorage.setItem("nav", "1"); } catch {}
  const mudouTela = app.dataset.h !== location.hash;
  render().then(() => { if (mudouTela) window.scrollTo(0, 0); });
});
document.addEventListener("keydown", e => { if (e.key === "Escape") fecharBusca(); });

/* ---------------- início ---------------- */
(async function inicio() {
  try {
    IDX = await fetch("data/index.json", { cache: "no-cache" }).then(r => r.json());
    VER = (IDX.gerado || "").replace(/\D/g, "");
    IDX.munNome = new Map(IDX.mun.map(m => [m[0], m[1]]));
    IDX.cargoNome = {};
    Object.values(IDX.turnos).forEach(l => l.forEach(c => { IDX.cargoNome[c.cd] = c.nome; }));
    $("#pill").textContent = `ELEIÇÕES ${IDX.ano} · RJ`;
    $("#gerado").textContent = "dados processados em " + IDX.gerado;
    if (!location.hash) {
      try { const u = JSON.parse(localStorage.getItem("ult") || "null"); if (u) { estado.t = u.t; estado.c = u.c; } } catch {}
    }
    await render();
  } catch (e) {
    app.innerHTML = `<div class="erro"><b>Os resultados ainda não foram carregados.</b><br>${esc(e.message)}</div>`;
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
