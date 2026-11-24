/**
 * Planner – werkuren, studie, sportschool en gamen.
 * Draait als Google Apps Script-webapp; alle gegevens staan in deze spreadsheet.
 *
 * Eenmalig: voer de functie `installeer` uit (zet de tabbladen klaar). Daarna:
 * Implementeren > Nieuwe implementatie > Web-app (Uitvoeren als: ik, Toegang: alleen ikzelf).
 */

// Versie van dit script: zie je in de app bij ⚙︎ → Versie. Verhoog bij elke wijziging.
const SERVER_VERSIE = '2026.11.24-1';

const TABS = {
  Diensten:     ['id', 'datum', 'begin', 'eind', 'pauze', 'waar', 'toeslag', 'status', 'opmerking', 'eventId', 'agendaId'],
  Dagen:        ['datum', 'gamen', 'sport', 'notitie', 'coderen', 'slaap', 'bedtijd', 'opstaan'],
  Studie:       ['id', 'datum', 'vak', 'uren'],
  Vakken:       ['vak', 'weekdoel'],
  Reflectie:    ['week', 'goed', 'beter', 'focus'],
  Maanddoelen:  ['maand', 'doel', 'minimum'],
  Tentamens:    ['id', 'datum', 'tijd', 'vak', 'opmerking'],
  Deadlines:    ['id', 'datum', 'tijd', 'vak', 'wat', 'klaar'],
  Instellingen: ['sleutel', 'waarde'],
  // schoolvakanties en uitjes. soort: vakantie / zomer / uitje. vertrek en terug (uu:mm) alleen bij uitjes, mogen leeg.
  Periodes:     ['id', 'soort', 'naam', 'van', 'tot', 'vertrek', 'terug'],
  // vak dat (tijdelijk) klaar is: van t/m tot (yyyy-mm-dd). id = vak|van
  Klaar:        ['id', 'vak', 'van', 'tot'],
  // weekoverzicht zoals de app hem berekent (tekst van "Kopieer weekoverzicht"), voor het script op de pc. week = maandag
  Weekoverzicht: ['week', 'tekst', 'bijgewerkt'],
};
const PERIODE_SOORTEN = ['vakantie', 'zomer', 'uitje'];

// Standaardwaarden voor een nieuwe installatie. Bewust algemeen: persoonlijke namen (werk, agenda's)
// vul je zelf in bij ⚙︎ en staan alleen in je eigen sheet.
const STANDAARD = {
  sportDoel: 4, verdienPer: 2, gameMax: 8, codeerDoel: 1.5, slaapDoel: 7.5,
  maandDoel: 60, maandMinimum: 40, grens1: 0, grens2: 0,
  loonBasis: 0, loon1: 0, loon2: 0,
  pauzeVanaf: 5.5, pauzeMin: 30,
  werkNaam: 'Werk', lesAgenda: '', dienstenInAgenda: 'nee', werkImport: 'uit', werkAgenda: '', werkTitelWeg: '',
  vrijeAvonden: '',
  herinneringen: 'uit', herinnerTijden: 'ma=21:30;di=21:30;wo=21:30;do=21:30;vr=21:30;za=21:30;zo=21:00',
  ochtendTijd: '10:00', reflectieDag: 'zo', reflectieTijd: '20:00', overslaanBijAfspraak: 'ja',
  deadlineDagen: 2, deadlineTijd: '18:00', deadlineDagTijd: '09:00',
  toetsweekDagen: 14, toetsweekStudie: 20, toetsweekGameMax: 4, toetsweekAandeel: 60,
  schoolUren: 40, maxPerDag: 10, maxStudieDag: 5, weekendModus: 'licht', weekendProcent: 50, trillen: 'aan', gameMelding: 'aan',
  vakantieStudie: 5, vakantieGameDag: 3, vakantieWerkExtra: 0,
  dagStart: '08:00', dagEind: '23:00',
};
const TEKST = ['werkNaam', 'lesAgenda', 'dienstenInAgenda', 'werkImport', 'werkAgenda', 'werkTitelWeg', 'vrijeAvonden',
               'herinneringen', 'herinnerTijden', 'ochtendTijd',
               'reflectieDag', 'reflectieTijd', 'overslaanBijAfspraak', 'deadlineTijd', 'deadlineDagTijd', 'dagStart', 'dagEind',
               'weekendModus', 'trillen', 'gameMelding'];
// Functies die de losse app (GitHub) mag aanroepen
const API_FUNCTIES = ['haalAlles', 'haalLessen', 'bewaarDag', 'bewaarDienst', 'verwijderDienst', 'bewaarReflectie',
  'bewaarMaanddoel', 'bewaarTentamen', 'bewaarTentamens', 'verwijderTentamen', 'bewaarInstellingen', 'startTimer', 'stopTimer',
  'annuleerTimer', 'pauzeerTimer', 'hervatTimer', 'herinnerPlan', 'synchroniseerWerk', 'bewaarDeadline', 'bewaarDeadlines', 'verwijderDeadline',
  'bewaarPeriode', 'bewaarPeriodes', 'verwijderPeriode', 'bewaarKlaar', 'verwijderKlaar',
  'bewaarWeekoverzicht', 'haalWeekoverzichten'];
const WD = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const WD_LANG = { ma: 'maandag', di: 'dinsdag', wo: 'woensdag', do: 'donderdag', vr: 'vrijdag', za: 'zaterdag', zo: 'zondag' };

// ---------- webapp ----------

function doGet(e) {
  if (e && e.parameter && e.parameter.ping) return json_({ ok: true, data: 'Planner' });
  zorgVoorTabs_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Planner')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// ---------- API voor de losse app ----------

/**
 * De app op GitHub praat via POST met dit script: { sleutel, fn, args }.
 * Zonder de juiste geheime sleutel krijg je niets.
 */
function doPost(e) {
  try {
    const verzoek = JSON.parse(e.postData.contents);
    const sleutel = PropertiesService.getScriptProperties().getProperty('apiSleutel');
    if (!sleutel || verzoek.sleutel !== sleutel) return json_({ ok: false, fout: 'Verkeerde sleutel' });
    if (!API_FUNCTIES.includes(verzoek.fn)) return json_({ ok: false, fout: 'Onbekende functie' });
    zorgVoorTabs_();
    const data = globalThis[verzoek.fn].apply(null, verzoek.args || []);
    return json_({ ok: true, data });
  } catch (err) {
    return json_({ ok: false, fout: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Eenmalig uitvoeren in de editor: maakt een (nieuwe) geheime sleutel voor de app en toont hem in het logboek. */
function maakSleutel() {
  const sleutel = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('apiSleutel', sleutel);
  Logger.log('Je geheime sleutel (kopieer hem naar de app): ' + sleutel);
  return sleutel;
}

/**
 * Maakt tabbladen en kolommen aan die in een nieuwere versie zijn bijgekomen (bestaande gegevens blijven staan).
 * Dit hoeft maar één keer per scriptversie: daarna onthoudt het script dat het al gecontroleerd is,
 * zodat niet elk verzoek alle tabbladen hoeft te lezen. Tabblad per ongeluk weggegooid? Voer dan
 * `controleerTabs` uit in de editor.
 */
function zorgVoorTabs_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('tabsGecontroleerd') === SERVER_VERSIE) return;
  const ss = SpreadsheetApp.getActive();
  Object.keys(TABS).forEach(naam => {
    const bestaand = ss.getSheetByName(naam);
    if (bestaand) {
      // nieuwe kolommen (bijv. coderen, slaap) achteraan in de kopregel zetten
      const kop = bestaand.getRange(1, 1, 1, TABS[naam].length).getValues()[0];
      if (TABS[naam].some((k, i) => String(kop[i]) !== k))
        bestaand.getRange(1, 1, 1, TABS[naam].length).setValues([TABS[naam]]).setFontWeight('bold');
      return;
    }
    const sh = ss.insertSheet(naam);
    sh.getRange(1, 1, 1, TABS[naam].length).setValues([TABS[naam]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@');
  });
  props.setProperty('tabsGecontroleerd', SERVER_VERSIE);
}

// ---------- installatie ----------

function installeer() {
  const ss = SpreadsheetApp.getActive();
  const bestaand = ss.getSheetByName('Instellingen');
  if (bestaand && bestaand.getLastRow() > 1) {
    throw new Error('De planner is al geïnstalleerd. Opnieuw installeren zou alles wissen, dus dat doe ik niet.');
  }
  Object.keys(TABS).forEach(naam => {
    let sh = ss.getSheetByName(naam);
    if (!sh) sh = ss.insertSheet(naam);
    sh.clear();
    sh.getRange(1, 1, 1, TABS[naam].length).setValues([TABS[naam]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@'); // alles als tekst: geen datum-/tijdzone-gedoe
  });
  const leeg = ss.getSheetByName('Blad1') || ss.getSheetByName('Sheet1');
  if (leeg && ss.getSheets().length > 1) ss.deleteSheet(leeg);

  const rows = Object.keys(STANDAARD).map(k => [k, String(STANDAARD[k])]);
  ss.getSheetByName('Instellingen').getRange(2, 1, rows.length, 2).setValues(rows);

  importeerWerk_();
  zetTrigger_();
  PropertiesService.getScriptProperties().setProperty('tabsGecontroleerd', SERVER_VERSIE);
  return 'Klaar';
}

// ---------- lezen ----------

function haalAlles() {
  return {
    diensten: lees_('Diensten').map(d => Object.assign(d, {
      pauze: Number(d.pauze) || 0, toeslag: Number(d.toeslag) || 100 })),
    dagen: lees_('Dagen').map(d => Object.assign(d, { gamen: Number(d.gamen) || 0, sport: d.sport === 'ja',
                                                      coderen: Number(d.coderen) || 0, slaap: Number(d.slaap) || 0,
                                                      bedtijd: d.bedtijd || '', opstaan: d.opstaan || '' })),
    studie: lees_('Studie').map(x => Object.assign(x, { uren: Number(x.uren) || 0 })),
    vakken: lees_('Vakken').map(v => ({ vak: v.vak, weekdoel: Number(v.weekdoel) || 0 })),
    timer: timer_(),
    reflecties: lees_('Reflectie'),
    maanddoelen: lees_('Maanddoelen').map(m => Object.assign(m, {
      doel: Number(m.doel) || 0, minimum: Number(m.minimum) || 0 })),
    tentamens: lees_('Tentamens'),
    deadlines: lees_('Deadlines').map(d => Object.assign(d, { klaar: d.klaar === 'ja' })),
    periodes: lees_('Periodes'),
    klaar: lees_('Klaar'),
    instellingen: instellingen_(),
    versie: SERVER_VERSIE,
  };
}

/** Lessen uit je lesrooster-agenda (naam bij ⚙︎) tussen twee datums (yyyy-mm-dd, inclusief). */
function haalLessen(van, tot) {
  const naam = instellingen_().lesAgenda;
  if (!naam) return { fout: 'Nog geen lesrooster-agenda ingesteld. Vul de naam in bij ⚙︎.' };
  const cal = CalendarApp.getCalendarsByName(naam)[0];
  if (!cal) return { fout: 'Agenda "' + naam + '" niet gevonden. Pas de naam aan bij ⚙︎.' };
  const tz = Session.getScriptTimeZone();
  const ev = cal.getEvents(datum_(van), new Date(datum_(tot).getTime() + 864e5))
    .filter(e => !e.isAllDayEvent());
  return { lessen: ev.map(e => ({
    datum: Utilities.formatDate(e.getStartTime(), tz, 'yyyy-MM-dd'),
    begin: Utilities.formatDate(e.getStartTime(), tz, 'HH:mm'),
    eind: Utilities.formatDate(e.getEndTime(), tz, 'HH:mm'),
    titel: e.getTitle(),
    uren: (e.getEndTime().getTime() - e.getStartTime().getTime()) / 36e5,
  })) };
}

function lees_(tab) {
  const v = blad_(tab).getDataRange().getValues();
  const kop = v.shift();
  const tz = Session.getScriptTimeZone();
  return v.filter(r => r[0] !== '').map(r => {
    const o = {};
    // Sheets maakt van "23:59" soms een tijdwaarde (Date in 1899): die terugzetten naar uu:mm
    const TIJD = ['begin', 'eind', 'tijd', 'bedtijd', 'opstaan', 'deadlineTijd', 'vertrek', 'terug'];
    kop.forEach((k, i) => o[k] = r[i] instanceof Date
      ? Utilities.formatDate(r[i], tz, TIJD.includes(k) || r[i].getFullYear() < 1900 ? 'HH:mm' : 'yyyy-MM-dd')
      : String(r[i]));
    return o;
  });
}

function instellingen_() {
  const o = Object.assign({}, STANDAARD);
  lees_('Instellingen').forEach(r => {
    if (!(r.sleutel in STANDAARD)) return;
    o[r.sleutel] = TEKST.includes(r.sleutel) ? String(r.waarde) : Number(r.waarde);
  });
  return o;
}

// ---------- schrijven ----------

function bewaarDag(d) {
  return metSlot_(() => {
    const leeg = !Number(d.gamen) && !d.sport && !d.notitie && !Number(d.coderen) && !Number(d.slaap) && !d.bedtijd && !d.opstaan;
    if (leeg) verwijder_('Dagen', d.datum);
    blad_('Dagen').getRange('A:Z').setNumberFormat('@');   // tijden als tekst bewaren
    if (!leeg) zetRij_('Dagen', { datum: d.datum, gamen: Number(d.gamen) || 0, sport: d.sport ? 'ja' : '', notitie: d.notitie || '',
                           coderen: Number(d.coderen) || 0, slaap: Number(d.slaap) || 0,
                           bedtijd: d.bedtijd || '', opstaan: d.opstaan || '' });
    Object.keys(d.studie || {}).forEach(vak => {
      const id = d.datum + '|' + vak, uren = Number(d.studie[vak]) || 0;
      if (uren > 0) zetRij_('Studie', { id, datum: d.datum, vak, uren }); else verwijder_('Studie', id);
    });
    synchroniseerRond_(d.datum);
  });
}

// ---------- timer ----------

function timer_() {
  const p = PropertiesService.getUserProperties().getProperty('timer');
  return p ? JSON.parse(p) : null;
}

/**
 * Tijd van de telefoon of pc gebruiken, zodat de klok klopt met wat je op het scherm zag
 * (de server krijgt het verzoek soms seconden later). Wijkt die meer dan 5 minuten af, dan de tijd van de server.
 */
function tijd_(ms) {
  const nu = Date.now(), t = Number(ms);
  return t && Math.abs(t - nu) < 5 * 6e4 ? t : nu;
}

function zetTimer_(t) { PropertiesService.getUserProperties().setProperty('timer', JSON.stringify(t)); }

/**
 * meldOp (ms, alleen bij gamen): het moment waarop je vrije gametijd op is. Dan komt er een afspraak
 * "🎮 Gametijd op" in je agenda "Planner", zodat je telefoon een melding geeft, ook als de app dicht is.
 */
function startTimer(soort, vak, start, meldOp) {
  return metSlot_(() => {
    if (timer_()) throw new Error('Er loopt al een timer');
    const t = { soort, vak: vak || '', start: tijd_(start), pauzeMs: 0 };
    gameMeld_(t, meldOp);
    zetTimer_(t);
  });
}

/** Agendamelding voor het einde van je vrije gametijd (alleen als die instelling aan staat en het moment nog komt). */
function gameMeld_(t, meldOp) {
  if (t.soort !== 'gamen' || !Number(meldOp) || instellingen_().gameMelding !== 'aan') return;
  const s = new Date(Number(meldOp));
  if (s <= new Date()) return;
  try {
    const ev = plannerAgenda_().createEvent('🎮 Gametijd op', s, new Date(s.getTime() + 5 * 6e4),
      { description: 'Je vrije gametijd van vandaag is op. Stop de timer in de Planner, of ga bewust door (dan wordt het een voorschot).' });
    ev.removeAllReminders();
    ev.addPopupReminder(0);
    t.meldId = ev.getId();
  } catch (e) {}
}

/** Melding weer weghalen (timer gestopt, gepauzeerd of geannuleerd). */
function gameMeldWeg_(t) {
  if (!t || !t.meldId) return;
  try { const ev = CalendarApp.getEventById(t.meldId); if (ev) ev.deleteEvent(); } catch (e) {}
  delete t.meldId;
}

/** Pauze: onthoudt sinds wanneer de timer stilstaat. */
function pauzeerTimer(tijd) {
  return metSlot_(() => {
    const t = timer_();
    if (!t) throw new Error('Er loopt geen timer');
    if (!t.pauzeStart) { t.pauzeStart = tijd_(tijd); gameMeldWeg_(t); zetTimer_(t); }
  });
}

/** Verder: telt de pauze op bij pauzeMs, zodat die tijd niet meetelt. */
function hervatTimer(tijd, meldOp) {
  return metSlot_(() => {
    const t = timer_();
    if (!t) throw new Error('Er loopt geen timer');
    if (t.pauzeStart) {
      t.pauzeMs = (Number(t.pauzeMs) || 0) + Math.max(0, tijd_(tijd) - t.pauzeStart);
      delete t.pauzeStart;
      gameMeld_(t, meldOp);
      zetTimer_(t);
    }
  });
}

/** Stopt de timer en telt de minuten op bij de dag waarop hij startte. */
function stopTimer(minuten) {
  return metSlot_(() => {
    const t = timer_();
    if (!t) return;
    const datum = Utilities.formatDate(new Date(t.start), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const uren = Math.max(0, Number(minuten) || 0) / 60;
    if (uren > 0 && t.soort === 'studie') {
      const id = datum + '|' + t.vak, oud = lees_('Studie').find(x => x.id === id);
      zetRij_('Studie', { id, datum, vak: t.vak, uren: r2_((oud ? Number(oud.uren) : 0) + uren) });
    } else if (uren > 0) {
      // gamen of coderen: optellen bij die dag, de rest van de dag ongemoeid laten
      const oud = lees_('Dagen').find(x => x.datum === datum) || {};
      const veld = t.soort === 'coderen' ? 'coderen' : 'gamen';
      const rij = Object.assign({ datum, gamen: 0, sport: '', notitie: '', coderen: 0, slaap: 0, bedtijd: '', opstaan: '' }, oud);
      rij[veld] = r2_((Number(oud[veld]) || 0) + uren);
      zetRij_('Dagen', rij);
    }
    gameMeldWeg_(t);
    PropertiesService.getUserProperties().deleteProperty('timer');
    synchroniseerRond_(datum);
  });
}

function annuleerTimer() {
  return metSlot_(() => { gameMeldWeg_(timer_()); PropertiesService.getUserProperties().deleteProperty('timer'); });
}

function bewaarDienst(d) {
  return metSlot_(() => {
    const oud = d.id ? lees_('Diensten').find(x => x.id === d.id) : null;
    const obj = {
      id: d.id || uid_(), datum: d.datum, begin: d.begin, eind: d.eind, pauze: Number(d.pauze) || 0,
      waar: d.waar || '', toeslag: Number(d.toeslag) || 100, status: d.status || 'gepland',
      opmerking: d.opmerking || '', eventId: oud ? oud.eventId : '',
      agendaId: oud ? oud.agendaId : '',   // koppeling met je werkagenda bewaren als je de dienst aanpast
    };
    if (instellingen_().dienstenInAgenda === 'ja') obj.eventId = zetInAgenda_(obj);
    zetRij_('Diensten', obj);
    synchroniseerRond_(obj.datum);
  });
}

function verwijderDienst(id) {
  return metSlot_(() => {
    const oud = lees_('Diensten').find(x => x.id === id);
    if (oud && oud.eventId) {
      try { const ev = CalendarApp.getEventById(oud.eventId); if (ev) ev.deleteEvent(); } catch (e) {}
    }
    // staat de dienst nog in je werkagenda, onthoud dan dat je hem niet wilt (anders komt hij terug)
    if (oud && oud.agendaId && oud.status !== 'vervallen') {
      const p = PropertiesService.getScriptProperties();
      const lijst = JSON.parse(p.getProperty('werkNegeer') || '[]');
      lijst.push(oud.agendaId); p.setProperty('werkNegeer', JSON.stringify(lijst.slice(-300)));
    }
    verwijder_('Diensten', id);
  });
}

function bewaarReflectie(r) {
  return metSlot_(() => {
    zetRij_('Reflectie', { week: r.week, goed: r.goed || '', beter: r.beter || '', focus: r.focus || '' });
    synchroniseerRond_(vandaag_());
  });
}

/**
 * Weekoverzicht van de app opslaan (week = maandag, yyyy-mm-dd). Geeft niet alles terug zoals metSlot_,
 * want de app stuurt dit stil op de achtergrond en heeft het antwoord niet nodig.
 */
function bewaarWeekoverzicht(w) {
  if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(String(w.week))) throw new Error('Ongeldige week');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    zetRij_('Weekoverzicht', { week: w.week, tekst: String(w.tekst || '').slice(0, 45000),   // een cel kan max. 50.000 tekens
                               bijgewerkt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') });
  } finally { lock.releaseLock(); }
  return { ok: true };
}

/** Weekoverzichten voor het script op de pc. weken = lijst met maandagen; leeg = alles. */
function haalWeekoverzichten(weken) {
  const lijst = Array.isArray(weken) ? weken.map(String) : null;
  return lees_('Weekoverzicht').filter(w => !lijst || lijst.includes(w.week));
}

function bewaarMaanddoel(m) {
  return metSlot_(() => zetRij_('Maanddoelen', { maand: m.maand, doel: Number(m.doel) || 0, minimum: Number(m.minimum) || 0 }));
}

function bewaarTentamen(t) {
  return metSlot_(() => zetRij_('Tentamens', { id: t.id || uid_(), datum: t.datum, tijd: t.tijd || '',
                                              vak: t.vak, opmerking: t.opmerking || '' }));
}

/** Meerdere tentamens in één keer (bijv. het hele tentamenrooster geplakt). */
function bewaarTentamens(lijst) {
  return metSlot_(() => {
    (Array.isArray(lijst) ? lijst : []).filter(t => t && t.datum && t.vak).forEach(t =>
      zetRij_('Tentamens', { id: uid_(), datum: t.datum, tijd: t.tijd || '', vak: t.vak, opmerking: t.opmerking || '' }));
  });
}

function verwijderTentamen(id) {
  return metSlot_(() => verwijder_('Tentamens', id));
}

function bewaarDeadline(d) {
  return metSlot_(() => {
    zetRij_('Deadlines', { id: d.id || uid_(), datum: d.datum, tijd: d.tijd || '23:59', vak: d.vak || '',
                           wat: d.wat, klaar: d.klaar ? 'ja' : '' });
    synchroniseerRond_(vandaag_());
  });
}

/** Meerdere deadlines in één keer (bijv. de hele planning van een vak). Eén slot en één keer herinneringen bijwerken. */
function bewaarDeadlines(lijst) {
  return metSlot_(() => {
    (Array.isArray(lijst) ? lijst : []).filter(d => d && d.wat && d.datum).forEach(d =>
      zetRij_('Deadlines', { id: uid_(), datum: d.datum, tijd: d.tijd || '23:59', vak: d.vak || '', wat: d.wat, klaar: '' }));
    synchroniseerRond_(vandaag_());
  });
}

function verwijderDeadline(id) {
  return metSlot_(() => { verwijder_('Deadlines', id); synchroniseerRond_(vandaag_()); });
}

// ---------- vak klaar (voor vandaag of tot een datum) ----------

function bewaarKlaar(k) {
  return metSlot_(() => {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!k || !k.vak || !iso.test(k.van || '')) throw new Error('Vak en datum ontbreken');
    const tot = iso.test(k.tot || '') && k.tot >= k.van ? k.tot : k.van;
    blad_('Klaar').getRange('A:Z').setNumberFormat('@');
    zetRij_('Klaar', { id: k.vak + '|' + k.van, vak: k.vak, van: k.van, tot });
  });
}

function verwijderKlaar(id) {
  return metSlot_(() => verwijder_('Klaar', id));
}

// ---------- schoolvakanties en uitjes ----------

/** Controleert en schoont één periode op. Gooit een fout als hij niet klopt. */
function periode_(p) {
  const soort = PERIODE_SOORTEN.includes(p.soort) ? p.soort : 'vakantie';
  const iso = /^\d{4}-\d{2}-\d{2}$/, tijd = /^\d{2}:\d{2}$/;
  if (!iso.test(p.van || '') || !iso.test(p.tot || '')) throw new Error('Vul een begin- en einddatum in');
  if (p.tot < p.van) throw new Error('De einddatum ligt vóór de begindatum');
  return {
    id: p.id || uid_(), soort, naam: String(p.naam || '').trim() || (soort === 'uitje' ? 'Uitje' : 'Vakantie'),
    van: p.van, tot: p.tot,
    vertrek: soort === 'uitje' && tijd.test(p.vertrek || '') ? p.vertrek : '',
    terug: soort === 'uitje' && tijd.test(p.terug || '') ? p.terug : '',
  };
}

function bewaarPeriode(p) {
  return metSlot_(() => {
    blad_('Periodes').getRange('A:Z').setNumberFormat('@');   // datums en tijden als tekst bewaren
    zetRij_('Periodes', periode_(p));
    synchroniseerRond_(vandaag_());
  });
}

/** Meerdere schoolvakanties in één keer (bijv. het hele rooster van een studiejaar geplakt). */
function bewaarPeriodes(lijst) {
  return metSlot_(() => {
    blad_('Periodes').getRange('A:Z').setNumberFormat('@');
    (Array.isArray(lijst) ? lijst : []).forEach(p => zetRij_('Periodes', periode_(Object.assign({}, p, { id: '' }))));
    synchroniseerRond_(vandaag_());
  });
}

function verwijderPeriode(id) {
  return metSlot_(() => { verwijder_('Periodes', id); synchroniseerRond_(vandaag_()); });
}

/**
 * Ben je op dit moment weg (uitje)? Vertrekdag: vanaf de vertrektijd, terugkomdag: tot de terugkomtijd.
 * Zonder tijd telt de hele dag. Geeft het uitje terug, of null.
 */
function wegOp_(uitjes, datum, tijd) {
  const m = min_(tijd);
  return uitjes.find(u => {
    if (datum < u.van || datum > u.tot) return false;
    if (datum === u.van && u.vertrek && m < min_(u.vertrek)) return false;
    if (datum === u.tot && u.terug && m >= min_(u.terug)) return false;
    return true;
  }) || null;
}

function bewaarInstellingen(o) {
  return metSlot_(() => {
    const rows = Object.keys(STANDAARD).map(k => [k, TEKST.includes(k)
      ? String(o[k] === undefined ? STANDAARD[k] : o[k])
      : String(isNaN(Number(o[k])) || o[k] === '' ? STANDAARD[k] : Number(o[k]))]);
    blad_('Instellingen').getRange(2, 1, rows.length, 2).setValues(rows);
    // eerst hernoemen (studie-uren, deadlines, tentamens en de timer gaan mee naar de nieuwe naam)
    (Array.isArray(o.hernoem) ? o.hernoem : []).forEach(h => hernoemVak_(String(h.van || ''), String(h.naar || '')));
    if (Array.isArray(o.vakken)) {
      // leegmaken en opnieuw schrijven (deleteRow kan mislukken als alle rijen onder de kop weg zouden gaan)
      schrijfTab_('Vakken', o.vakken.filter(v => v.vak).map(v => ({ vak: String(v.vak), weekdoel: Number(v.weekdoel) || 0 })));
    }
    zetTrigger_();
    importeerWerk_();
    synchroniseerRond_(vandaag_());
  });
}

/**
 * Vak hernoemen: alle studie-uren, deadlines, tentamens en een lopende timer met de oude naam krijgen de nieuwe naam.
 * Staat er op een dag al tijd onder de nieuwe naam, dan worden de uren opgeteld.
 */
function hernoemVak_(van, naar) {
  if (!van || !naar || van === naar) return;
  const nieuw = {};
  let anders = false;
  lees_('Studie').forEach(x => {
    const vak = x.vak === van ? naar : x.vak;
    if (vak !== x.vak) anders = true;
    const id = x.datum + '|' + vak;
    nieuw[id] = { id, datum: x.datum, vak, uren: r2_((nieuw[id] ? nieuw[id].uren : 0) + (Number(x.uren) || 0)) };
  });
  if (anders) schrijfTab_('Studie', Object.keys(nieuw).map(k => nieuw[k]));
  lees_('Deadlines').filter(d => d.vak === van).forEach(d => zetRij_('Deadlines', Object.assign(d, { vak: naar })));
  lees_('Tentamens').filter(t => t.vak === van).forEach(t => zetRij_('Tentamens', Object.assign(t, { vak: naar })));
  const klaar = lees_('Klaar');
  if (klaar.some(k => k.vak === van))
    schrijfTab_('Klaar', klaar.map(k => k.vak === van ? Object.assign(k, { vak: naar, id: naar + '|' + k.van }) : k));
  const t = timer_();
  if (t && t.vak === van) { t.vak = naar; zetTimer_(t); }
}

/** Hele tabblad (onder de kopregel) leegmaken en opnieuw vullen met een lijst objecten. */
function schrijfTab_(tab, lijst) {
  const sh = blad_(tab), kol = TABS[tab], n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, kol.length).clearContent();
  const rijen = lijst.map(o => kol.map(k => o[k] === undefined || o[k] === null ? '' : String(o[k])));
  if (rijen.length) sh.getRange(2, 1, rijen.length, kol.length).setValues(rijen);
}

// ---------- herinneringen ----------

/**
 * Achtergrond-trigger, alleen als herinneringen aan staan: één keer per dag rond 06:00
 * zet hij de herinneringen van vandaag en morgen in je agenda "Planner".
 * Diensten uit je werkagenda worden niet op de achtergrond opgehaald, alleen als je de app opent.
 */
function zetTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['achtergrond', 'elkKwartier', 'herinner'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (instellingen_().herinneringen === 'aan')
    ScriptApp.newTrigger('achtergrond').timeBased().everyDays(1).atHour(6).create();
}

function achtergrond() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try { synchroniseerRond_(vandaag_()); } finally { lock.releaseLock(); }
}

/** Voor de app: welke herinneringen staan er voor een datum, en welke worden overgeslagen. */
function herinnerPlan(datum) {
  return { plan: herinnerPlan_(datum, instellingen_()) };
}

const AGENDA_TITELS = { ochtend: '✎ Gisteren invullen', avond: '✎ Dag invullen', reflectie: '✎ Weekreflectie' };

/** Vandaag en morgen bijwerken (na elke wijziging). */
function synchroniseerRond_(datum) {
  synchroniseer_(datum);
  synchroniseer_(plusDag_(datum, 1));
}

/**
 * Zet voor één datum de herinneringen als afspraak (met melding) in de agenda "Planner",
 * of haalt ze weg als ze niet (meer) nodig zijn: dag al ingevuld, dienst, afspraak of uitgezet.
 */
function synchroniseer_(datum) {
  const inst = instellingen_();
  const props = PropertiesService.getScriptProperties();
  const plan = inst.herinneringen === 'aan' ? herinnerPlan_(datum, inst) : [];
  const nu = new Date();
  const prefix = 'ev|' + datum + '|';
  const soorten = {};
  ['ochtend', 'avond', 'reflectie'].forEach(x => soorten[x] = true);
  plan.forEach(h => soorten[h.soort] = true);
  props.getKeys().filter(k => k.indexOf(prefix) === 0).forEach(k => soorten[k.slice(prefix.length)] = true);
  Object.keys(soorten).forEach(soort => {
    const sleutel = prefix + soort;
    const id = props.getProperty(sleutel);
    const h = plan.find(x => x.soort === soort && x.stuur);
    let ev = null;
    if (id) { try { ev = CalendarApp.getEventById(id); } catch (e) {} }
    if (!h) {
      if (!ev) props.deleteProperty(sleutel);
      else if (ev.getStartTime() > nu) { ev.deleteEvent(); props.deleteProperty(sleutel); }
      return;
    }
    const s = datum_(datum, h.tijd), e = new Date(s.getTime() + 15 * 6e4);
    const titel = h.titel || AGENDA_TITELS[soort];
    if (ev) {
      if (s > nu && ev.getStartTime().getTime() !== s.getTime()) ev.setTime(s, e);
      if (ev.getTitle() !== titel) ev.setTitle(titel);
      return;
    }
    if (s <= nu) return; // moment al voorbij
    const nieuw = plannerAgenda_().createEvent(titel, s, e, { description: h.tekst });
    nieuw.removeAllReminders();
    nieuw.addPopupReminder(0);
    props.setProperty(sleutel, nieuw.getId());
  });
}

/** Aparte agenda "Planner", zodat je de herinneringen los kunt verbergen of een kleur kunt geven. */
function plannerAgenda_() {
  return CalendarApp.getCalendarsByName('Planner')[0]
    || CalendarApp.createCalendar('Planner', { color: CalendarApp.Color.TEAL });
}

function vandaag_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }


function herinnerPlan_(datum, inst) {
  const plan = [];
  const tijden = {};
  String(inst.herinnerTijden).split(';').forEach(p => { const [d, t] = p.split('='); if (d) tijden[d.trim()] = (t || '').trim(); });
  const wd = WD[datum_(datum).getDay()];
  const dagen = lees_('Dagen'), studie = lees_('Studie'), diensten = lees_('Diensten').filter(x => x.status !== 'vervallen');
  const uitjes = lees_('Periodes').filter(p => p.soort === 'uitje');
  const ingevuld = d => dagen.some(x => x.datum === d) || studie.some(x => x.datum === d && Number(x.uren) > 0);
  // aan het werk rond dat moment: dienst begint binnen een uur of loopt nog
  const werk = t => diensten.find(x => x.datum === datum && min_(x.begin) < min_(t) + 60 && eindMin_(x) > min_(t));
  const afspraak = t => {
    if (inst.overslaanBijAfspraak !== 'ja') return null;
    try {
      const s = datum_(datum, t);
      const ev = CalendarApp.getDefaultCalendar().getEvents(s, new Date(s.getTime() + 6e4))
        .filter(e => !e.isAllDayEvent() && !isWerkTitel_(e.getTitle(), inst));
      return ev.length ? ev[0].getTitle() : null;
    } catch (e) { return null; }
  };
  const voeg = (soort, tijd, onderwerp, tekst, al) => {
    let reden = al || '';
    if (!reden) { const u = wegOp_(uitjes, datum, tijd); if (u) reden = 'je bent weg: ' + u.naam; }
    if (!reden) { const w = werk(tijd); if (w) reden = 'dienst ' + w.begin + '–' + w.eind; }
    if (!reden) { const a = afspraak(tijd); if (a) reden = 'afspraak in je agenda: ' + a; }
    plan.push({ soort, tijd, stuur: !reden, reden, onderwerp, tekst });
  };
  const hm_ = m => ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2);
  if (inst.ochtendTijd) {
    const g = plusDag_(datum, -1);
    // na een late dienst (eind na 23:00) komt de ochtendherinnering 2 uur later
    const laat = diensten.some(x => x.datum === g && eindMin_(x) >= 23 * 60);
    voeg('ochtend', laat ? hm_(Math.min(min_(inst.ochtendTijd) + 120, 23 * 60)) : inst.ochtendTijd, 'gisteren nog invullen',
      'Je hebt ' + WD_LANG[WD[datum_(g).getDay()]] + ' nog niet ingevuld: studie per vak, gamen en sportschool.',
      ingevuld(g) ? 'gisteren is al ingevuld' : '');
  }
  if (tijden[wd]) {
    voeg('avond', tijden[wd], 'vul je dag in', 'Even je dag invullen: studie per vak, gamen en sportschool.',
      ingevuld(datum) ? 'vandaag is al ingevuld' : '');
  } else {
    plan.push({ soort: 'avond', tijd: '', stuur: false, reden: 'staat uit op ' + WD_LANG[wd] });
  }
  if (wd === inst.reflectieDag && inst.reflectieTijd) {
    const ma = plusDag_(datum, -((datum_(datum).getDay() + 6) % 7));
    const al = lees_('Reflectie').some(r => r.week === ma && (r.goed || r.beter || r.focus));
    // valt de reflectie tijdens een dienst, dan een half uur na de dienst (als dat vóór 22:30 is)
    let rt = inst.reflectieTijd;
    const w = werk(rt);
    if (w && eindMin_(w) + 30 <= 22 * 60 + 30) rt = hm_(eindMin_(w) + 30);
    voeg('reflectie', rt, 'weekreflectie',
      'Tijd voor je weekreflectie: open Week en vul in wat goed ging en wat beter kan.',
      al ? 'reflectie is al ingevuld' : '');
  }
  // deadlines: X dagen van tevoren en op de dag zelf (niet overgeslagen bij diensten: te belangrijk)
  if (inst.herinneringen === 'aan') lees_('Deadlines').filter(d => d.klaar !== 'ja').forEach(d => {
    const naam = (d.vak ? d.vak + ': ' : '') + d.wat;
    const n = Number(inst.deadlineDagen) || 0;
    if (n > 0 && inst.deadlineTijd && d.datum === plusDag_(datum, n))
      plan.push({ soort: 'deadline-' + d.id + '-voor', tijd: inst.deadlineTijd, stuur: true, reden: '',
        titel: '⏰ ' + naam + ' (over ' + n + (n === 1 ? ' dag)' : ' dagen)'),
        tekst: 'Deadline ' + naam + ' op ' + WD_LANG[WD[datum_(d.datum).getDay()]] + ' ' + (d.tijd || '23:59') + '.' });
    if (d.datum === datum && inst.deadlineDagTijd && min_(inst.deadlineDagTijd) < min_(d.tijd || '23:59'))
      plan.push({ soort: 'deadline-' + d.id + '-dag', tijd: inst.deadlineDagTijd, stuur: true, reden: '',
        titel: '⏰ Vandaag: ' + naam, tekst: 'Deadline ' + naam + ' vandaag om ' + (d.tijd || '23:59') + '.' });
  });
  return plan;
}

// ---------- werkagenda (diensten uit de agenda van je werk) ----------

/** Voor de app: haalt nieuwe/gewijzigde diensten op en geeft alles terug. */
function synchroniseerWerk() {
  let info;
  metSlot_(() => { info = importeerWerk_(true); if (info.wijzigingen) synchroniseerRond_(vandaag_()); });
  return Object.assign(haalAlles(), { werkInfo: info });
}

/** Tekst veilig in een reguliere expressie zetten (bijv. een naam met een punt of haakje). */
function regexVeilig_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Is dit een afspraak van je werk? Titel begint met de naam van je werk of met de tekst die je bij ⚙︎ weghaalt. */
function isWerkTitel_(titel, inst) {
  const t = String(titel || '').toLowerCase().replace(/^changed\s+/, '');
  return [inst.werkNaam, inst.werkTitelWeg].some(w => w && t.indexOf(String(w).toLowerCase()) === 0);
}

function werkAgenda_(zoek) {
  const z = String(zoek || '').toLowerCase();
  if (!z) return null;
  return CalendarApp.getAllCalendars().find(c => c.getName().toLowerCase().includes(z)) || null;
}

/**
 * Leest diensten uit je werkagenda (vorige maand t/m 6 maanden vooruit):
 * nieuwe komen erbij, gewijzigde tijden worden bijgewerkt (zolang de dienst op Gepland staat),
 * en diensten die uit de agenda verdwijnen worden op "vervallen" gezet.
 * Locatie = de titel zonder "CHANGED", zonder de tekst die je bij ⚙︎ weghaalt en zonder " - 150%".
 */
function importeerWerk_(metInfo) {
  const inst = instellingen_();
  const info = { aan: inst.werkImport === 'aan', gevonden: false, wijzigingen: 0, tijd: '' };
  if (!info.aan) return metInfo ? info : 0;
  const cal = werkAgenda_(inst.werkAgenda);
  if (!cal) return metInfo ? info : 0;
  info.gevonden = true;
  const tz = Session.getScriptTimeZone(), nu = new Date();
  const van = new Date(nu.getFullYear(), nu.getMonth() - 1, 1), tot = new Date(nu.getFullYear(), nu.getMonth() + 7, 1);
  const negeer = JSON.parse(PropertiesService.getScriptProperties().getProperty('werkNegeer') || '[]');
  const voorvoegsel = inst.werkTitelWeg ? new RegExp('^' + regexVeilig_(inst.werkTitelWeg) + '\\s*', 'i') : null;
  const bestaand = lees_('Diensten');
  const gezien = {};
  const f = (d, p) => Utilities.formatDate(d, tz, p);
  cal.getEvents(van, tot).filter(e => !e.isAllDayEvent()).forEach(e => {
    const id = e.getId();
    gezien[id] = true;
    if (negeer.includes(id)) return;
    const d = { datum: f(e.getStartTime(), 'yyyy-MM-dd'), begin: f(e.getStartTime(), 'HH:mm'), eind: f(e.getEndTime(), 'HH:mm') };
    const titel = e.getTitle();
    let waar = titel.replace(/^CHANGED\s+/i, '');
    if (voorvoegsel) waar = waar.replace(voorvoegsel, '');
    waar = waar.replace(/\s*-\s*150\s*%\s*$/, '').trim();
    const toeslag = /150\s*%/.test(titel) ? 150 : 100;
    const m = String(e.getDescription() || '').match(/Melden:\s*(\d{2}):?(\d{2})/i);
    const opm = m ? 'melden ' + m[1] + ':' + m[2] : '';
    const x = bestaand.find(b => b.agendaId === id) || bestaand.find(b => !b.agendaId && b.datum === d.datum && b.begin === d.begin);
    if (!x) {
      zetRij_('Diensten', Object.assign({ id: uid_(), pauze: stdPauze_(d, inst), waar, toeslag, status: 'gepland',
                                          opmerking: opm, eventId: '', agendaId: id }, d));
      info.wijzigingen++;
      return;
    }
    const nieuw = Object.assign({}, x, { agendaId: id });
    if (x.status !== 'gewerkt') {
      Object.assign(nieuw, d, { status: 'gepland', toeslag: Math.max(Number(x.toeslag) || 100, toeslag) });
      if (x.datum !== d.datum || x.begin !== d.begin || x.eind !== d.eind) nieuw.pauze = stdPauze_(d, inst);
      if (!x.waar) nieuw.waar = waar;
      if (!x.opmerking) nieuw.opmerking = opm;
    }
    if (!gelijk_(x, nieuw)) { zetRij_('Diensten', nieuw); info.wijzigingen++; }
  });
  bestaand.filter(b => b.agendaId && !gezien[b.agendaId] && b.status === 'gepland'
                    && datum_(b.datum) >= van && datum_(b.datum) < tot)
    .forEach(b => { zetRij_('Diensten', Object.assign({}, b, { status: 'vervallen' })); info.wijzigingen++; });
  info.tijd = f(nu, 'HH:mm');
  return metInfo ? info : info.wijzigingen;
}

function stdPauze_(d, inst) {
  return (eindMin_(d) - min_(d.begin)) / 60 > inst.pauzeVanaf ? inst.pauzeMin : 0;
}

function gelijk_(a, b) {
  return TABS.Diensten.every(k => String(a[k] === undefined ? '' : a[k]) === String(b[k] === undefined ? '' : b[k]));
}

// ---------- agenda ----------

function zetInAgenda_(d) {
  try {
    const [s, e] = tijden_(d);
    const titel = (instellingen_().werkNaam || 'Werk') + (d.waar ? ' – ' + d.waar : '');
    const ev = d.eventId ? CalendarApp.getEventById(d.eventId) : null;
    if (ev) { ev.setTime(s, e); ev.setTitle(titel); return d.eventId; }
    return CalendarApp.getDefaultCalendar().createEvent(titel, s, e, { description: 'Dienst uit Planner' }).getId();
  } catch (err) {
    return d.eventId || '';
  }
}

function tijden_(d) {
  const s = datum_(d.datum, d.begin);
  let e = datum_(d.datum, d.eind);
  if (e <= s) e = new Date(e.getTime() + 864e5); // dienst tot na middernacht
  return [s, e];
}

// ---------- hulp ----------

function blad_(tab) { return SpreadsheetApp.getActive().getSheetByName(tab); }

function metSlot_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { fn(); } finally { lock.releaseLock(); }
  return haalAlles();
}

/** Voegt een rij toe of werkt hem bij; de eerste kolom is de sleutel. */
function zetRij_(tab, obj) {
  const sh = blad_(tab), kol = TABS[tab];
  const rij = kol.map(k => obj[k] === undefined || obj[k] === null ? '' : String(obj[k]));
  const n = sh.getLastRow() - 1;
  if (n > 0) {
    const sleutels = sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0]));
    const i = sleutels.indexOf(String(obj[kol[0]]));
    if (i >= 0) { sh.getRange(i + 2, 1, 1, kol.length).setValues([rij]); return; }
  }
  sh.appendRow(rij);
}

function verwijder_(tab, sleutel) {
  const sh = blad_(tab);
  const v = sh.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === String(sleutel)) sh.deleteRow(i + 1);
}

function min_(t) { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function eindMin_(d) { const b = min_(d.begin), e = min_(d.eind); return e <= b ? e + 1440 : e; }
function r2_(n) { return Math.round(n * 100) / 100; }
function plusDag_(s, n) {
  const d = datum_(s); d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function datum_(s, tijd) {
  const [y, m, d] = s.split('-').map(Number);
  const [h, mi] = (tijd || '0:0').split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0);
}

function uid_() { return Utilities.getUuid().slice(0, 8); }
