#!/usr/bin/env python3
"""Converte os arquivos do Portal de Dados Abertos do TSE nos JSON do app "Resultado RJ".

Entradas (CSV ou ZIP, como vêm do TSE; pode passar mais de um de cada):
  --votacao   votacao_secao_<ano>_RJ  (e o _BR, para Presidente — é filtrado para o RJ)
  --detalhe   detalhe_votacao_secao_<ano>  (aptos, comparecimento, abstenção, brancos, nulos, legenda) — opcional
  --cand      consulta_cand_<ano>  (nome de urna, partido, situação: eleito/suplente…) — opcional
  --fotos     foto_cand<ano>_RJ_div.zip (e _BR_div para Presidente) — opcional
Saída: <saida>/data/... e <saida>/img/f/<SQ>.webp

Uso:
  python3 processar.py --ano 2026 --votacao votacao_secao_2026_RJ.zip votacao_secao_2026_BR.zip \
      --detalhe detalhe_votacao_secao_2026.zip --cand consulta_cand_2026.zip \
      --fotos foto_cand2026_RJ_div.zip foto_cand2026_BR_div.zip --saida ../site
"""
import argparse, io, json, os, re, shutil, sys, tempfile, time, zipfile
from collections import defaultdict
from datetime import datetime, timezone, timedelta

import duckdb

UF = "RJ"
BRT = timezone(timedelta(hours=-3))
NOMES_CARGO = {1: "Presidente", 3: "Governador", 5: "Senador", 6: "Deputado Federal", 7: "Deputado Estadual"}
ORDEM_CARGO = [7, 6, 5, 3, 1]
VAGAS = {(2026, 5): 2, (2018, 5): 2, (2010, 5): 2}  # Senado: 2 vagas a cada 8 anos

CORES = {  # número do partido -> cor (para barras e destaques)
    10: "#1b5fae", 11: "#2a7bd1", 12: "#d1202f", 13: "#c4122d", 14: "#1f9c4a", 15: "#1b9e4b",
    16: "#c8102e", 17: "#2c3e8f", 18: "#2aa198", 19: "#1d6fb8", 20: "#0f7a3a", 21: "#b8000b",
    22: "#123f8c", 23: "#e0007a", 25: "#1f4e9c", 27: "#1c8f6a", 28: "#0b7a3e", 29: "#a3000f",
    30: "#f26b1d", 33: "#163f8e", 35: "#d63384", 36: "#5b2a86", 40: "#e8a10f", 43: "#2e9e3a",
    44: "#1452a5", 45: "#1a62b3", 50: "#f2a900", 51: "#1a8f3c", 55: "#f0a500", 65: "#b1001c",
    70: "#0b9a6d", 77: "#f37021", 80: "#c4122d", 90: "#163b7a",
}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


def csvs(caminhos, padrao, tmp):
    """Devolve a lista de CSVs (extraindo dos ZIP os que casam com o padrão)."""
    saida = []
    for c in caminhos:
        if c.lower().endswith(".zip"):
            with zipfile.ZipFile(c) as z:
                for n in z.namelist():
                    if n.lower().endswith(".csv") and re.search(padrao, n, re.I):
                        destino = os.path.join(tmp, os.path.basename(n))
                        if not os.path.exists(destino):
                            log("extraindo", n)
                            with z.open(n) as f, open(destino, "wb") as g:
                                shutil.copyfileobj(f, g, 1 << 22)
                        saida.append(destino)
        else:
            saida.append(c)
    return saida


def leitura(arqs):
    lista = ",".join("'%s'" % a.replace("'", "''") for a in arqs)
    return (f"read_csv([{lista}], delim=';', header=true, encoding='latin-1', all_varchar=true, "
            f"union_by_name=true, quote='\"')")


def dump(caminho, obj):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def lider_fed(v):
    """cor da federação = cor do 1º partido da composição"""
    primeiro = (v[3][0] if len(v) > 3 and v[3] else "").upper().replace(" ", "")
    for np in v[2]:
        if primeiro and primeiro.startswith(str(np)):
            return np
    return v[2][0] if v[2] else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", type=int, required=True)
    ap.add_argument("--votacao", nargs="*", default=[])
    ap.add_argument("--secoes", nargs="*", default=[], help="eleitorado_local_votacao_<ano> (seções, eleitores, bairro, lat/long)")
    ap.add_argument("--detalhe", nargs="*", default=[])
    ap.add_argument("--cand", nargs="*", default=[])
    ap.add_argument("--fotos", nargs="*", default=[])
    ap.add_argument("--saida", required=True)
    ap.add_argument("--tmp", default=None)
    ap.add_argument("--sem-fotos", action="store_true")
    a = ap.parse_args()

    tmp = a.tmp or tempfile.mkdtemp(prefix="tse_")
    os.makedirs(tmp, exist_ok=True)
    data = os.path.join(a.saida, "data")
    if os.path.isdir(data):
        shutil.rmtree(data)
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order=false")

    # ---------------- seções (cadastro do TSE, antes da eleição) ----------------
    sec = csvs(a.secoes, r"eleitorado_local_votacao_.*_RJ\.csv$", tmp) if a.secoes else []
    if sec:
        log("lendo seções", sec)
        con.execute(f"""create table sc0 as select CD_MUNICIPIO::int mun, NM_MUNICIPIO nm_mun, NR_ZONA::int zona,
            NR_SECAO::int secao, NR_SECAO_PRINCIPAL::int principal, DS_TIPO_SECAO_AGREGADA tipo,
            NR_LOCAL_VOTACAO::int lv, NM_LOCAL_VOTACAO nm_local, DS_ENDERECO ender, NM_BAIRRO bairro,
            replace(NR_LATITUDE, ',', '.') lat, replace(NR_LONGITUDE, ',', '.') lon,
            QT_ELEITOR_ELEICAO_ESTADUAL::int eleit
            from {leitura(sec)} where SG_UF='{UF}' and NR_TURNO='1'""")
        # seção agregada soma na principal (é uma urna só)
        con.execute("""create table sc as select p.mun, p.nm_mun, p.zona, p.secao, p.lv, p.nm_local, p.ender, p.bairro,
            p.lat, p.lon, p.eleit + coalesce((select sum(a.eleit) from sc0 a where a.mun=p.mun and a.zona=p.zona
              and a.principal=p.secao and a.tipo<>'Principal'), 0) eleit
            from sc0 p where p.tipo='Principal'""")
        log("seções principais:", con.execute("select count(*), sum(eleit) from sc").fetchone())

    # ---------------- votação por seção ----------------
    arqs = csvs(a.votacao, r"votacao_secao_.*_(RJ|BR)\.csv$", tmp) if a.votacao else []
    if not arqs:
        log("SEM VOTAÇÃO: gerando o MODELO (candidatos e seções, votos zerados)")
        if not sec:
            sys.exit("sem votação é preciso --secoes eleitorado_local_votacao_<ano>")
        con.execute("""create table vs (turno int, cargo int, mun int, nm_mun varchar, zona int, secao int, lv int,
            nm_local varchar, ender varchar, nr int, nm varchar, sq varchar, votos int)""")
    else:
      log("lendo votação", arqs)
      con.execute(f"""create table vs as select NR_TURNO::int turno, CD_CARGO::int cargo, CD_MUNICIPIO::int mun,
        NM_MUNICIPIO nm_mun, NR_ZONA::int zona, NR_SECAO::int secao, NR_LOCAL_VOTACAO::int lv,
        NM_LOCAL_VOTACAO nm_local, DS_LOCAL_VOTACAO_ENDERECO ender,
        NR_VOTAVEL::int nr, NM_VOTAVEL nm, SQ_CANDIDATO sq, QT_VOTOS::int votos
        from {leitura(arqs)} where SG_UF='{UF}'""")
    log("linhas:", con.execute("select count(*) from vs").fetchone()[0])

    # tipo: c = candidato, l = legenda, b = branco, n = nulo
    con.execute("""create table v as select turno, cargo, mun, zona, secao, any_value(lv) lv,
        case when nr=95 then 'b' when nr in (96,97) then 'n' when sq='-3' then 'l' else 'c' end tp,
        nr, sum(votos)::int votos from vs group by all""")

    # ---------------- totais por seção ----------------
    det = csvs(a.detalhe, r"detalhe_votacao_secao_.*_(RJ|BR)\.csv$", tmp) if a.detalhe else []
    modelo = not arqs
    if modelo:
        con.execute("create table st (turno int, cargo int, mun int, zona int, secao int, lv int, aptos int, comp int,"
                    " abst int, validos int, br int, nul int, leg int)")
    elif det:
        log("lendo detalhe", det)
        con.execute(f"""create table st as select NR_TURNO::int turno, CD_CARGO::int cargo, CD_MUNICIPIO::int mun,
            NR_ZONA::int zona, NR_SECAO::int secao, NR_LOCAL_VOTACAO::int lv,
            QT_APTOS::int aptos, QT_COMPARECIMENTO::int comp, QT_ABSTENCOES::int abst,
            (QT_VOTOS_NOMINAIS::int + QT_VOTOS_LEGENDA::int) validos, QT_VOTOS_BRANCOS::int br,
            QT_VOTOS_NULOS::int nul, QT_VOTOS_LEGENDA::int leg
            from {leitura(det)} where SG_UF='{UF}'""")
        # seções presentes na votação mas sem detalhe (não deve acontecer) ficam com aptos 0
    else:
        log("sem detalhe: aptos/comparecimento calculados a partir dos votos")
        con.execute("""create table st as select turno, cargo, mun, zona, secao, any_value(lv) lv,
            0 aptos, 0 comp, 0 abst,
            sum(votos) filter (where tp in ('c','l'))::int validos, coalesce(sum(votos) filter (where tp='b'),0)::int br,
            coalesce(sum(votos) filter (where tp='n'),0)::int nul, coalesce(sum(votos) filter (where tp='l'),0)::int leg
            from v group by all""")
        con.execute("""update st set comp = validos+br+nul""")
        if sec:
            con.execute("""update st set aptos = sc.eleit, abst = greatest(sc.eleit - st.comp, 0) from sc
                where sc.mun=st.mun and sc.zona=st.zona and sc.secao=st.secao""")

    # ---------------- candidatos ----------------
    info = {}  # (cargo, nr) -> dict
    vices = {}  # cargo -> nr -> [[cargo_vice, nome, partido]]
    partidos = {}  # nr -> sigla
    fed_de = {}  # nr partido -> nr federação
    feds = {}  # nr federação -> [nome, siglas, [partidos]]
    if a.cand:
        cc = csvs(a.cand, r"consulta_cand_.*_(RJ|BR)\.csv$", tmp)
        log("lendo candidatos", cc)
        rows = con.execute(f"""select CD_CARGO::int, NR_CANDIDATO::int, SQ_CANDIDATO, NM_URNA_CANDIDATO, SG_PARTIDO,
            NR_PARTIDO::int, DS_SIT_TOT_TURNO, NR_TURNO::int, DS_SITUACAO_CANDIDATURA, SG_UF
            from {leitura(cc)} where SG_UF in ('{UF}','BR')""").fetchall()
        for np, nf, nm, comp in con.execute(f"""select distinct NR_PARTIDO::int, NR_FEDERACAO::int, NM_FEDERACAO,
                DS_COMPOSICAO_FEDERACAO from {leitura(cc)} where NR_FEDERACAO not in ('-1','')""").fetchall():
            fed_de[np] = nf
            nome = re.sub(r"^FEDERA[ÇC][ÃA]O\s+", "", nm, flags=re.I)
            nome = re.sub(r"\s+-\s+FE\s+\S+$", "", nome)
            siglas = {(x.split("-", 1)[1] if re.match(r"^\d+-", x.strip()) else x).strip().upper() for x in comp.split("/")}
            nome = " ".join(w.upper() if (w.upper() in siglas and len(w) <= 4 and w.upper() != "REDE") else (w.lower() if w.upper() in ("DA", "DE", "DO", "E") else w.capitalize())
                            for w in nome.split())
            membros = [(x.split("-", 1)[1] if re.match(r"^\d+-", x.strip()) else x).strip() for x in comp.split("/")]
            ant = feds.get(nf, [None, None, []])
            feds[nf] = [nome, "/".join(m.replace("PC do B", "PCdoB").replace("SOLIDARIEDADE", "SD") for m in membros),
                        ant[2] + [np], membros]
        VICE = {2: 1, 4: 3, 9: 5, 10: 5}
        for cg, nr, sq, nmu, sg, np, sit, tur, sitc, uf in rows:
            if cg in VICE:
                vices.setdefault(VICE[cg], {}).setdefault(nr, []).append([cg, nmu, sg])
                continue
            if cg not in NOMES_CARGO or (cg == 1 and uf != "BR"):
                continue
            partidos[np] = sg
            k = (cg, nr)
            atual = info.get(k)
            if atual and atual["turno"] > tur:
                continue
            info[k] = {"sq": sq, "nome": nmu, "partido": sg, "np": np,
                       "sit": "" if sit in ("#NULO", "#NE", "") else sit, "turno": tur, "apto": sitc}

    # nomes vindos do próprio arquivo de votação (quando não há consulta_cand)
    for cg, nr, nm, sq in con.execute(
            "select cargo, nr, any_value(nm), any_value(sq) from vs where nr not in (95,96,97) group by all").fetchall():
        if sq == "-3":
            partidos.setdefault(nr, nm)
            continue
        if (cg, nr) not in info:
            np = int(str(nr)[:2])
            info[(cg, nr)] = {"sq": sq, "nome": nm, "partido": partidos.get(np, str(np)), "np": np, "sit": "",
                              "turno": 1, "apto": ""}

    if modelo:
        cargos_m = sorted({cg for cg, _ in info})
        for cg in cargos_m:
            con.execute(f"""insert into st select 1, {cg}, mun, zona, secao, lv, eleit, 0, 0, 0, 0, 0, 0 from sc""")
        con.execute("""insert into vs select 1, null, mun, nm_mun, zona, secao, lv, nm_local, ender, null, null, null, 0
            from sc""")

    # ---------------- fotos ----------------
    com_foto = set()
    os.makedirs(os.path.join(a.saida, "img", "f"), exist_ok=True)
    sqs_usados = {d["sq"] for d in info.values()}
    if a.fotos and not a.sem_fotos:
        from PIL import Image
        for zf in a.fotos:
            if os.path.isdir(zf):  # pasta com <SQ>.webp já reduzidas
                for fn in os.listdir(zf):
                    sq = fn.split(".")[0]
                    if fn.endswith(".webp") and sq in sqs_usados:
                        shutil.copy(os.path.join(zf, fn), os.path.join(a.saida, "img", "f", fn))
                        com_foto.add(sq)
                continue
            with zipfile.ZipFile(zf) as z:
                for n in z.namelist():
                    m = re.search(r"F[A-Z]{2}(\d+)_div\.(jpe?g|png)$", n, re.I)
                    if not m or m.group(1) not in sqs_usados:
                        continue
                    sq = m.group(1)
                    destino = os.path.join(a.saida, "img", "f", sq + ".webp")
                    if not os.path.exists(destino):
                        try:
                            im = Image.open(io.BytesIO(z.read(n))).convert("RGB")
                            w, h = im.size  # 3x4 -> 180x240
                            alvo = 3 / 4
                            if w / h > alvo:
                                nw = int(h * alvo); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
                            else:
                                nh = int(w / alvo); im = im.crop((0, 0, w, nh))
                            im = im.resize((180, 240), Image.LANCZOS)
                            im.save(destino, "WEBP", quality=72, method=6)
                        except Exception as ex:
                            log("foto com erro", n, ex); continue
                    com_foto.add(sq)
        log("fotos:", len(com_foto))
    else:
        for f in os.listdir(os.path.join(a.saida, "img", "f")):
            com_foto.add(f.split(".")[0])

    # ---------------- locais (nomes) ----------------
    locais = {}
    for mun, zona, lv, nm, en, ns in con.execute("""select mun, zona, lv, any_value(nm_local), any_value(ender),
            count(distinct secao) from vs group by mun, zona, lv""").fetchall():
        locais[f"{mun}-{zona}-{lv}"] = [nm, en, ns]
    if sec:
        for mun, zona, lv, nm, en, ba, la, lo, ns in con.execute("""select mun, zona, lv, any_value(nm_local),
                any_value(ender), any_value(bairro), any_value(lat), any_value(lon), count(*) from sc
                group by all""").fetchall():
            k = f"{mun}-{zona}-{lv}"
            d = locais.get(k, [nm, en, ns])
            try:
                ll = [round(float(la), 6), round(float(lo), 6)] if la and float(la) != -1 else None
            except ValueError:
                ll = None
            locais[k] = [d[0], d[1], d[2], "" if ba in (None, "#NULO") else ba, ll]
    dump(os.path.join(data, "locais.json"), locais)
    municipios = con.execute("select mun, any_value(nm_mun) from vs group by mun order by 2").fetchall()

    turnos = [r[0] for r in con.execute("select distinct turno from st order by 1").fetchall()]
    idx = {"ano": a.ano, "uf": UF, "gerado": datetime.now(BRT).strftime("%d/%m/%Y %H:%M"),
           "turnos": {}, "partidos": {str(k): [v, CORES.get(k, "#5b6475"), fed_de.get(k, 0)] for k, v in partidos.items()},
           "fed": {str(k): [v[0], v[1], CORES.get(next((np for np in v[2] if partidos.get(np, "").upper().replace(" ", "") == v[3][0].upper().replace(" ", "")), v[2][0]), "#5b6475"), v[2]] for k, v in feds.items()},
           "mun": [], "fotos": len(com_foto), "modelo": modelo}
    dump(os.path.join(data, "vices.json"), {str(c): {str(nr): v for nr, v in d.items()} for c, d in vices.items()})
    aptos_mun = dict(con.execute("""select mun, sum(aptos) from st where turno=(select min(turno) from st)
        and cargo=(select min(cargo) from st where turno=(select min(turno) from st)) group by mun""").fetchall())
    idx["mun"] = [[m, n, int(aptos_mun.get(m) or 0)] for m, n in municipios]

    TOT = "sum(aptos)::int, sum(comp)::int, sum(abst)::int, sum(validos)::int, sum(br)::int, sum(nul)::int, sum(leg)::int, count(*)::int"

    for t in turnos:
        cargos_t = [c for c in ORDEM_CARGO if con.execute(
            "select 1 from st where turno=? and cargo=? limit 1", [t, c]).fetchone()]
        idx["turnos"][str(t)] = []
        for c in cargos_t:
            t0 = time.time()
            base = os.path.join(data, f"t{t}", f"c{c}")
            # candidatos do cargo
            cand_rows = con.execute("""select nr, sum(votos)::int from v where turno=? and cargo=? and tp='c'
                group by nr order by 2 desc""", [t, c]).fetchall()
            leg_rows = con.execute("""select nr, sum(votos)::int from v where turno=? and cargo=? and tp='l'
                group by nr order by 2 desc""", [t, c]).fetchall()
            est = con.execute(f"select {TOT} from st where turno=? and cargo=?", [t, c]).fetchone()
            cands = []
            ja = {nr for nr, _ in cand_rows}
            if t == 1:
                zeros = sorted(((nr, 0) for (cg, nr) in info if cg == c and nr not in ja),
                               key=lambda x: info[(c, x[0])]["nome"])
                cand_rows = list(cand_rows) + zeros
            for nr, vt in cand_rows:
                d = info.get((c, nr), {"sq": "", "nome": str(nr), "partido": "", "np": int(str(nr)[:2]), "sit": ""})
                cands.append([nr, d["nome"], d["partido"], d["sq"] if d["sq"] in com_foto else "", d["sit"], vt,
                              d.get("np", 0)])
            # totais e top por município
            tot_mun = {r[0]: list(r[1:]) for r in con.execute(
                f"select mun, {TOT} from st where turno=? and cargo=? group by mun", [t, c]).fetchall()}
            vm = defaultdict(list)
            for mun, nr, vt in con.execute("""select mun, nr, sum(votos)::int s from v where turno=? and cargo=?
                    and tp='c' group by all order by mun, s desc""", [t, c]).fetchall():
                vm[mun].append([nr, vt])
            dump(base + ".json", {
                "cargo": c, "nome": NOMES_CARGO.get(c, str(c)), "turno": t, "tot": list(est),
                "cand": cands, "leg": [[nr, vt] for nr, vt in leg_rows],
                "mun": {m: [tot_mun.get(m), vm[m][:3]] for m in tot_mun},
            })
            idx["turnos"][str(t)].append({"cd": c, "nome": NOMES_CARGO.get(c, str(c)), "ncand": len(cands),
                                         "secoes": est[7], "vagas": VAGAS.get((a.ano, c), 1) if c in (1, 3, 5) else 0})

            # ---- município: totais, votos, zonas (com votos), locais (totais)
            tz = defaultdict(dict)
            for r in con.execute(f"select mun, zona, {TOT} from st where turno=? and cargo=? group by mun, zona",
                                 [t, c]).fetchall():
                tz[r[0]][r[1]] = list(r[2:])
            tl = defaultdict(lambda: defaultdict(dict))
            for r in con.execute(f"select mun, zona, lv, {TOT} from st where turno=? and cargo=? group by mun, zona, lv",
                                 [t, c]).fetchall():
                tl[r[0]][r[1]][r[2]] = list(r[3:])
            ts = defaultdict(lambda: defaultdict(list))
            for r in con.execute(f"""select mun, zona, secao, lv, aptos, comp, abst, validos, br, nul, leg
                    from st where turno=? and cargo=? order by mun, zona, secao""", [t, c]).fetchall():
                ts[r[0]][r[1]].append([r[2], r[3]] + list(r[4:]))
            vz = defaultdict(lambda: defaultdict(list))
            for mun, zona, tp, nr, vt in con.execute("""select mun, zona, tp, nr, sum(votos)::int s from v
                    where turno=? and cargo=? and tp in ('c','l') group by all order by mun, zona, s desc""",
                                                     [t, c]).fetchall():
                vz[mun][zona].append([nr, vt] if tp == "c" else [-nr, vt])
            vmall = defaultdict(list)
            for mun, tp, nr, vt in con.execute("""select mun, tp, nr, sum(votos)::int s from v
                    where turno=? and cargo=? and tp in ('c','l') group by all order by mun, s desc""",
                                               [t, c]).fetchall():
                vmall[mun].append([nr, vt] if tp == "c" else [-nr, vt])
            for mun in tz:
                dump(os.path.join(base, f"m{mun}.json"), {
                    "tot": tot_mun[mun], "v": vmall[mun],
                    "z": [[z, tz[mun][z], vz[mun][z]] for z in sorted(tz[mun])],
                    "l": [[z, lv, tl[mun][z][lv]] for z in sorted(tl[mun]) for lv in sorted(tl[mun][z])],
                })
            # ---- zona: locais e seções com votos
            vl = defaultdict(list)
            vs_ = defaultdict(list)
            for mun, zona, lv, tp, nr, vt in con.execute("""select mun, zona, lv, tp, nr, sum(votos)::int s from v
                    where turno=? and cargo=? and tp in ('c','l') group by all order by mun, zona, lv, s desc""",
                                                         [t, c]).fetchall():
                vl[(mun, zona, lv)].append([nr, vt] if tp == "c" else [-nr, vt])
            for mun, zona, secao, tp, nr, vt in con.execute("""select mun, zona, secao, tp, nr, votos from v
                    where turno=? and cargo=? and tp in ('c','l') and votos>0 order by mun, zona, secao, votos desc""",
                                                            [t, c]).fetchall():
                vs_[(mun, zona, secao)].append([nr, vt] if tp == "c" else [-nr, vt])
            for mun in tl:
                for z in tl[mun]:
                    dump(os.path.join(base, f"m{mun}", f"z{z}.json"), {
                        "l": [[lv, tl[mun][z][lv], vl[(mun, z, lv)]] for lv in sorted(tl[mun][z])],
                        "s": [[s[0], s[1], s[2:], vs_[(mun, z, s[0])]] for s in ts[mun][z]],
                    })
            # ---- candidato: votos por município, zona e local (com posição no lugar)
            def ranking(chaves):
                pos = {}
                grupos = defaultdict(list)
                for k, nr, vt in chaves:
                    grupos[k].append((vt, nr))
                for k, lst in grupos.items():
                    lst.sort(reverse=True)
                    for i, (vt, nr) in enumerate(lst):
                        pos[(k, nr)] = i + 1
                return pos
            rows_m = [(m, x[0], x[1]) for m in vmall for x in vmall[m] if x[0] > 0]
            rows_z = [((m, z), x[0], x[1]) for m in vz for z in vz[m] for x in vz[m][z] if x[0] > 0]
            rows_l = [(k, x[0], x[1]) for k in vl for x in vl[k] if x[0] > 0]
            pm, pz, pl = ranking(rows_m), ranking(rows_z), ranking(rows_l)
            porcand = defaultdict(lambda: {"m": [], "z": [], "l": []})
            for m, nr, vt in rows_m:
                porcand[nr]["m"].append([m, vt, pm[(m, nr)]])
            for (m, z), nr, vt in rows_z:
                porcand[nr]["z"].append([m, z, vt, pz[((m, z), nr)]])
            for (m, z, lv), nr, vt in rows_l:
                porcand[nr]["l"].append([m, z, lv, vt, pl[((m, z, lv), nr)]])
            for nr, d in porcand.items():
                for k in d:
                    d[k].sort(key=lambda x: -x[-2])
                dump(os.path.join(base, "cand", f"{nr}.json"), d)
            # totais de zona/local para % do candidato (válidos no lugar) já estão nos arquivos acima;
            # o app usa os do município (tot_mun) e de c<cargo>/zl.json
            dump(os.path.join(base, "zl.json"), {
                "z": {f"{m}-{z}": tz[m][z][3] for m in tz for z in tz[m]},
                "l": {f"{m}-{z}-{lv}": tl[m][z][lv][3] for m in tl for z in tl[m] for lv in tl[m][z]},
            })
            log(f"turno {t} {NOMES_CARGO.get(c)}: {len(cands)} candidatos, {len(tz)} municípios, {time.time()-t0:.0f}s")

    dump(os.path.join(data, "index.json"), idx)
    total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(a.saida) for f in fs)
    n = sum(len(fs) for _, _, fs in os.walk(a.saida))
    log(f"pronto: {n} arquivos, {total/1e6:.0f} MB em {a.saida}")


if __name__ == "__main__":
    main()
