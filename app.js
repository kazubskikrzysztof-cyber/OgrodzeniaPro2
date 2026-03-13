'use strict';

/* ═══════════════════════════════════════════════
   STAŁE
   ═══════════════════════════════════════════════ */
const STORAGE_KEY = 'ogrPRO_stan';
const JEDNOSTKI = { M: 'm', MM: 'mm' };

const CENNIK_DOMYSLNY = {
  robocizna_zl_mb: { nazwa: 'Robocizna', wartosc: 30, jednostka: 'zł/mb' },
  transport_zl: { nazwa: 'Transport', wartosc: 300, jednostka: 'zł' },
  demontaz_zl_mb: { nazwa: 'Demontaż', wartosc: 15, jednostka: 'zł/mb' },
  obejma_zl: { nazwa: 'Obejma', wartosc: 5, jednostka: 'zł/szt', opis: '3 szt/słupek' },
  typyPaneli: [{ id: 'p_std', nazwa: 'Panel standard', szerokosc_mm: 2500, cena_zl: 150 }],
  typySlupkow: [{ id: 's_std', nazwa: 'Słupek standard', szerokosc_mm: 40, cena_zl: 80 }],
  typyBram: [{ id: 'b_std', nazwa: 'Brama standard', cena_zl: 1200 }],
  typyFurtek: [{ id: 'f_std', nazwa: 'Furtka standard', cena_zl: 450 }],
  pozycjeDodatkowe: [],
};

/* ═══════════════════════════════════════════════
   STAN
   ═══════════════════════════════════════════════ */
let stan = nowyStanDomyslny();
let idEdytowanego = null; // ID zestawu w trybie edycji inline

function nowyStanDomyslny() {
  return {
    klient: { nazwa: '', adres: '', telefon: '', data: dzisiaj(), geo: null },
    ustawienia: { jednostka: 'm' },
    zestawy: [],
    dodatki: {
      transport: { aktywny: false, kwota: null },
      demontaz: { aktywny: false, mb: 0 },
      robocizna: { aktywny: true },
      uwagi: '',
      dynamiczne: {},
      korekta: 0
    },
    cennik: deepCopy(CENNIK_DOMYSLNY),
  };
}

/* ═══════════════════════════════════════════════
   NARZĘDZIA
   ═══════════════════════════════════════════════ */
function dzisiaj() {
  return new Date().toISOString().slice(0, 10);
}

function zaokr(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatZl(n) {
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
}

function formatN(n, dec = 2) {
  return parseFloat(n.toFixed(dec)).toString().replace('.', ',');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function parseNum(val, fallback) {
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? fallback : n;
}

function getFloatValue(id, fallback = NaN) {
  const el = document.getElementById(id);
  if (!el || el.value === '') return fallback;
  return parseNum(el.value, fallback);
}

function czytajWstawke(prefix, suffix, jed, domyslnaSz, stalaStrona = null) {
  const typId = document.getElementById(`${prefix}-typ${suffix}`)?.value;
  if (!typId) return null;

  const sz = getFloatValue(`${prefix}-szer${suffix}`, domyslnaSz);
  const cn = getFloatValue(`${prefix}-cena${suffix}`, 0);
  const odlRaw = getFloatValue(`${prefix}-odl${suffix}`, null);

  const strona = stalaStrona !== null
    ? stalaStrona
    : (document.getElementById(`${prefix}-strona${suffix}`)?.value || 'lewa');

  const typSlupkaRaw = document.getElementById(`${prefix}-slupek${suffix}`)?.value;
  const typSlupkaId = (typSlupkaRaw && typSlupkaRaw !== '') ? typSlupkaRaw : null;

  return {
    typId: typId,
    szerokosc_mm: sz,
    cena_zl: cn,
    strona: strona,
    odleglosc_m: odlRaw === null ? null : (jed === 'mm' ? odlRaw / 1000 : odlRaw),
    typSlupkaId: typSlupkaId,
  };
}

function pobierzJSON(dane, nazwa) {
  const blob = new Blob([JSON.stringify(dane, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: nazwa,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ═══════════════════════════════════════════════
   OBLICZENIA
   ═══════════════════════════════════════════════ */

// Oblicza jeden odcinek ogrodzenia (bez wstawek).
// usunPierwszySlupek / usunOstatniSlupek – słupki graniczne należą do sąsiedniej bramy/furtki.
function obliczFenceSegment(dlugoscM, panelMM, slupekMM, typPanel, typSlupek,
  usunPierwszySlupek = false, usunOstatniSlupek = false) {
  const c = stan.cennik;
  const segmentMM = panelMM + slupekMM;
  const dlugoscMM = Math.round(dlugoscM * 1000);
  if (dlugoscMM <= 0) return null;

  const nSeg = Math.floor(dlugoscMM / segmentMM);
  const resztaMM = dlugoscMM - nSeg * segmentMM;
  const maRestke = resztaMM > 0;
  const nPaneli = maRestke ? nSeg + 1 : nSeg;
  // Graniczne słupki przy wstawkach należą do bramy/furtki – nie liczymy ich tutaj
  let nSlupkow = maRestke ? nSeg + 2 : nSeg + 1;
  if (usunPierwszySlupek) nSlupkow = Math.max(0, nSlupkow - 1);
  if (usunOstatniSlupek) nSlupkow = Math.max(0, nSlupkow - 1);
  const nObejm = nSlupkow * 3;

  const kPanel = zaokr(nPaneli * typPanel.cena_zl);
  const kSlupki = zaokr(nSlupkow * typSlupek.cena_zl);
  const robociznaAktywna = stan.dodatki.robocizna?.aktywny !== false;
  const kRobociz = robociznaAktywna ? zaokr(dlugoscM * c.robocizna_zl_mb.wartosc) : 0;
  const kObejmy = zaokr(nObejm * c.obejma_zl.wartosc);
  const kRazem = zaokr(kPanel + kSlupki + kRobociz + kObejmy);

  return {
    typ: 'ogr', nPaneli, nSlupkow, resztaMM, maRestke, nObejm,
    kPanel, kSlupki, kRobociz, kObejmy, kRazem, dlugoscMM, panelMM, slupekMM, segmentMM
  };
}

function obliczZestaw(z) {
  const c = stan.cennik;
  const typPanel = c.typyPaneli.find(t => t.id === z.typPaneluId) || c.typyPaneli[0];
  const typSlupek = c.typySlupkow.find(t => t.id === z.typSlupkaId) || c.typySlupkow[0];
  if (!typPanel || !typSlupek) return { blad: 'Brak typów w cenniku.' };

  const panelMM = typPanel.szerokosc_mm;
  const slupekMM = typSlupek.szerokosc_mm;
  if (panelMM <= 0 || slupekMM <= 0) return { blad: 'Nieprawidłowe parametry elementów.' };

  const totalMM = Math.round(z.dlugoscM * 1000);
  if (totalMM <= 0) return { blad: 'Długość musi być większa od zera.' };

  // Zbierz wstawki (bramy/furtki) i oblicz ich pozycje od lewej strony
  const wstawki = [];
  for (const [kluczTyp, elWst] of [['brama', z.brama], ['furtka', z.furtka]]) {
    if (!elWst) continue;
    const szMM = elWst.szerokosc_mm || 0;
    if (szMM <= 0) continue;
    const odlMM = elWst.odleglosc_m != null ? Math.round(elWst.odleglosc_m * 1000) : null;
    let posOdLewej;
    if (odlMM != null) {
      posOdLewej = elWst.strona === 'lewa' ? odlMM : totalMM - odlMM - szMM;
    } else {
      posOdLewej = elWst.strona === 'lewa' ? 0 : totalMM - szMM;
    }
    posOdLewej = Math.max(0, Math.min(posOdLewej, totalMM - szMM));
    wstawki.push({ typ: kluczTyp, el: elWst, szerokosc_mm: szMM, posOdLewej });
  }
  wstawki.sort((a, b) => a.posOdLewej - b.posOdLewej);

  for (let i = 0; i < wstawki.length - 1; i++) {
    if (wstawki[i].posOdLewej + wstawki[i].szerokosc_mm > wstawki[i + 1].posOdLewej) {
      return { blad: 'Brama i furtka najeżdżają na siebie. Sprawdź opcje odległości.' };
    }
  }

  // Buduj listę segmentów: odcinek ogrodzenia ↔ wstawka (brama/furtka)
  // Słupki na styku ogrodzenie–wstawka są WSPÓLNE: należą do bramy/furtki,
  // więc odcinki panelowe nie liczą słupków granicznych.
  const segmenty = [];
  let cursor = 0;
  for (const w of wstawki) {
    const seg = obliczFenceSegment(
      (w.posOdLewej - cursor) / 1000, panelMM, slupekMM, typPanel, typSlupek,
      cursor > 0,  // lewy słupek należy do poprzedniej wstawki
      true         // prawy słupek należy do tej wstawki
    );
    if (seg) segmenty.push(seg);
    // Słupek własny wstawki (jeśli wybrany) lub fallback na słupek ogrodzenia
    const typSlupekW = (w.el.typSlupkaId
      ? c.typySlupkow.find(t => t.id === w.el.typSlupkaId)
      : null) || typSlupek;
    const kSlupkiW = zaokr(2 * typSlupekW.cena_zl);
    const kObejmyW = zaokr(6 * c.obejma_zl.wartosc);
    const kBF = zaokr(w.el.cena_zl);
    segmenty.push({
      typ: w.typ, el: w.el, szerokosc_mm: w.szerokosc_mm,
      nSlupkow: 2, nObejm: 6, kSlupki: kSlupkiW, kObejmy: kObejmyW,
      kBF, kRazem: zaokr(kSlupkiW + kObejmyW + kBF),
      typSlupek: typSlupekW, slupekMM: typSlupekW.szerokosc_mm,
    });
    cursor = w.posOdLewej + w.szerokosc_mm;
  }
  const lastSeg = obliczFenceSegment(
    (totalMM - cursor) / 1000, panelMM, slupekMM, typPanel, typSlupek,
    wstawki.length > 0,  // lewy słupek należy do ostatniej wstawki
    false                // prawy słupek = koniec ogrodzenia, liczymy normalnie
  );
  if (lastSeg) segmenty.push(lastSeg);

  const ogrSegmenty = segmenty.filter(s => s.typ === 'ogr');
  if (ogrSegmenty.length === 0) return { blad: 'Wstawki zajmują całą długość ogrodzenia.' };

  // Sumy łączne
  let nPaneli = 0, nSlupkow = 0, nObejm = 0;
  let kPanel = 0, kSlupki = 0, kRobociz = 0, kObejmy = 0, kBrama = 0, kFurtka = 0;
  let maRestke = false, maxResztaMM = 0;

  for (const seg of segmenty) {
    nSlupkow += seg.nSlupkow; nObejm += seg.nObejm;
    kSlupki += seg.kSlupki; kObejmy += seg.kObejmy;
    if (seg.typ === 'ogr') {
      nPaneli += seg.nPaneli;
      kPanel += seg.kPanel; kRobociz += seg.kRobociz;
      if (seg.maRestke) { maRestke = true; maxResztaMM = Math.max(maxResztaMM, seg.resztaMM); }
    } else if (seg.typ === 'brama') { kBrama += seg.kBF; }
    else { kFurtka += seg.kBF; }
  }
  kPanel = zaokr(kPanel); kSlupki = zaokr(kSlupki);
  kRobociz = zaokr(kRobociz); kObejmy = zaokr(kObejmy);
  const kRazem = zaokr(kPanel + kSlupki + kRobociz + kObejmy + kBrama + kFurtka);

  return {
    dlugoscMM: totalMM, dlugoscM: z.dlugoscM, panelMM, slupekMM, segmentMM: panelMM + slupekMM,
    nPaneli, nSlupkow, nObejm, maRestke, resztaMM: maxResztaMM,
    kPanel, kSlupki, kRobociz, kObejmy, kBrama, kFurtka, kRazem,
    typPanel, typSlupek, segmenty,
  };
}

function obliczDodatki() {
  const d = stan.dodatki;
  const c = stan.cennik;
  let suma = 0;
  const pozycje = [];

  if (d.transport.aktywny) {
    const kwota = (d.transport.kwota !== null && d.transport.kwota >= 0)
      ? d.transport.kwota
      : c.transport_zl.wartosc;
    suma += kwota;
    pozycje.push({ nazwa: 'Transport', kwota });
  }
  if (d.demontaz.aktywny && d.demontaz.mb > 0) {
    const kwota = zaokr(d.demontaz.mb * c.demontaz_zl_mb.wartosc);
    suma += kwota;
    pozycje.push({ nazwa: `Demontaż (${d.demontaz.mb} mb)`, kwota });
  }
  if (!d.dynamiczne) d.dynamiczne = {};
  for (const p of (c.pozycjeDodatkowe || [])) {
    const mem = d.dynamiczne[p.id];
    if (mem && mem.aktywny) {
      const ilosc = mem.ilosc || 1;
      const kwota = zaokr(p.wartosc * ilosc);
      suma += kwota;
      pozycje.push({ nazwa: `${p.nazwa || 'Pozycja dodatkowa'} (${ilosc} ${p.jednostka})`, kwota });
    }
  }
  return { suma: zaokr(suma), pozycje };
}

/* ═══════════════════════════════════════════════
   SVG
   ═══════════════════════════════════════════════ */
function generujSVG(obl) {
  const MAX_W = 340;
  const H = 40; // Wysokość szkieletu rysunku
  const Y_DIM = 52; // Linia wymiarowania poniżej rysunku
  const CP = '#5c7a9c'; // Kolor krawędzi panelu
  const CS = '#f5a623'; // Kolor krawędzi słupka
  const CR = '#e8831a'; // Kolor krawędzi reszty
  const CBR = '#27ae60'; // Kolor krawędzi bramy
  const CF = '#9b59b6'; // Kolor krawędzi furtki

  // Oblicz całkowitą wizualną szerokość w mm dla skalowania
  let totalVisMM = 0;
  for (const seg of obl.segmenty) {
    if (seg.typ === 'ogr') totalVisMM += seg.dlugoscMM;
    else totalVisMM += 2 * (seg.slupekMM ?? obl.slupekMM) + seg.szerokosc_mm;
  }
  const skala = Math.min(MAX_W / Math.max(totalVisMM, 1), 0.15);

  let x = 0, s = '', hasBF = false;
  let markedPanel = false;

  for (const seg of obl.segmenty) {
    if (seg.typ === 'ogr') {
      const nPelnych = seg.maRestke ? seg.nPaneli - 1 : seg.nPaneli;

      for (let i = 0; i < nPelnych; i++) {
        // Słupek
        const sw = Math.max(2, Math.round(obl.slupekMM * skala));
        s += `<rect x="${x}" y="5" width="${sw}" height="${H - 5}" fill="none" stroke="${CS}" stroke-width="1"/>`;
        x += sw;

        // Panel szkieletowy
        const pw = Math.round(obl.panelMM * skala);
        s += `<rect x="${x}" y="0" width="${pw}" height="${H}" fill="none" stroke="${CP}" stroke-width="1"/>`;
        s += `<line x1="${x}" y1="${H * .3}" x2="${x + pw}" y2="${H * .3}" stroke="${CP}" stroke-width="0.5" stroke-dasharray="2 2"/>`;
        s += `<line x1="${x}" y1="${H * .7}" x2="${x + pw}" y2="${H * .7}" stroke="${CP}" stroke-width="0.5" stroke-dasharray="2 2"/>`;
        s += `<line x1="${x}" y1="0" x2="${x + pw}" y2="${H}" stroke="${CP}" stroke-width="0.2"/>`;
        s += `<line x1="${x + pw}" y1="0" x2="${x}" y2="${H}" stroke="${CP}" stroke-width="0.2"/>`;

        // Wymiar panelu
        if (!markedPanel && pw > 20) {
          s += `<line x1="${x}" y1="${Y_DIM - 3}" x2="${x}" y2="${Y_DIM + 3}" stroke="#666" stroke-width="1"/>`;
          s += `<line x1="${x + pw}" y1="${Y_DIM - 3}" x2="${x + pw}" y2="${Y_DIM + 3}" stroke="#666" stroke-width="1"/>`;
          s += `<line x1="${x}" y1="${Y_DIM}" x2="${x + pw}" y2="${Y_DIM}" stroke="#666" stroke-width="0.5"/>`;
          s += `<text x="${x + pw / 2}" y="${Y_DIM - 2}" text-anchor="middle" font-size="6" fill="#888" font-family="sans-serif">${obl.panelMM}</text>`;
          markedPanel = true;
        }
        x += pw;
      }

      if (seg.maRestke) {
        const sw = Math.max(2, Math.round(obl.slupekMM * skala));
        s += `<rect x="${x}" y="5" width="${sw}" height="${H - 5}" fill="none" stroke="${CS}" stroke-width="1"/>`;
        x += sw;

        const rw = Math.max(4, Math.round(seg.resztaMM * skala));
        s += `<rect x="${x}" y="0" width="${rw}" height="${H}" fill="none" stroke="${CR}" stroke-width="1" stroke-dasharray="2 2"/>`;

        if (rw > 15) {
          s += `<line x1="${x}" y1="${Y_DIM - 3}" x2="${x}" y2="${Y_DIM + 3}" stroke="${CR}" stroke-width="1"/>`;
          s += `<line x1="${x + rw}" y1="${Y_DIM - 3}" x2="${x + rw}" y2="${Y_DIM + 3}" stroke="${CR}" stroke-width="1"/>`;
          s += `<line x1="${x}" y1="${Y_DIM}" x2="${x + rw}" y2="${Y_DIM}" stroke="${CR}" stroke-width="0.5"/>`;
          s += `<text x="${x + rw / 2}" y="${Y_DIM - 2}" text-anchor="middle" font-size="6" fill="${CR}" font-family="sans-serif">${seg.resztaMM}</text>`;
        } else {
          s += `<text x="${x + rw / 2}" y="${H / 2 + 2}" text-anchor="middle" font-size="6" fill="${CR}" font-family="sans-serif">R</text>`;
        }
        x += rw;
      }

      // Słupek końcowy
      const sw = Math.max(2, Math.round(obl.slupekMM * skala));
      s += `<rect x="${x}" y="5" width="${sw}" height="${H - 5}" fill="none" stroke="${CS}" stroke-width="1"/>`;
      x += sw;

    } else {
      hasBF = true;
      const kolor = seg.typ === 'brama' ? CBR : CF;
      const etykieta = seg.typ === 'brama' ? 'B' : 'F';

      const sw = Math.max(2, Math.round((seg.slupekMM ?? obl.slupekMM) * skala));
      s += `<rect x="${x}" y="5" width="${sw}" height="${H - 5}" fill="none" stroke="${CS}" stroke-width="1"/>`;
      x += sw;

      const bw = Math.max(10, Math.round(seg.szerokosc_mm * skala));
      s += `<rect x="${x}" y="0" width="${bw}" height="${H}" fill="none" stroke="${kolor}" stroke-width="1.5"/>`;
      s += `<line x1="${x}" y1="0" x2="${x + bw}" y2="${H}" stroke="${kolor}" stroke-width="0.5"/>`;
      s += `<line x1="${x + bw}" y1="0" x2="${x}" y2="${H}" stroke="${kolor}" stroke-width="0.5"/>`;

      if (bw > 20) {
        s += `<rect x="${x + bw / 2 - 6}" y="${H / 2 - 6}" width="12" height="12" fill="#1a2332" stroke="${kolor}" rx="2"/>`;
        s += `<text x="${x + bw / 2}" y="${H / 2 + 3}" text-anchor="middle" font-size="8" font-weight="bold" fill="${kolor}" font-family="sans-serif">${etykieta}</text>`;

        s += `<line x1="${x}" y1="${Y_DIM - 3}" x2="${x}" y2="${Y_DIM + 3}" stroke="${kolor}" stroke-width="1"/>`;
        s += `<line x1="${x + bw}" y1="${Y_DIM - 3}" x2="${x + bw}" y2="${Y_DIM + 3}" stroke="${kolor}" stroke-width="1"/>`;
        s += `<line x1="${x}" y1="${Y_DIM}" x2="${x + bw}" y2="${Y_DIM}" stroke="${kolor}" stroke-width="0.5"/>`;
        s += `<text x="${x + bw / 2}" y="${Y_DIM - 2}" text-anchor="middle" font-size="6" fill="${kolor}" font-family="sans-serif">${seg.szerokosc_mm}</text>`;
      } else {
        s += `<text x="${x + bw / 2}" y="${H / 2 + 3}" text-anchor="middle" font-size="7" font-weight="bold" fill="${kolor}" font-family="sans-serif">${etykieta}</text>`;
      }
      x += bw;

      const sw2 = Math.max(2, Math.round((seg.slupekMM ?? obl.slupekMM) * skala));
      s += `<rect x="${x}" y="5" width="${sw2}" height="${H - 5}" fill="none" stroke="${CS}" stroke-width="1"/>`;
      x += sw2;
    }
  }

  const LY = Y_DIM + 12;
  s += `
    <rect x="0"  y="${LY}" width="10" height="6" fill="none" stroke="${CP}" rx="1"/>
    <text x="14" y="${LY + 5}" font-size="7" fill="#a8bbd0" font-family="sans-serif">Panel</text>
    <rect x="50" y="${LY}" width="6"  height="6" fill="none" stroke="${CS}" rx="1"/>
    <text x="60" y="${LY + 5}" font-size="7" fill="#a8bbd0" font-family="sans-serif">Słupek</text>
    ${obl.maRestke ? `<rect x="95" y="${LY}" width="10" height="6" fill="none" stroke="${CR}" rx="1" stroke-dasharray="1 1"/><text x="109" y="${LY + 5}" font-size="7" fill="#a8bbd0" font-family="sans-serif">Reszta</text>` : ''}
    ${hasBF ? `<rect x="145" y="${LY}" width="8" height="6" fill="none" stroke="${CBR}" stroke-width="1.5" rx="1"/><text x="157" y="${LY + 5}" font-size="7" fill="#a8bbd0" font-family="sans-serif">B=Brama</text>
    <rect x="210" y="${LY}" width="8" height="6" fill="none" stroke="${CF}" stroke-width="1.5" rx="1"/><text x="222" y="${LY + 5}" font-size="7" fill="#a8bbd0" font-family="sans-serif">F=Furtka</text>` : ''}`;

  const W = Math.max(x, 260);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LY + 15}" viewBox="0 0 ${W} ${LY + 15}">${s}</svg>`;
}

/* ═══════════════════════════════════════════════
   RENDEROWANIE – ZESTAWY
   ═══════════════════════════════════════════════ */
function renderZestawy() {
  const lista = document.getElementById('zestawy-lista');

  if (stan.zestawy.length === 0) {
    lista.innerHTML = '<div class="empty-state">Nie dodano jeszcze żadnego zestawu.<br>Wpisz nazwę i długość powyżej.</div>';
    return;
  }

  lista.innerHTML = stan.zestawy.map((z, i) =>
    z.id === idEdytowanego ? htmlZestaw_edycja(z, i) : htmlZestaw_widok(z, i)
  ).join('');
}

function htmlZestaw_widok(z, i) {
  const obl = obliczZestaw(z);

  if (obl.blad) {
    return `<div class="zestaw-item">
      <div class="zestaw-header">
        <div class="zestaw-num">${i + 1}</div>
        <div class="zestaw-nazwa">${escHtml(z.nazwa)}</div>
        <span style="color:var(--red);font-size:.8rem;flex:1">${escHtml(obl.blad)}</span>
        <button class="btn btn-danger btn-sm" onclick="usunZestaw('${z.id}')">Usuń</button>
      </div>
    </div>`;
  }

  const dl = stan.ustawienia.jednostka === 'm'
    ? formatN(z.dlugoscM, 3) + ' m'
    : obl.dlugoscMM + ' mm';

  const jed2 = stan.ustawienia.jednostka;
  function odlStr(wst) {
    if (wst.odleglosc_m == null) return '';
    const odlVal = jed2 === 'mm' ? Math.round(wst.odleglosc_m * 1000) + ' mm' : formatN(wst.odleglosc_m, 2) + ' m';
    return ` · od ${wst.strona === 'lewa' ? 'lewej' : 'prawej'}: ${odlVal}`;
  }
  const bramaInfo = z.brama ? `<span class="brama-badge">B: ${escHtml(z.brama.strona === 'lewa' ? '←' : '→')} ${z.brama.szerokosc_mm} mm${odlStr(z.brama)} · ${formatZl(z.brama.cena_zl)}</span>` : '';
  const furtkaInfo = z.furtka ? `<span class="furtka-badge">F: ${escHtml(z.furtka.strona === 'lewa' ? '←' : '→')} ${z.furtka.szerokosc_mm} mm${odlStr(z.furtka)} · ${formatZl(z.furtka.cena_zl)}</span>` : '';

  return `
  <div class="zestaw-item">
    <div class="zestaw-header">
      <div class="zestaw-num">${i + 1}</div>
      <div class="zestaw-nazwa">${escHtml(z.nazwa)}</div>
      <div class="zestaw-dl">${dl}</div>
      <div class="zestaw-kwota">${formatZl(obl.kRazem)}</div>
    </div>
    <div class="zestaw-body">
      <div style="font-size:.78rem;color:var(--text3);margin-bottom:8px">
        Panel: <strong style="color:var(--text2)">${escHtml(obl.typPanel.nazwa)}</strong> ·
        Słupek: <strong style="color:var(--text2)">${escHtml(obl.typSlupek.nazwa)}</strong>
      </div>
      ${(bramaInfo || furtkaInfo) ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${bramaInfo}${furtkaInfo}</div>` : ''}
      <div class="calc-grid">
        <div class="calc-cell">
          <div class="val">${obl.nPaneli}</div>
          <div class="lbl">Panele</div>
        </div>
        <div class="calc-cell">
          <div class="val">${obl.nSlupkow}</div>
          <div class="lbl">Słupki</div>
        </div>
        <div class="calc-cell">
          <div class="val">${obl.resztaMM > 0 ? obl.resztaMM + ' mm' : '—'}</div>
          <div class="lbl">Reszta</div>
        </div>
      </div>
      ${(() => {
      const jed = stan.ustawienia.jednostka;
      let segIdx = 0;
      return obl.segmenty.map(seg => {
        if (seg.typ === 'ogr') {
          segIdx++;
          const sdl = jed === 'm' ? formatN(seg.dlugoscMM / 1000, 3) + ' m' : seg.dlugoscMM + ' mm';
          const rst = seg.maRestke ? ` · reszta ${seg.resztaMM} mm` : '';
          return `<div class="seg-info">Odcinek ${segIdx} (${sdl}): <strong>${seg.nPaneli}</strong> pan. · <strong>${seg.nSlupkow}</strong> sł.${rst}</div>`;
        } else {
          const kolor = seg.typ === 'brama' ? 'var(--green)' : '#9b59b6';
          const etyk = seg.typ === 'brama' ? 'Brama' : 'Furtka';
          return `<div class="seg-info" style="color:${kolor}">${etyk}: ${seg.szerokosc_mm} mm · 2 słupki · ${formatZl(seg.kRazem)}</div>`;
        }
      }).join('');
    })()}
      <div class="svg-wrapper">${generujSVG(obl)}</div>
      <div>
        <div class="suma-row">
          <span class="lbl">Panele (${obl.nPaneli} × ${formatZl(obl.typPanel.cena_zl)})</span>
          <span class="val">${formatZl(obl.kPanel)}</span>
        </div>
        <div class="suma-row">
          <span class="lbl">${(() => {
            const maInnySlupek = obl.segmenty.some(
              s => s.typ !== 'ogr' && s.typSlupek && s.typSlupek.id !== obl.typSlupek.id
            );
            return maInnySlupek
              ? `Słupki (${obl.nSlupkow} szt., różne typy)`
              : `Słupki (${obl.nSlupkow} × ${formatZl(obl.typSlupek.cena_zl)})`;
          })()}</span>
          <span class="val">${formatZl(obl.kSlupki)}</span>
        </div>
        <div class="suma-row">
          <span class="lbl">Obejmy (${obl.nObejm} × ${formatZl(stan.cennik.obejma_zl.wartosc)})</span>
          <span class="val">${formatZl(obl.kObejmy)}</span>
        </div>
        ${obl.kRobociz ? `<div class="suma-row">
          <span class="lbl">Robocizna (${formatN(z.dlugoscM, 2)} mb × ${formatZl(stan.cennik.robocizna_zl_mb.wartosc)})</span>
          <span class="val">${formatZl(obl.kRobociz)}</span>
        </div>` : ''}
        ${obl.kBrama ? `<div class="suma-row"><span class="lbl">Brama</span><span class="val">${formatZl(obl.kBrama)}</span></div>` : ''}
        ${obl.kFurtka ? `<div class="suma-row"><span class="lbl">Furtka</span><span class="val">${formatZl(obl.kFurtka)}</span></div>` : ''}
      </div>
      <div class="zestaw-actions">
        <button class="btn btn-ghost btn-sm" onclick="rozpocznijEdycje('${z.id}')">Edytuj</button>
        <button class="btn btn-danger btn-sm" onclick="usunZestaw('${z.id}')">Usuń</button>
      </div>
    </div>
  </div>`;
}

function htmlZestaw_edycja(z, i) {
  const jed = stan.ustawienia.jednostka;
  const val = jed === 'm' ? z.dlugoscM : z.dlugoscM * 1000;
  const step = jed === 'm' ? '0.01' : '10';

  const optPanele = stan.cennik.typyPaneli.map(t =>
    `<option value="${escHtml(t.id)}" ${t.id === z.typPaneluId ? 'selected' : ''}>${escHtml(t.nazwa)}</option>`).join('');
  const optSlupki = stan.cennik.typySlupkow.map(t =>
    `<option value="${escHtml(t.id)}" ${t.id === z.typSlupkaId ? 'selected' : ''}>${escHtml(t.nazwa)}</option>`).join('');
  const optBramy = '<option value="">Brak</option>' + stan.cennik.typyBram.map(t =>
    `<option value="${escHtml(t.id)}" ${z.brama?.typId === t.id ? 'selected' : ''}>${escHtml(t.nazwa)}</option>`).join('');
  const optFurtki = '<option value="">Brak</option>' + stan.cennik.typyFurtek.map(t =>
    `<option value="${escHtml(t.id)}" ${z.furtka?.typId === t.id ? 'selected' : ''}>${escHtml(t.nazwa)}</option>`).join('');
  const optSlupkiBramy = '<option value="">Jak ogrodzenie</option>' + stan.cennik.typySlupkow.map(t =>
    `<option value="${escHtml(t.id)}" ${z.brama?.typSlupkaId === t.id ? 'selected' : ''}>${escHtml(t.nazwa)}</option>`).join('');
  const optSlupkiFurtki = '<option value="">Jak ogrodzenie</option>' + stan.cennik.typySlupkow.map(t =>
    `<option value="${escHtml(t.id)}" ${z.furtka?.typSlupkaId === t.id ? 'selected' : ''}>${escHtml(t.nazwa)}</option>`).join('');

  return `
  <div class="zestaw-item edytowany">
    <div class="zestaw-header">
      <div class="zestaw-num">${i + 1}</div>
      <div class="zestaw-nazwa">${escHtml(z.nazwa)}</div>
      <span style="font-size:.75rem;color:var(--accent);margin-left:auto">edycja</span>
    </div>
    <div class="zestaw-body">
      <div class="form-row">
        <label>Nazwa odcinka</label>
        <input type="text" id="edit-nazwa-${z.id}" value="${escHtml(z.nazwa)}"
               onkeydown="if(event.key==='Escape') anulujEdycje()">
      </div>
      <div class="form-row">
        <label>Długość (${jed})</label>
        <input type="number" id="edit-dl-${z.id}" value="${val}" min="0.01" step="${step}"
               onkeydown="if(event.key==='Enter') zapiszEdycje('${z.id}'); if(event.key==='Escape') anulujEdycje()">
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label>Typ panelu</label>
          <select id="edit-typ-panelu-${z.id}">${optPanele}</select>
        </div>
        <div class="form-row">
          <label>Typ słupka</label>
          <select id="edit-typ-slupka-${z.id}">${optSlupki}</select>
        </div>
      </div>
      <div class="form-row">
        <label>Brama</label>
        <select id="edit-brama-typ-${z.id}" onchange="onEdytBramaTypChange('${z.id}')">${optBramy}</select>
      </div>
      <div id="edit-brama-extra-${z.id}" style="display:${z.brama ? 'block' : 'none'};padding:6px 0 4px">
        <div class="form-grid">
          <div class="form-row"><label>Szerokość (mm)</label>
            <input type="number" id="edit-brama-szer-${z.id}" value="${z.brama?.szerokosc_mm || 4000}" min="100" step="100">
          </div>
          <div class="form-row"><label>Cena (zł)</label>
            <input type="number" id="edit-brama-cena-${z.id}" value="${z.brama?.cena_zl || 0}" min="0" step="10">
          </div>
        </div>
        <div class="form-row"><label>Strona</label>
          <select id="edit-brama-strona-${z.id}">
            <option value="lewa"  ${z.brama?.strona !== 'prawa' ? 'selected' : ''}>← Lewa</option>
            <option value="prawa" ${z.brama?.strona === 'prawa' ? 'selected' : ''}>Prawa →</option>
          </select>
        </div>
        <div class="form-row"><label>Odległość od strony (${jed})</label>
          <input type="number" id="edit-brama-odl-${z.id}"
                 value="${z.brama?.odleglosc_m != null ? (jed === 'mm' ? z.brama.odleglosc_m * 1000 : z.brama.odleglosc_m) : ''}"
                 placeholder="np. 3" min="0" step="${jed === 'mm' ? '100' : '0.01'}">
        </div>
        <div class="form-row"><label>Typ słupka bramy</label>
          <select id="edit-brama-slupek-${z.id}">${optSlupkiBramy}</select>
        </div>
      </div>
      <div class="form-row">
        <label>Furtka</label>
        <select id="edit-furtka-typ-${z.id}" onchange="onEdytFurtkaTypChange('${z.id}')">${optFurtki}</select>
      </div>
      <div id="edit-furtka-extra-${z.id}" style="display:${z.furtka ? 'block' : 'none'};padding:6px 0 4px">
        <div class="form-grid">
          <div class="form-row"><label>Szerokość (mm)</label>
            <input type="number" id="edit-furtka-szer-${z.id}" value="${z.furtka?.szerokosc_mm || 1000}" min="100" step="100">
          </div>
          <div class="form-row"><label>Cena (zł)</label>
            <input type="number" id="edit-furtka-cena-${z.id}" value="${z.furtka?.cena_zl || 0}" min="0" step="10">
          </div>
        </div>
        <div class="form-row"><label>Strona</label>
          <select id="edit-furtka-strona-${z.id}">
            <option value="lewa"  ${z.furtka?.strona !== 'prawa' ? 'selected' : ''}>← Lewa</option>
            <option value="prawa" ${z.furtka?.strona === 'prawa' ? 'selected' : ''}>Prawa →</option>
          </select>
        </div>
        <div class="form-row"><label>Odległość od strony (${jed})</label>
          <input type="number" id="edit-furtka-odl-${z.id}"
                 value="${z.furtka?.odleglosc_m != null ? (jed === 'mm' ? z.furtka.odleglosc_m * 1000 : z.furtka.odleglosc_m) : ''}"
                 placeholder="np. 3" min="0" step="${jed === 'mm' ? '100' : '0.01'}">
        </div>
        <div class="form-row"><label>Typ słupka furtki</label>
          <select id="edit-furtka-slupek-${z.id}">${optSlupkiFurtki}</select>
        </div>
      </div>
      <div class="zestaw-actions">
        <button class="btn btn-primary btn-sm" onclick="zapiszEdycje('${z.id}')">Zapisz</button>
        <button class="btn btn-ghost btn-sm"   onclick="anulujEdycje()">Anuluj</button>
      </div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════
   RENDEROWANIE – CENNIK
   ═══════════════════════════════════════════════ */
function renderCennik() {
  const stawkiKlucze = ['robocizna_zl_mb', 'transport_zl', 'demontaz_zl_mb', 'obejma_zl'];

  const stawkiHtml = stawkiKlucze.map(k => {
    const poz = stan.cennik[k];
    return `<tr>
      <td><input type="text" class="cennik-input-text" value="${escHtml(poz.nazwa)}"
                 data-klucz="${k}" data-pole="nazwa" onchange="zapiszCennikPole(this)"></td>
      <td><input type="number" value="${poz.wartosc}" min="0" step="0.01"
                 data-klucz="${k}" oninput="walidujCennikInput(this)" onchange="zapiszCennik(this)"></td>
      <td><input type="text" class="cennik-input-unit" value="${escHtml(poz.jednostka)}"
                 data-klucz="${k}" data-pole="jednostka" onchange="zapiszCennikPole(this)"></td>
      <td></td>
    </tr>`;
  }).join('');

  const pozDod = stan.cennik.pozycjeDodatkowe || [];
  const pozDodHtml = pozDod.map(p => `<tr>
      <td><input type="text" class="cennik-input-text" value="${escHtml(p.nazwa)}" placeholder="Nazwa"
                 data-pozid="${p.id}" data-pole="nazwa" onchange="zapiszPozycjeDodatkowa(this)"></td>
      <td><input type="number" value="${p.wartosc}" min="0" step="0.01" placeholder="0"
                 data-pozid="${p.id}" data-pole="wartosc" oninput="walidujCennikInput(this)" onchange="zapiszPozycjeDodatkowa(this)"></td>
      <td><input type="text" class="cennik-input-unit" value="${escHtml(p.jednostka)}" placeholder="zł"
                 data-pozid="${p.id}" data-pole="jednostka" onchange="zapiszPozycjeDodatkowa(this)"></td>
      <td><button class="btn btn-danger btn-sm" onclick="usunPozycjeDodatkowa('${p.id}')">✕</button></td>
    </tr>`).join('');

  document.getElementById('cennik-stawki-tbody').innerHTML = stawkiHtml + pozDodHtml;

  renderTypyLista('cennik-panele', stan.cennik.typyPaneli, 'panel');
  renderTypyLista('cennik-slupki', stan.cennik.typySlupkow, 'slupek');
  renderTypyLista('cennik-bramy', stan.cennik.typyBram, 'brama');
  renderTypyLista('cennik-furtki', stan.cennik.typyFurtek, 'furtka');
  renderDodatkiDynamiczne();
}

function zapiszCennikPole(el) {
  const { klucz, pole } = el.dataset;
  if (!stan.cennik[klucz]) return;
  stan.cennik[klucz][pole] = el.value.trim();
  zapiszDane();
}

function dodajPozycjeDodatkowa() {
  if (!stan.cennik.pozycjeDodatkowe) stan.cennik.pozycjeDodatkowe = [];
  stan.cennik.pozycjeDodatkowe.push({
    id: 'pd_' + Date.now(),
    nazwa: 'Nowa pozycja',
    wartosc: 0,
    jednostka: 'zł',
  });
  zapiszDane();
  renderCennik();
  toast('Dodano nową pozycję');
}

function zapiszPozycjeDodatkowa(el) {
  const { pozid, pole } = el.dataset;
  const poz = (stan.cennik.pozycjeDodatkowe || []).find(p => p.id === pozid);
  if (!poz) return;
  if (pole === 'wartosc') {
    const v = parseFloat(el.value);
    if (isNaN(v) || v < 0) { el.style.borderColor = 'var(--red)'; return; }
    el.style.borderColor = '';
    poz[pole] = v;
    aktualizujSume();
  } else {
    poz[pole] = el.value.trim();
  }
  zapiszDane();
  renderDodatkiDynamiczne();
}

function usunPozycjeDodatkowa(id) {
  stan.cennik.pozycjeDodatkowe = (stan.cennik.pozycjeDodatkowe || []).filter(p => p.id !== id);
  zapiszDane();
  renderCennik();
  aktualizujSume();
}

function renderTypyLista(containerId, typy, typ) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const masSzerokosc = (typ === 'panel' || typ === 'slupek');
  el.innerHTML = typy.map(t => `
    <div class="typ-row">
      <input type="text" value="${escHtml(t.nazwa)}" placeholder="Nazwa"
             data-typ="${typ}" data-id="${t.id}" data-pole="nazwa" onchange="zapiszTypPole(this)">
      ${masSzerokosc ? `<input type="number" value="${t.szerokosc_mm}" min="1" step="10"
             title="Szerokość (mm)" placeholder="mm"
             data-typ="${typ}" data-id="${t.id}" data-pole="szerokosc_mm" onchange="zapiszTypPole(this)">
      <span class="typ-unit">mm</span>` : ''}
      <input type="number" value="${t.cena_zl}" min="0" step="1"
             title="Cena (zł)" placeholder="zł"
             data-typ="${typ}" data-id="${t.id}" data-pole="cena_zl" onchange="zapiszTypPole(this)">
      <span class="typ-unit">zł/szt</span>
      <button class="btn btn-danger btn-sm" style="flex-shrink:0"
              onclick="usunTypCennik('${typ}','${t.id}')"
              ${typy.length <= 1 ? 'disabled title="Minimum 1 typ"' : ''}>✕</button>
    </div>`).join('') || '<div style="font-size:.85rem;color:var(--text3);padding:8px 0">Brak typów</div>';
}

function zapiszTypPole(el) {
  const { typ, id, pole } = el.dataset;
  const listaMap = { panel: 'typyPaneli', slupek: 'typySlupkow', brama: 'typyBram', furtka: 'typyFurtek' };
  const lista = stan.cennik[listaMap[typ]];
  const t = lista?.find(x => x.id === id);
  if (!t) return;
  const v = pole === 'nazwa' ? el.value.trim() : parseFloat(el.value);
  if (pole !== 'nazwa' && (isNaN(v) || v < 0)) { el.style.borderColor = 'var(--red)'; return; }
  el.style.borderColor = '';
  t[pole] = v;
  zapiszDane();
  if (pole !== 'nazwa') { renderZestawy(); aktualizujSume(); }
  odswiezSelecty();
}

function dodajTypCennik(typ) {
  const listaMap = { panel: 'typyPaneli', slupek: 'typySlupkow', brama: 'typyBram', furtka: 'typyFurtek' };
  const lista = stan.cennik[listaMap[typ]];
  const id = typ[0] + '_' + Date.now();
  if (typ === 'panel') lista.push({ id, nazwa: 'Nowy typ panelu', szerokosc_mm: 2500, cena_zl: 150 });
  if (typ === 'slupek') lista.push({ id, nazwa: 'Nowy typ słupka', szerokosc_mm: 40, cena_zl: 80 });
  if (typ === 'brama') lista.push({ id, nazwa: 'Nowa brama', cena_zl: 1200 });
  if (typ === 'furtka') lista.push({ id, nazwa: 'Nowa furtka', cena_zl: 450 });
  zapiszDane();
  renderCennik();
  odswiezSelecty();
  toast(`Dodano nowy typ`);
}

function usunTypCennik(typ, id) {
  const listaMap = { panel: 'typyPaneli', slupek: 'typySlupkow', brama: 'typyBram', furtka: 'typyFurtek' };
  const lista = stan.cennik[listaMap[typ]];
  if (lista.length <= 1) return;
  stan.cennik[listaMap[typ]] = lista.filter(t => t.id !== id);
  zapiszDane();
  renderCennik();
  renderZestawy();
  aktualizujSume();
  odswiezSelecty();
}

function odswiezSelecty() {
  populujSelect('nowy-typ-panelu', stan.cennik.typyPaneli);
  populujSelect('nowy-typ-slupka', stan.cennik.typySlupkow);
  populujSelectZBrakiem('nowy-brama-typ', stan.cennik.typyBram);
  populujSelectZBrakiem('nowy-furtka-typ', stan.cennik.typyFurtek);
  populujSelectZFallbackiem('nowy-brama-slupek', stan.cennik.typySlupkow);
  populujSelectZFallbackiem('nowy-furtka-slupek', stan.cennik.typySlupkow);
}

function populujSelectZFallbackiem(id, typy, etykieta = 'Jak ogrodzenie') {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = el.value;
  el.innerHTML = `<option value="">${escHtml(etykieta)}</option>` +
    typy.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.nazwa)}</option>`).join('');
  el.value = typy.find(t => t.id === prev) ? prev : '';
}

function populujSelect(id, typy, selectedId) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = el.value;
  el.innerHTML = typy.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.nazwa)}</option>`).join('');
  if (selectedId && typy.find(t => t.id === selectedId)) el.value = selectedId;
  else if (prev && typy.find(t => t.id === prev)) el.value = prev;
}

function populujSelectZBrakiem(id, typy, selectedId) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = el.value;
  el.innerHTML = '<option value="">Brak</option>' +
    typy.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.nazwa)}</option>`).join('');
  if (selectedId && typy.find(t => t.id === selectedId)) el.value = selectedId;
  else if (prev && (prev === '' || typy.find(t => t.id === prev))) el.value = prev;
}

let _nowaBramaStrona = 'lewa';
let _nowaFurtkaStrona = 'lewa';

function _setWstawkaStrona(rodzaj, strona) {
  if (rodzaj === 'brama') _nowaBramaStrona = strona;
  else _nowaFurtkaStrona = strona;
  document.getElementById(`nowy-${rodzaj}-btn-lewa`).classList.toggle('active', strona === 'lewa');
  document.getElementById(`nowy-${rodzaj}-btn-prawa`).classList.toggle('active', strona === 'prawa');
}
function setNowaBramaStrona(strona) { _setWstawkaStrona('brama', strona); }
function setNowaFurtkaStrona(strona) { _setWstawkaStrona('furtka', strona); }
function _onWstawkaTypChange(prefix, sufiks, typy) {
  const sel = document.getElementById(`${prefix}-typ${sufiks}`);
  const show = sel.value !== '';
  document.getElementById(`${prefix}-extra${sufiks}`).style.display = show ? 'block' : 'none';
  if (show) {
    const typ = typy.find(t => t.id === sel.value);
    if (typ) document.getElementById(`${prefix}-cena${sufiks}`).value = typ.cena_zl;
  }
}
function onNowaBramaTypChange() { _onWstawkaTypChange('nowy-brama', '', stan.cennik.typyBram); }
function onNowaFurtkaTypChange() { _onWstawkaTypChange('nowy-furtka', '', stan.cennik.typyFurtek); }
function onEdytBramaTypChange(id) { _onWstawkaTypChange('edit-brama', `-${id}`, stan.cennik.typyBram); }
function onEdytFurtkaTypChange(id) { _onWstawkaTypChange('edit-furtka', `-${id}`, stan.cennik.typyFurtek); }

/* ═══════════════════════════════════════════════
   RENDEROWANIE – RAPORT
   ═══════════════════════════════════════════════ */
function renderRaport() {
  const k = stan.klient;
  const dod = obliczDodatki();
  let sumaZestawow = 0;

  const zestawyHtml = stan.zestawy.map((z, i) => {
    const obl = obliczZestaw(z);
    if (obl.blad) return '';
    sumaZestawow += obl.kRazem;
    const dl = stan.ustawienia.jednostka === 'm'
      ? formatN(z.dlugoscM, 3) + ' m'
      : obl.dlugoscMM + ' mm';

    // Szczegółowe składowe
    let skladoweHtml = '';
    let segIdx = 0;
    for (const seg of obl.segmenty) {
      if (seg.typ === 'ogr') {
        segIdx++;
        const sdl = stan.ustawienia.jednostka === 'm'
          ? formatN(seg.dlugoscMM / 1000, 3) + ' m'
          : seg.dlugoscMM + ' mm';
        const rst = seg.maRestke ? ` <span class="rap-note">(reszta ${seg.resztaMM} mm)</span>` : '';
        skladoweHtml += `
          <div class="rap-sub-header">Odcinek ${segIdx} – ${sdl}${rst}</div>
          <div class="rap-row rap-indent">
            <span class="l">${escHtml(obl.typPanel.nazwa)} × ${seg.nPaneli} szt.</span>
            <span class="v">${formatZl(seg.kPanel)}</span>
          </div>
          <div class="rap-row rap-indent">
            <span class="l">${escHtml(obl.typSlupek.nazwa)} × ${seg.nSlupkow} szt.</span>
            <span class="v">${formatZl(seg.kSlupki)}</span>
          </div>
          <div class="rap-row rap-indent">
            <span class="l">Obejmy × ${seg.nObejm} szt.</span>
            <span class="v">${formatZl(seg.kObejmy)}</span>
          </div>
          ${seg.kRobociz ? `<div class="rap-row rap-indent">
            <span class="l">Robocizna (${formatN(seg.dlugoscMM / 1000, 3)} mb × ${formatZl(stan.cennik.robocizna_zl_mb.wartosc)})</span>
            <span class="v">${formatZl(seg.kRobociz)}</span>
          </div>` : ''}`;
      } else {
        const etyk = seg.typ === 'brama' ? 'Brama' : 'Furtka';
        const nazwaEl = seg.el?.typId
          ? (seg.typ === 'brama'
            ? stan.cennik.typyBram.find(t => t.id === seg.el.typId)?.nazwa
            : stan.cennik.typyFurtek.find(t => t.id === seg.el.typId)?.nazwa)
          : null;
        skladoweHtml += `
          <div class="rap-sub-header" style="color:${seg.typ === 'brama' ? 'var(--green)' : '#9b59b6'}">${etyk}${nazwaEl ? ' – ' + escHtml(nazwaEl) : ''} (${seg.szerokosc_mm} mm)</div>
          <div class="rap-row rap-indent">
            <span class="l">${etyk} – materiał</span>
            <span class="v">${formatZl(seg.kBF)}</span>
          </div>
          <div class="rap-row rap-indent">
            <span class="l">${escHtml(seg.typSlupek?.nazwa ?? obl.typSlupek.nazwa)} × 2 szt. (słupki ${etyk.toLowerCase()})</span>
            <span class="v">${formatZl(seg.kSlupki)}</span>
          </div>
          <div class="rap-row rap-indent">
            <span class="l">Obejmy × ${seg.nObejm} szt.</span>
            <span class="v">${formatZl(seg.kObejmy)}</span>
          </div>`;
      }
    }

    return `
      <div class="rap-row" style="margin-top:8px">
        <span class="l"><strong>${i + 1}. ${escHtml(z.nazwa)}</strong> (${dl})</span>
        <span class="v"><strong>${formatZl(obl.kRazem)}</strong></span>
      </div>
      <div class="rap-svg">${generujSVG(obl)}</div>
      ${skladoweHtml}`;
  }).join('');

  const totalPrzed = zaokr(sumaZestawow + dod.suma);
  const total = zaokr(totalPrzed + (stan.dodatki.korekta || 0));

  const geoUrl = k.geo ? `https://www.google.com/maps?q=${k.geo.lat},${k.geo.lon}` : null;
  const klientHtml = [
    k.nazwa && `<div class="rap-row"><span class="l">Nazwa</span><span class="v">${escHtml(k.nazwa)}</span></div>`,
    k.adres && `<div class="rap-row"><span class="l">Adres</span><span class="v">${escHtml(k.adres)}</span></div>`,
    k.geo && `<div class="rap-row"><span class="l">Lokalizacja GPS</span><span class="v"><a href="${geoUrl}" target="_blank" rel="noopener" style="color:var(--accent)">${k.geo.lat.toFixed(6)}, ${k.geo.lon.toFixed(6)}</a></span></div>`,
    k.telefon && `<div class="rap-row"><span class="l">Telefon</span><span class="v">${escHtml(k.telefon)}</span></div>`,
    k.data && `<div class="rap-row"><span class="l">Data</span><span class="v">${escHtml(k.data)}</span></div>`,
  ].filter(Boolean).join('');

  document.getElementById('raport-container').innerHTML = `
    <div class="card">
      <div style="margin-bottom:24px;padding-bottom:12px;border-bottom:1px dashed var(--border);display:flex;align-items:center;gap:14px">
        <img src="logo.png" alt="Logo" style="width:56px;height:56px;object-fit:contain;border-radius:6px;flex-shrink:0">
        <div style="color:var(--text2);font-size:0.85rem">
          <strong style="font-size:1rem;color:var(--text)">MB Ogrodzenia Maciej Bochyński</strong><br>
          Tel. 533 811 244
        </div>
      </div>

      ${klientHtml ? `
        <div class="rap-section">
          <div class="rap-title">Klient</div>
          ${klientHtml}
        </div>` : ''}

      <div class="rap-section">
        <div class="rap-title">Ogrodzenie</div>
        ${zestawyHtml || '<div class="empty-state" style="padding:12px">Brak zestawów.</div>'}
        ${stan.zestawy.length > 0 ? `
          <div class="rap-row" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
            <span class="l">Razem ogrodzenie</span>
            <span class="v">${formatZl(zaokr(sumaZestawow))}</span>
          </div>` : ''}
      </div>

      ${dod.pozycje.length > 0 ? `
        <div class="rap-section">
          <div class="rap-title">Usługi dodatkowe</div>
          ${dod.pozycje.map(p => `
            <div class="rap-row">
              <span class="l">${escHtml(p.nazwa)}</span>
              <span class="v">${formatZl(p.kwota)}</span>
            </div>`).join('')}
        </div>` : ''}

      ${stan.dodatki.uwagi ? `
        <div class="rap-section">
          <div class="rap-title">Uwagi</div>
          <div style="font-size:.88rem;color:var(--text2);white-space:pre-wrap">${escHtml(stan.dodatki.uwagi)}</div>
        </div>` : ''}

      ${stan.dodatki.korekta ? `
        <div class="rap-row" style="margin-top:6px; border-top:1px solid var(--border); padding-top:6px">
          <span class="l">Korekta ręczna (rabat / dopłata)</span>
          <span class="v">${formatZl(stan.dodatki.korekta)}</span>
        </div>` : ''}

      <div class="rap-total">
        <span class="l">RAZEM DO ZAPŁATY</span>
        <span class="v">${formatZl(total)}</span>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════
   AKTUALIZACJA SUMY
   ═══════════════════════════════════════════════ */
function aktualizujSume() {
  let sumaZestawow = 0;
  for (const z of stan.zestawy) {
    const obl = obliczZestaw(z);
    if (!obl.blad) sumaZestawow += obl.kRazem;
  }
  const total = zaokr(sumaZestawow + obliczDodatki().suma + (stan.dodatki.korekta || 0));
  document.getElementById('bottom-suma').textContent = formatZl(total);

  if (document.getElementById('content-podsumowanie').classList.contains('active')) {
    renderRaport();
  }
}

/* ═══════════════════════════════════════════════
   ZARZĄDZANIE STANEM (localStorage)
   ═══════════════════════════════════════════════ */
function zapiszDane() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stan));
  } catch (e) {
    console.warn('Błąd zapisu localStorage:', e);
  }
}

// Migracja danych z localStorage (stare wersje → bieżąca struktura)
function migrujDane(zapis) {
  // Migracja v1→v2: stary format cennika (panel_zl, slupek_zl…)
  if (zapis.cennik && 'panel_zl' in zapis.cennik) {
    const cSt = zapis.cennik;
    zapis.cennik = deepCopy(CENNIK_DOMYSLNY);
    zapis.cennik.typyPaneli[0].cena_zl = cSt.panel_zl?.wartosc ?? 150;
    zapis.cennik.typyPaneli[0].szerokosc_mm = zapis.ustawienia?.dlugoscPanelu_mm ?? 2500;
    zapis.cennik.typySlupkow[0].cena_zl = cSt.slupek_zl?.wartosc ?? 80;
    zapis.cennik.typySlupkow[0].szerokosc_mm = zapis.ustawienia?.szerokoscSlupka_mm ?? 40;
    if (cSt.robocizna_zl_mb) zapis.cennik.robocizna_zl_mb.wartosc = cSt.robocizna_zl_mb.wartosc;
    if (cSt.transport_zl) zapis.cennik.transport_zl.wartosc = cSt.transport_zl.wartosc;
    if (cSt.demontaz_zl_mb) zapis.cennik.demontaz_zl_mb.wartosc = cSt.demontaz_zl_mb.wartosc;
    if (cSt.brama_zl) zapis.cennik.typyBram[0].cena_zl = cSt.brama_zl.wartosc ?? 1200;
    if (cSt.furtka_zl) zapis.cennik.typyFurtek[0].cena_zl = cSt.furtka_zl.wartosc ?? 450;
  }

  // Migracja cennika: dodaj pozycjeDodatkowe jeśli brak
  if (!Array.isArray(zapis.cennik?.pozycjeDodatkowe)) {
    if (zapis.cennik) zapis.cennik.pozycjeDodatkowe = [];
  }

  // Migracja ustawień: usuń stare pola
  zapis.ustawienia = { jednostka: zapis.ustawienia?.jednostka || JEDNOSTKI.M };

  // Migracja dodatki: usuń brama/furtka (przeniesione do zestawów)
  const dod = zapis.dodatki || {};
  zapis.dodatki = {
    transport: { aktywny: false, kwota: null, ...(dod.transport || {}) },
    demontaz: { aktywny: false, mb: 0, ...(dod.demontaz || {}) },
    robocizna: { aktywny: true, ...(dod.robocizna || {}) },
    uwagi: dod.uwagi || '',
    korekta: dod.korekta || 0,
    dynamiczne: dod.dynamiczne || {},
  };

  // Migracja zestawów: dodaj typ panelu/słupka jeśli brakuje
  const defP = zapis.cennik.typyPaneli[0]?.id || 'p_std';
  const defS = zapis.cennik.typySlupkow[0]?.id || 's_std';
  zapis.zestawy = (zapis.zestawy || []).map(z => {
    const znorm = { typPaneluId: defP, typSlupkaId: defS, brama: null, furtka: null, ...z };
    // Migracja: dodaj typSlupkaId do wstawek jeśli brak (pole wprowadzone w v2.1)
    if (znorm.brama && znorm.brama.typSlupkaId === undefined)
      znorm.brama = { typSlupkaId: null, ...znorm.brama };
    if (znorm.furtka && znorm.furtka.typSlupkaId === undefined)
      znorm.furtka = { typSlupkaId: null, ...znorm.furtka };
    return znorm;
  });

  return zapis;
}

function wczytajDane() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const domyslny = nowyStanDomyslny();
    const zapis = migrujDane(JSON.parse(raw));

    // Merge z domyślnymi (zapewnia nowe pola w przyszłości)
    stan = {
      ...domyslny,
      ...zapis,
      klient: { ...domyslny.klient, ...zapis.klient },
    };
  } catch (e) {
    console.warn('Błąd odczytu localStorage:', e);
  }
}

function wczytajUI() {
  const k = stan.klient;
  const u = stan.ustawienia;
  const d = stan.dodatki;

  const sel = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

  sel('k-nazwa', k.nazwa);
  sel('k-adres', k.adres);
  sel('k-tel', k.telefon);
  sel('k-data', k.data);
  aktualizujGeoDisplay();

  document.getElementById('jed-m')?.classList.toggle('active', u.jednostka === 'm');
  document.getElementById('jed-mm')?.classList.toggle('active', u.jednostka === 'mm');
  document.getElementById('nowy-dl-label').textContent = `Długość (${u.jednostka})`;

  chk('d-transport', d.transport.aktywny);
  chk('d-demontaz', d.demontaz.aktywny);
  chk('d-robocizna', d.robocizna?.aktywny !== false);

  if (d.transport.kwota !== null) sel('d-transport-kwota', d.transport.kwota);
  sel('d-demontaz-mb', d.demontaz.mb || '');
  sel('d-uwagi', d.uwagi || '');
  sel('rap-korekta', d.korekta || '');

  document.getElementById('d-transport-extra').style.display = d.transport.aktywny ? 'block' : 'none';
  document.getElementById('d-demontaz-extra').style.display = d.demontaz.aktywny ? 'block' : 'none';

  odswiezSelecty();
  renderCennik();
  renderZestawy();
  renderDodatkiDynamiczne();
  aktualizujSume();
}

/* ═══════════════════════════════════════════════
   HANDLERY ZMIAN FORMULARZY
   ═══════════════════════════════════════════════ */
function onKlientChange() {
  stan.klient.nazwa = document.getElementById('k-nazwa')?.value || '';
  stan.klient.adres = document.getElementById('k-adres')?.value || '';
  stan.klient.telefon = document.getElementById('k-tel')?.value || '';
  stan.klient.data = document.getElementById('k-data')?.value || '';
  zapiszDane();
}

function aktualizujGeoDisplay() {
  const geo = stan.klient.geo;
  const display = document.getElementById('k-geo-display');
  const clear = document.getElementById('k-geo-clear');
  if (!display) return;
  if (geo) {
    const url = `https://www.google.com/maps?q=${geo.lat},${geo.lon}`;
    display.style.display = 'block';
    display.innerHTML = `📍 <a href="${url}" target="_blank" rel="noopener" style="color:var(--accent)">${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}</a>`;
    if (clear) clear.style.display = '';
  } else {
    display.style.display = 'none';
    if (clear) clear.style.display = 'none';
  }
}

function pobierzGeo() {
  if (!navigator.geolocation) {
    toast('Przeglądarka nie obsługuje geolokalizacji', true);
    return;
  }
  const btn = document.getElementById('k-geo-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Pobieranie…'; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      stan.klient.geo = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      zapiszDane();
      aktualizujGeoDisplay();
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Pobierz GPS'; }
      toast('Lokalizacja pobrana ✓');
    },
    err => {
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Pobierz GPS'; }
      const msg = err.code === 1 ? 'Brak zgody na lokalizację'
        : err.code === 2 ? 'Nie można ustalić lokalizacji'
          : 'Przekroczono czas oczekiwania';
      toast(msg, true);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function wyczyscGeo() {
  stan.klient.geo = null;
  zapiszDane();
  aktualizujGeoDisplay();
}


function onDodatkiChange() {
  const d = stan.dodatki;

  d.transport.aktywny = document.getElementById('d-transport')?.checked || false;
  d.transport.kwota = parseNum(document.getElementById('d-transport-kwota')?.value, null);
  d.demontaz.aktywny = document.getElementById('d-demontaz')?.checked || false;
  d.demontaz.mb = parseNum(document.getElementById('d-demontaz-mb')?.value, 0);
  if (!d.robocizna) d.robocizna = { aktywny: true };
  d.robocizna.aktywny = document.getElementById('d-robocizna')?.checked !== false;
  d.uwagi = document.getElementById('d-uwagi')?.value || '';

  document.getElementById('d-transport-extra').style.display = d.transport.aktywny ? 'block' : 'none';
  document.getElementById('d-demontaz-extra').style.display = d.demontaz.aktywny ? 'block' : 'none';

  zapiszDane();
  aktualizujSume();
}

function renderDodatkiDynamiczne() {
  const c = stan.cennik;
  const d = stan.dodatki;
  if (!d.dynamiczne) d.dynamiczne = {};

  const el = document.getElementById('d-dynamiczne-pozycje');
  if (!el) return;

  const pozycje = c.pozycjeDodatkowe || [];
  if (pozycje.length === 0) {
    el.innerHTML = '';
    return;
  }

  let html = '';
  for (const p of pozycje) {
    const mem = d.dynamiczne[p.id] || { aktywny: false, ilosc: 1 };
    d.dynamiczne[p.id] = mem;
    const isChecked = mem.aktywny ? 'checked' : '';
    const displayStyle = mem.aktywny ? 'block' : 'none';

    html += `
    <div class="toggle-row">
      <div>
        <div class="toggle-label">${escHtml(p.nazwa || 'Pozycja bez nazwy')}</div>
        <div class="toggle-desc">${formatZl(p.wartosc)} / ${escHtml(p.jednostka)}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="d-dyn-chk-${p.id}" onchange="onDodatkiDynamiczneChange('${p.id}')" ${isChecked}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div id="d-dyn-extra-${p.id}" style="display:${displayStyle};padding:12px 0 4px">
      <label>Ilość (${escHtml(p.jednostka)})</label>
      <input type="number" id="d-dyn-ilosc-${p.id}" value="${mem.ilosc}" min="0" step="0.1" oninput="onDodatkiDynamiczneChange('${p.id}')">
    </div>`;
  }
  el.innerHTML = html;
}

function onDodatkiDynamiczneChange(id) {
  const d = stan.dodatki;
  if (!d.dynamiczne) d.dynamiczne = {};
  if (!d.dynamiczne[id]) d.dynamiczne[id] = { aktywny: false, ilosc: 1 };

  const chk = document.getElementById(`d-dyn-chk-${id}`);
  const inp = document.getElementById(`d-dyn-ilosc-${id}`);

  d.dynamiczne[id].aktywny = chk ? chk.checked : false;
  d.dynamiczne[id].ilosc = inp ? parseNum(inp.value, 1) : 1;

  const extra = document.getElementById(`d-dyn-extra-${id}`);
  if (extra) {
    extra.style.display = d.dynamiczne[id].aktywny ? 'block' : 'none';
  }

  zapiszDane();
  aktualizujSume();
}

function onKorektaChange() {
  const el = document.getElementById('rap-korekta');
  if (el) {
    stan.dodatki.korekta = parseNum(el.value, 0);
    zapiszDane();
    aktualizujSume();
  }
}

function setJednostka(jed) {
  const staryJed = stan.ustawienia.jednostka;
  if (staryJed === jed) return;

  stan.ustawienia.jednostka = jed;
  document.getElementById('jed-m').classList.toggle('active', jed === 'm');
  document.getElementById('jed-mm').classList.toggle('active', jed === 'mm');
  document.getElementById('nowy-dl-label').textContent = `Długość (${jed})`;

  const przeliczWartosc = (elId) => {
    const el = document.getElementById(elId);
    if (el && el.value !== '') {
      const val = parseFloat(el.value.replace(',', '.'));
      if (!isNaN(val)) {
        el.value = jed === 'm' ? String(zaokr(val / 1000)) : String(Math.round(val * 1000));
      }
    }
  };

  przeliczWartosc('nowy-dl');
  przeliczWartosc('nowy-brama-odl');
  przeliczWartosc('nowy-furtka-odl');

  const odlLbl = `Odległość od strony (${jed})`;
  const odlStep = jed === 'mm' ? '100' : '0.01';
  const elBO = document.getElementById('nowy-brama-odl');
  const elFO = document.getElementById('nowy-furtka-odl');
  document.getElementById('nowy-brama-odl-label').textContent = odlLbl;
  document.getElementById('nowy-furtka-odl-label').textContent = odlLbl;
  if (elBO) elBO.step = odlStep;
  if (elFO) elFO.step = odlStep;
  zapiszDane();
  renderZestawy();
}

/* ═══════════════════════════════════════════════
   AKCJE – ZESTAWY
   ═══════════════════════════════════════════════ */
function dodajZestaw() {
  const nazwaEl = document.getElementById('nowy-nazwa');
  const dlEl = document.getElementById('nowy-dl');
  const errEl = document.getElementById('nowy-error');

  errEl.textContent = '';
  errEl.classList.remove('show');
  dlEl.classList.remove('error');

  const nazwa = nazwaEl.value.trim() || `Zestaw ${stan.zestawy.length + 1}`;
  const dlTekst = dlEl.value.trim();

  if (!dlTekst) {
    errEl.textContent = 'Podaj długość zestawu.';
    errEl.classList.add('show');
    dlEl.classList.add('error');
    return;
  }

  let dlugoscM = parseFloat(dlTekst.replace(',', '.'));
  if (isNaN(dlugoscM) || dlugoscM <= 0) {
    errEl.textContent = 'Długość musi być liczbą większą od 0.';
    errEl.classList.add('show');
    dlEl.classList.add('error');
    return;
  }

  if (stan.ustawienia.jednostka === 'mm') dlugoscM /= 1000;

  const typPaneluId = document.getElementById('nowy-typ-panelu')?.value || stan.cennik.typyPaneli[0]?.id;
  const typSlupkaId = document.getElementById('nowy-typ-slupka')?.value || stan.cennik.typySlupkow[0]?.id;

  const jed = stan.ustawienia.jednostka;

  const brama = czytajWstawke('nowy-brama', '', jed, 4000, _nowaBramaStrona);
  const furtka = czytajWstawke('nowy-furtka', '', jed, 1000, _nowaFurtkaStrona);

  const nowyZ = { id: 'z' + Date.now(), nazwa, dlugoscM, typPaneluId, typSlupkaId, brama, furtka };
  const obl = obliczZestaw(nowyZ);
  if (obl.blad) {
    errEl.textContent = obl.blad;
    errEl.classList.add('show');
    return;
  }

  stan.zestawy.push(nowyZ);
  nazwaEl.value = '';
  dlEl.value = '';
  const bt = document.getElementById('nowy-brama-typ');
  const ft = document.getElementById('nowy-furtka-typ');
  if (bt) { bt.value = ''; onNowaBramaTypChange(); }
  if (ft) { ft.value = ''; onNowaFurtkaTypChange(); }

  zapiszDane();
  renderZestawy();
  aktualizujSume();
  toast(`Dodano: ${nazwa}`);
}

function usunZestaw(id) {
  stan.zestawy = stan.zestawy.filter(z => z.id !== id);
  if (idEdytowanego === id) idEdytowanego = null;
  zapiszDane();
  renderZestawy();
  aktualizujSume();
  toast('Zestaw usunięty');
}

function rozpocznijEdycje(id) {
  idEdytowanego = id;
  renderZestawy();
  const input = document.getElementById(`edit-dl-${id}`);
  if (input) { input.focus(); input.select(); }
}

function zapiszEdycje(id) {
  const input = document.getElementById(`edit-dl-${id}`);
  if (!input) return;

  let nowa = parseFloat(input.value.replace(',', '.'));
  if (isNaN(nowa) || nowa <= 0) { toast('Nieprawidłowa wartość', true); return; }
  if (stan.ustawienia.jednostka === 'mm') nowa /= 1000;

  const z = stan.zestawy.find(z => z.id === id);
  if (!z) return;

  const noweTypPanelu = document.getElementById(`edit-typ-panelu-${id}`)?.value || z.typPaneluId;
  const noweTypSlupka = document.getElementById(`edit-typ-slupka-${id}`)?.value || z.typSlupkaId;

  const jedE = stan.ustawienia.jednostka;

  const brama = czytajWstawke('edit-brama', `-${id}`, jedE, 4000);
  const furtka = czytajWstawke('edit-furtka', `-${id}`, jedE, 1000);

  const tmpZ = { ...z, dlugoscM: nowa, typPaneluId: noweTypPanelu, typSlupkaId: noweTypSlupka, brama, furtka };
  const obl = obliczZestaw(tmpZ);
  if (obl.blad) { toast(obl.blad, true); return; }

  z.dlugoscM = nowa;
  z.typPaneluId = noweTypPanelu;
  z.typSlupkaId = noweTypSlupka;
  z.brama = brama;
  z.furtka = furtka;
  const nazwaInput = document.getElementById(`edit-nazwa-${id}`);
  if (nazwaInput) z.nazwa = nazwaInput.value.trim() || z.nazwa;

  idEdytowanego = null;
  zapiszDane();
  renderZestawy();
  aktualizujSume();
}

function anulujEdycje() {
  idEdytowanego = null;
  renderZestawy();
}

/* ═══════════════════════════════════════════════
   AKCJE – CENNIK
   ═══════════════════════════════════════════════ */
function walidujCennikInput(el) {
  const v = parseFloat(el.value);
  el.style.borderColor = (isNaN(v) || v < 0) ? 'var(--red)' : '';
}

function zapiszCennik(el) {
  const klucz = el.dataset.klucz;
  const v = parseFloat(el.value);
  if (isNaN(v) || v < 0) {
    toast('Nieprawidłowa cena', true);
    el.value = stan.cennik[klucz].wartosc;
    return;
  }
  stan.cennik[klucz].wartosc = v;
  zapiszDane();
  renderZestawy();
  aktualizujSume();
}

function resetCennika() {
  if (!confirm('Przywrócić domyślne ceny? Twoje zmiany zostaną utracone.')) return;
  stan.cennik = deepCopy(CENNIK_DOMYSLNY);
  zapiszDane();
  renderCennik();
  renderZestawy();
  aktualizujSume();
  toast('Cennik przywrócony do domyślnych');
}

async function eksportCennik() {
  let domyslnaNazwa = `cennik_ogr_${dzisiaj().replace(/-/g, '')}.json`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: domyslnaNazwa,
        types: [{
          description: 'Plik cennika JSON',
          accept: { 'application/json': ['.json'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(stan.cennik, null, 2));
      await writable.close();
      toast('Cennik wyeksportowany pomyślnie');
      return;
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Błąd File System API:', e);
        pobierzJSON(stan.cennik, domyslnaNazwa);
      }
      return; // w przypadku AbortError lub po fallbacku - kończymy
    }
  }

  // Fallback
  pobierzJSON(stan.cennik, domyslnaNazwa);
}

function importCennik(event) {
  const plik = event.target.files[0];
  if (!plik) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const dane = JSON.parse(e.target.result);
      for (const k of Object.keys(CENNIK_DOMYSLNY)) {
        if (Array.isArray(CENNIK_DOMYSLNY[k])) {
          if (!Array.isArray(dane[k])) dane[k] = deepCopy(CENNIK_DOMYSLNY[k]);
          continue;
        }
        if (!(k in dane)) throw new Error(`Brak klucza: ${k}`);
        if (typeof dane[k].wartosc !== 'number' || dane[k].wartosc < 0)
          throw new Error(`Nieprawidłowa wartość: ${k}`);
      }
      stan.cennik = dane;
      zapiszDane();
      renderCennik();
      renderZestawy();
      aktualizujSume();
      toast('Cennik wczytany');
    } catch (err) {
      toast('Błąd importu: ' + err.message, true);
    }
    event.target.value = '';
  };
  reader.readAsText(plik);
}

/* ═══════════════════════════════════════════════
   AKCJE – WYCENA
   ═══════════════════════════════════════════════ */
function nowaWycena() {
  if (!confirm('Rozpocząć nową wycenę? Bieżące dane zostaną usunięte.')) return;
  stan = nowyStanDomyslny();
  idEdytowanego = null;
  localStorage.removeItem(STORAGE_KEY);
  wczytajUI();
  showTab('klient');
  toast('Nowa wycena rozpoczęta');
}

/* ═══════════════════════════════════════════════
   RAPORT KOMPAKTOWY – tabela zbiorcza materiałów
   ═══════════════════════════════════════════════ */
function renderRaportKompaktowy() {
  const k = stan.klient;
  const dod = obliczDodatki();

  // Agregacja materiałów ze wszystkich zestawów
  const panele = new Map();
  const slupki = new Map();
  const bramy  = new Map();
  const furtki = new Map();
  let totalObejm = 0, kObejmy = 0;
  let totalMb = 0, kRobociz = 0;
  let sumaZestawow = 0;

  function dodaj(mapa, typ, ilosc, koszt) {
    if (!mapa.has(typ.id)) mapa.set(typ.id, { typ, ilosc: 0, koszt: 0 });
    const e = mapa.get(typ.id);
    e.ilosc += ilosc;
    e.koszt = zaokr(e.koszt + koszt);
  }

  for (const z of stan.zestawy) {
    const obl = obliczZestaw(z);
    if (obl.blad) continue;
    totalMb = zaokr(totalMb + z.dlugoscM);
    kRobociz = zaokr(kRobociz + obl.kRobociz);
    sumaZestawow = zaokr(sumaZestawow + obl.kRazem);
    for (const seg of obl.segmenty) {
      totalObejm += seg.nObejm;
      kObejmy = zaokr(kObejmy + seg.kObejmy);
      if (seg.typ === 'ogr') {
        dodaj(panele, obl.typPanel, seg.nPaneli, seg.kPanel);
        if (seg.nSlupkow > 0) dodaj(slupki, obl.typSlupek, seg.nSlupkow, seg.kSlupki);
      } else {
        const typBF = (seg.typ === 'brama'
          ? stan.cennik.typyBram.find(t => t.id === seg.el.typId)
          : stan.cennik.typyFurtek.find(t => t.id === seg.el.typId))
          || { id: seg.el.typId, nazwa: seg.typ === 'brama' ? 'Brama' : 'Furtka' };
        if (seg.typ === 'brama') dodaj(bramy, typBF, 1, seg.kBF);
        else dodaj(furtki, typBF, 1, seg.kBF);
        if (seg.nSlupkow > 0) dodaj(slupki, seg.typSlupek, seg.nSlupkow, seg.kSlupki);
      }
    }
  }

  const total = zaokr(sumaZestawow + dod.suma + (stan.dodatki.korekta || 0));

  // Pomocniki do budowania tabeli
  const trGrupa = (label) =>
    `<tr class="ztab-group"><td colspan="4">${escHtml(label)}</td></tr>`;

  const trWiersz = (nazwa, ilosc, cenaJedn, koszt) =>
    `<tr>
      <td>${escHtml(nazwa)}</td>
      <td class="num">${ilosc}</td>
      <td class="num">${cenaJedn}</td>
      <td class="num">${formatZl(koszt)}</td>
    </tr>`;

  const sekcja = (label, mapa, formatIlosc, formatCena) => {
    if (!mapa.size) return '';
    return trGrupa(label) +
      [...mapa.values()].map(e => trWiersz(
        e.typ.nazwa, formatIlosc(e), formatCena(e), e.koszt
      )).join('');
  };

  const cenaPanelu = (e) => e.ilosc > 0 ? formatZl(zaokr(e.koszt / e.ilosc)) : '—';
  const cenaSlupka = (e) => e.ilosc > 0 ? formatZl(zaokr(e.koszt / e.ilosc)) : '—';

  // Dane klienta
  const geoUrl = k.geo ? `https://www.google.com/maps?q=${k.geo.lat},${k.geo.lon}` : null;
  const klientLinie = [
    k.nazwa && `<strong>${escHtml(k.nazwa)}</strong>`,
    k.adres && escHtml(k.adres),
    k.telefon && `tel. ${escHtml(k.telefon)}`,
    k.geo && `<a href="${geoUrl}" target="_blank" rel="noopener" style="color:var(--accent)">${k.geo.lat.toFixed(5)}, ${k.geo.lon.toFixed(5)}</a>`,
    k.data && `Data: ${escHtml(k.data)}`,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  document.getElementById('raport-container').innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;
                  padding-bottom:12px;margin-bottom:16px;border-bottom:2px solid var(--accent)">
        <div>
          <div style="font-size:1rem;font-weight:700;color:var(--accent)">ZESTAWIENIE MATERIAŁÓW</div>
          <div style="font-size:.78rem;color:var(--text3);margin-top:2px">
            ${stan.zestawy.length} odcinek(-ów) · ${formatN(totalMb, 2)} mb łącznie
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <div style="text-align:right;font-size:.8rem;color:var(--text2)">
            <strong>MB Ogrodzenia Maciej Bochyński</strong><br>Tel. 533 811 244
          </div>
          <img src="logo.png" alt="Logo" style="width:48px;height:48px;object-fit:contain;border-radius:6px">
        </div>
      </div>

      ${klientLinie ? `<div style="font-size:.84rem;color:var(--text2);margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)">${klientLinie}</div>` : ''}

      <table class="ztab">
        <thead>
          <tr>
            <th>Element</th>
            <th class="num">Ilość</th>
            <th class="num">Cena jedn.</th>
            <th class="num">Razem</th>
          </tr>
        </thead>
        <tbody>
          ${sekcja('Panele', panele,
              e => `${e.ilosc} szt.`, cenaPanelu)}
          ${sekcja('Słupki', slupki,
              e => `${e.ilosc} szt.`, cenaSlupka)}
          ${sekcja('Bramy', bramy,
              e => `${e.ilosc} szt.`, e => '—')}
          ${sekcja('Furtki', furtki,
              e => `${e.ilosc} szt.`, e => '—')}
          ${trGrupa('Montaż')}
          ${trWiersz('Obejmy', `${totalObejm} szt.`,
              formatZl(stan.cennik.obejma_zl.wartosc), kObejmy)}
          ${kRobociz ? trWiersz(`Robocizna`, `${formatN(totalMb, 2)} mb`,
              formatZl(stan.cennik.robocizna_zl_mb.wartosc) + '/mb', kRobociz) : ''}
        </tbody>
        <tfoot>
          <tr class="ztab-sub-total">
            <td colspan="3">Ogrodzenie razem</td>
            <td class="num">${formatZl(sumaZestawow)}</td>
          </tr>
          ${dod.pozycje.map(p =>
            `<tr><td colspan="3">${escHtml(p.nazwa)}</td><td class="num">${formatZl(p.kwota)}</td></tr>`
          ).join('')}
          ${stan.dodatki.korekta ? `<tr><td colspan="3">Korekta ręczna</td><td class="num">${formatZl(stan.dodatki.korekta)}</td></tr>` : ''}
          <tr class="ztab-total">
            <td colspan="3">RAZEM DO ZAPŁATY</td>
            <td class="num">${formatZl(total)}</td>
          </tr>
        </tfoot>
      </table>

      ${stan.dodatki.uwagi ? `
        <div style="margin-top:12px;font-size:.84rem;color:var(--text2)">
          <strong>Uwagi:</strong><br>
          <span style="white-space:pre-wrap">${escHtml(stan.dodatki.uwagi)}</span>
        </div>` : ''}
    </div>`;
}

function drukujSzczegolowy() {
  renderRaport();
  showTab('podsumowanie');
  window.print();
}

function drukujKompaktowy() {
  showTab('podsumowanie');       // wywołuje renderRaport() wewnętrznie
  renderRaportKompaktowy();      // nadpisuje szczegółowy – musi być po showTab
  window.print();
}

function kopiujSMS() {
  const k = stan.klient;
  const dod = obliczDodatki();
  let sumaZ = 0;

  let tekst = 'OgrodzeniePRO – Wycena\n';
  if (k.data) tekst += `Data: ${k.data}\n`;
  if (k.nazwa) tekst += `Klient: ${k.nazwa}\n`;
  if (k.adres) tekst += `Adres: ${k.adres}\n`;
  if (k.geo) tekst += `GPS: ${k.geo.lat.toFixed(6)}, ${k.geo.lon.toFixed(6)}\n       https://www.google.com/maps?q=${k.geo.lat},${k.geo.lon}\n`;

  tekst += '\n--- Ogrodzenie ---\n';
  for (const [i, z] of stan.zestawy.entries()) {
    const obl = obliczZestaw(z);
    if (obl.blad) continue;
    sumaZ += obl.kRazem;
    const dl = stan.ustawienia.jednostka === 'm'
      ? formatN(z.dlugoscM, 3) + ' m'
      : obl.dlugoscMM + ' mm';
    tekst += `${i + 1}. ${z.nazwa} (${dl}): ${formatZl(obl.kRazem)}\n`;
    let segIdx2 = 0;
    for (const seg of obl.segmenty) {
      if (seg.typ === 'ogr') {
        segIdx2++;
        const sdl2 = stan.ustawienia.jednostka === 'm'
          ? formatN(seg.dlugoscMM / 1000, 3) + 'm' : seg.dlugoscMM + 'mm';
        tekst += `   Odcinek ${segIdx2} (${sdl2}): ${seg.nPaneli} paneli, ${seg.nSlupkow} słupków`;
        if (seg.maRestke) tekst += `, reszta ${seg.resztaMM} mm`;
        tekst += '\n';
      } else {
        const nazwaW = seg.typ === 'brama' ? 'Brama' : 'Furtka';
        tekst += `   ${nazwaW}: ${seg.szerokosc_mm}mm, 2 słupki, ${formatZl(seg.kRazem)}\n`;
      }
    }
    tekst += `   Obejmy łącznie: ${obl.nObejm}\n`;
  }

  if (dod.pozycje.length > 0) {
    tekst += '\n--- Dodatki ---\n';
    for (const p of dod.pozycje) tekst += `${p.nazwa}: ${formatZl(p.kwota)}\n`;
  }

  if (stan.dodatki.uwagi) tekst += `\nUwagi: ${stan.dodatki.uwagi}\n`;
  if (stan.dodatki.korekta) tekst += `\nKorekta ceny: ${formatZl(stan.dodatki.korekta)}`;
  tekst += `\nRAZEM: ${formatZl(zaokr(sumaZ + dod.suma + (stan.dodatki.korekta || 0)))}`;
  tekst += `\n\nWykonawca:\nMB Ogrodzenia Maciej Bochyński\nTel. 533 811 244`;

  if (navigator.share) {
    navigator.share({ title: 'OgrodzeniePRO – Wycena', text: tekst })
      .catch(err => { if (err.name !== 'AbortError') pokazTekstDoSkopiowania(tekst); });
  } else if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(tekst)
      .then(() => toast('Skopiowano do schowka'))
      .catch(() => pokazTekstDoSkopiowania(tekst));
  } else {
    pokazTekstDoSkopiowania(tekst);
  }
}

function pokazTekstDoSkopiowania(tekst) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-box">
      <div class="overlay-title">Skopiuj wycenę</div>
      <div class="overlay-hint">Zaznacz wszystko (Ctrl+A) i skopiuj (Ctrl+C)</div>
      <textarea readonly>${escHtml(tekst)}</textarea>
      <button class="btn btn-primary btn-full" style="margin-top:12px"
              onclick="this.closest('.overlay').remove()">Zamknij</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('textarea').select();
}

async function eksportujWycene() {
  let nazwaKlienta = stan.klient && stan.klient.nazwa ? stan.klient.nazwa.trim() : '';
  let czystaNazwa = nazwaKlienta.replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ_\- ]/g, '').replace(/\s+/g, '_');
  if (!czystaNazwa) czystaNazwa = 'wycena';

  let domyslnaNazwa = `${czystaNazwa}_${dzisiaj().replace(/-/g, '')}.json`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: domyslnaNazwa,
        types: [{
          description: 'Plik wyceny JSON',
          accept: { 'application/json': ['.json'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(stan, null, 2));
      await writable.close();
      toast('Wycena zapisana pomyślnie');
      return;
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Błąd File System API:', e);
        pobierzJSON(stan, domyslnaNazwa);
      }
      return; // w przypadku AbortError lub po fallbacku - kończymy
    }
  }

  // Fallback np. dla Firefox / Safari / HTTP
  pobierzJSON(stan, domyslnaNazwa);
}

function importujWycene(event) {
  const plik = event.target.files[0];
  if (!plik) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const dane = JSON.parse(e.target.result);
      if (!dane.zestawy || !dane.cennik || !dane.dodatki)
        throw new Error('Nieprawidłowy plik wyceny.');

      // Zapisujemy nowy plik do localStorage, a następnie uruchamiamy wczytajDane()
      // aby w razie starego pliku wykonała się poprawnie migracja do nowej wersji struktury
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dane));
      wczytajDane();

      idEdytowanego = null;
      wczytajUI();
      toast('Wycena wczytana');
    } catch (err) {
      toast('Błąd importu: ' + err.message, true);
    }
    event.target.value = '';
  };
  reader.readAsText(plik);
}

/* ═══════════════════════════════════════════════
   NAWIGACJA
   ═══════════════════════════════════════════════ */
function showTab(id) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('content-' + id)?.classList.add('active');
  document.getElementById('tab-' + id)?.classList.add('active');
  if (id === 'podsumowanie') renderRaport();
}

/* ═══════════════════════════════════════════════
   PWA
   ═══════════════════════════════════════════════ */
function inicjalizujPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.warn('[SW] Błąd rejestracji:', err));
  }

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('pwaInstallBtn').style.display = 'block';
  });

  document.getElementById('pwaInstallBtn').addEventListener('click', () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      document.getElementById('pwaInstallBtn').style.display = 'none';
      deferredPrompt = null;
    });
  });
}

/* ═══════════════════════════════════════════════
   START
   ═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  wczytajDane();
  wczytajUI();
  inicjalizujPWA();

  // Wymuszenie wygodniejszej, dziesiętnej klawiatury dla pół "number" na iOS / Android
  document.addEventListener('focusin', e => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number' && !e.target.hasAttribute('inputmode')) {
      e.target.setAttribute('inputmode', 'decimal');
    }
  });
});
