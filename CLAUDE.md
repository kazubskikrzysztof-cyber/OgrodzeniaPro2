# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projekt

OgrodzeniePRO_V2 to **Progressive Web App (PWA)** do wyceny montażu ogrodzeń. Aplikacja działa w 100% offline, bez backendu, frameworka ani procesu build. Targetem są monterzy w terenie (firma Maciej Bochyński).

Stack: Vanilla JS + CSS3 + HTML5. Bez npm, bez bundlera, bez zależności zewnętrznych.

## Uruchamianie

Otwórz `index.html` bezpośrednio w przeglądarce lub przez lokalny serwer HTTP (wymagany dla Service Workera):

```bash
python -m http.server 8080
# lub
npx serve .
```

Brak testów, lintowania ani procesu budowania.

## Architektura

Trzy główne pliki:

- **`index.html`** – struktura SPA: 5 zakładek (Klient, Zestawy, Dodatki, Cennik, Podsumowanie) + dolny pasek z sumą
- **`app.js`** – cała logika aplikacji (1900 linii), jeden plik, brak modułów
- **`styles.css`** – style + zmienne CSS + `@media print` dla PDF

### Stan aplikacji (`stan`)

Globalny obiekt `stan` przechowywany w `localStorage` (klucz `STORAGE_KEY`):

```js
stan = {
  klient,       // dane klienta (nazwa, adres, telefon, GPS)
  ustawienia,   // jednostki (m/mm)
  zestawy,      // tablica sekcji ogrodzenia
  dodatki,      // usługi dodatkowe (robocizna, transport, rozbiórka)
  cennik        // aktualna cennik (nadpisuje CENNIK_DOMYSLNY)
}
```

Każda zmiana → `zapiszDane()` → `wczytajUI()`.

### Silnik kalkulacji

Hierarchia obliczeń:
1. `obliczFenceSegment(dlugosc, typPanel, typSlupek, cennik)` – oblicza panele, słupki, klamry dla jednego odcinka
2. `obliczZestaw(zestaw, cennik)` – cały zestaw z bramą/furtką, współdzielenie słupka granicznego
3. `obliczDodatki(stan)` – usługi dodatkowe
4. Agregacja w `renderRaport()` / `aktualizujSume()`

### Ważne szczegóły implementacyjne

- **Współdzielenie słupka** – gdy brama/furtka stoi na granicy sekcji, słupek jest liczony raz (logika w `obliczZestaw`)
- **Migracja danych** – `migrujDane()` obsługuje zmiany schematu między wersjami; przy dodaniu nowych pól do `stan` trzeba tu dodać migrację
- **PDF export** – realizowany przez `window.print()` z CSS `@media print`; dwa tryby: `drukujSzczegolowy()` i `drukujKompaktowy()`. Kompaktowy wymaga wywołania `showTab('podsumowanie')` przed drukiem (render po pokazaniu zakładki)
- **SVG diagram** – `generujSVG()` tworzy wizualizację ogrodzenia na podstawie zestawów
- **Service Worker** (`sw.js`) – cache-first, wersja cache w stałej `CACHE_NAME`; przy zmianie plików statycznych trzeba podbić wersję

### Przepływ UI

Zakładki przełączane przez `showTab(id)`. Każda zakładka renderuje się przez dedykowaną funkcję (`renderZestawy`, `renderCennik`, `renderRaport`). Formularze klienta i dodatków używają `oninput`/`onchange` → `onKlientChange()` / `onDodatkiChange()`.

### Cennik

`CENNIK_DOMYSLNY` (stała) = dane fabryczne. `stan.cennik` = aktualny (może być zmodyfikowany). Import/export JSON przez `importCennik()` / `eksportCennik()`. Reset przez `resetCennika()`.
