const fs = require('fs');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const { parseStringPromise } = require('xml2js');

const xmlUrl = "http://partner.miogest.com/agenzie/vella.xml";
const TEMPLATE_PATH = './template.html';
const OUTPUT_PATH = './index.html';

function fetchXML(url) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const httpModule = isHttps ? https : http;
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/xml, text/xml, */*',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
      },
      timeout: 30000
    };

    const req = httpModule.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchXML(res.headers.location).then(resolve).catch(reject);
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`Status Code: ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(30000);
  });
}

// Estrai caratteristiche dall'annuncio
function estraiCaratteristiche(annuncio) {
  const get = (tag) => annuncio[tag]?.[0] || '';
  const caratteristiche = [];
  
  const titolo = get('Titolo').toLowerCase();
  const descrizione = get('Descrizione').toLowerCase();
  const panorama = get('Scheda_Panorama').toLowerCase();
  const giardino = get('Scheda_Giardino').toLowerCase();
  const balconi = get('Scheda_Balconi').toLowerCase();
  const terrazzi = get('Scheda_Terrazzi').toLowerCase();
  const mqGiardino = parseInt(get('MqGiardino')) || 0;
  const mqTerrazzo = parseInt(get('MqTerrazzo')) || 0;
  const mqBalconi = parseInt(get('MqBalconi')) || 0;
  const postiAuto = parseInt(get('PostiAuto')) || 0;

  // Vista lago/panoramica
  if (titolo.includes('vista') || 
      descrizione.includes('vista') || 
      panorama.includes('vista') ||
      panorama.includes('lago') ||
      panorama.includes('aperta')) {
    caratteristiche.push('vista');
  }

  // Attico
  if (titolo.includes('attico') || descrizione.includes('attico')) {
    caratteristiche.push('attico');
  }

  // Giardino
  if (giardino === 'privato' || 
      mqGiardino > 0 || 
      descrizione.includes('giardino')) {
    caratteristiche.push('giardino');
  }

  // Terrazzo
  if (mqTerrazzo > 0 || 
      terrazzi !== 'no' ||
      descrizione.includes('terrazzo')) {
    caratteristiche.push('terrazzo');
  }

  // Box/Garage
  if (postiAuto > 0 || 
      descrizione.includes('garage') || 
      descrizione.includes('box')) {
    caratteristiche.push('box');
  }

  return caratteristiche.join(',');
}

// Estrai il link dell'annuncio dalle LandingPages
function estraiLinkLandingPage(annuncio, index) {
  const get = (tag) => annuncio[tag]?.[0] || '';
  
  // Debug: ispeziona LandingPages per il primo annuncio
  if (index === 0) {
    console.log('\n🔍 === ANALISI LANDING PAGES ===');
    const landingPages = annuncio.LandingPages?.[0];
    console.log('📋 LandingPages tipo:', typeof landingPages);
    console.log('📋 LandingPages valore:', JSON.stringify(landingPages, null, 2));
  }
  
  let link = '';
  
  // Prova a estrarre da LandingPages
  const landingPages = annuncio.LandingPages?.[0];
  if (landingPages && typeof landingPages === 'object') {
    // NUOVO: Gestisci la struttura corretta con campo '_'
    if (landingPages.Url && Array.isArray(landingPages.Url) && landingPages.Url[0]) {
      const urlObj = landingPages.Url[0];
      if (typeof urlObj === 'object' && urlObj._) {
        // Struttura: { _: 'url', '$': { lingua: 'it' } }
        link = urlObj._;
      } else if (typeof urlObj === 'string') {
        // Struttura semplice: ['url']
        link = urlObj;
      }
    }
    
    // Prova altri possibili campi se Url non funziona
    if (!link && landingPages.Link && Array.isArray(landingPages.Link) && landingPages.Link[0]) {
      const linkObj = landingPages.Link[0];
      if (typeof linkObj === 'object' && linkObj._) {
        link = linkObj._;
      } else if (typeof linkObj === 'string') {
        link = linkObj;
      }
    }
  }
  
  // Fallback: prova altri campi standard
  if (!link) {
    link = get('Url') || get('Link') || get('UrlAnnuncio') || '';
  }
  
  // Se ancora non trovato, genera link con codice annuncio
  if (!link) {
    const codice = get('Codice');
    const annuncioId = get('AnnuncioId');
    
    if (codice) {
      // Link diretto al sito con codice
      link = `https://porpoise-helicon-zwed.squarespace.com/proprieta?codice=${codice}`;
    } else if (annuncioId) {
      // Link con ID annuncio
      link = `https://porpoise-helicon-zwed.squarespace.com/proprieta?id=${annuncioId}`;
    } else {
      // Link generico alla sezione proprietà
      link = 'https://porpoise-helicon-zwed.squarespace.com/proprieta';
    }
  }
  
  return link;
}

// Determina la tipologia dell'immobile
function determinaTipologia(annuncio) {
  const get = (tag) => annuncio[tag]?.[0] || '';
  const titolo = get('Titolo').toLowerCase();
  const tipologia = get('Tipologia').toLowerCase();
  const categoria = get('Categoria');
  
  // Mappatura basata sul titolo e tipologia
  if (titolo.includes('attico')) return 'appartamento';
  if (titolo.includes('appartamento')) return 'appartamento';
  if (titolo.includes('villa') || titolo.includes('casa')) return 'casa';
  if (titolo.includes('ufficio') || titolo.includes('commerciale')) return 'commerciale';
  
  // Mappatura basata sulla tipologia XML
  if (tipologia === 'v') return 'casa'; // Villa
  if (tipologia === 'a') return 'appartamento'; // Appartamento
  if (tipologia === 'u') return 'commerciale'; // Ufficio
  
  // Fallback: appartamento
  return 'appartamento';
}

function generateCard(annuncio, index) {
  const get = (tag) => annuncio[tag]?.[0] || '';
  
  // Estrai tutti i campi
  const foto = get('Foto') || 'https://via.placeholder.com/400x250/6E5C4F/ffffff?text=Immagine+non+disponibile';
  const titolo = get('Titolo') || 'Immobile senza titolo';
  const comune = get('Comune') || 'Località non specificata';
  const regione = get('Regione') || '';
  const provincia = get('Provincia') || '';
  const prezzo = get('Prezzo') || '0';
  const valuta = get('Valuta') || 'CHF';
  const descrizione = get('Descrizione') || 'Descrizione non disponibile';
  const contratto = (get('Offerta') === 'si' ? 'vendita' : 'affitto').toLowerCase();
  
  // NUOVO: Estrai link dalle LandingPages
  const linkAnnuncio = estraiLinkLandingPage(annuncio, index);
  
  // Dati tecnici
  const mq = get('Mq') || '0';
  const vani = get('Vani') || '0';
  const camere = get('Camere') || '0';
  const bagni = get('Bagni') || '0';
  const categoria = get('Categoria') || '';
  const tipologiaImmobile = determinaTipologia(annuncio);
  const caratteristiche = estraiCaratteristiche(annuncio);
  
  // Formatta il prezzo
  const prezzoNum = parseInt(prezzo) || 0;
  const prezzoFormattato = prezzoNum > 0 
    ? `${valuta} ${prezzoNum.toLocaleString('it-CH')}` 
    : 'Prezzo su richiesta';

  const descrizioneShort = descrizione.length > 150
    ? descrizione.substring(0, 150) + '...'
    : descrizione;

  console.log(`✅ Card ${index + 1}: "${titolo}" - ${comune} - ${prezzoFormattato}`);
  console.log(`🔗 Link: ${linkAnnuncio}`);

  return `
    <div class="property-card" 
         data-contratto="${contratto}"
         data-categoria="${tipologiaImmobile}"
         data-categoria-codici="${categoria}"
         data-caratteristiche="${caratteristiche}"
         data-comune="${comune.toLowerCase()}"
         data-regione="${regione.toLowerCase()}"
         data-provincia="${provincia.toLowerCase()}"
         data-prezzo="${prezzo}"
         data-mq="${mq}"
         data-vani="${vani}"
         data-camere="${camere}"
         data-bagni="${bagni}">
      <div class="property-image">
        <img src="${foto}" alt="${titolo}" onerror="this.src='https://via.placeholder.com/400x250/6E5C4F/ffffff?text=Immagine+non+disponibile'">
      </div>
      <div class="property-details">
        <div class="property-title">${titolo}</div>
        <div class="property-location">${comune}${regione ? ', ' + regione : ''}</div>
        <div class="property-price">${prezzoFormattato}</div>
        <div class="property-specs">${mq} m² • ${vani} vani • ${camere} camere • ${bagni} bagni</div>
        <div class="property-description">${descrizioneShort}</div>
        <div class="property-buttons">
          <a class="view-button" href="${linkAnnuncio}" target="_blank">
            Vedi Dettagli
          </a>
          <a class="contact-button" href="https://porpoise-helicon-zwed.squarespace.com/proprieta#block-874fb03d4b505fd29efa">
            Contattaci
          </a>
        </div>
      </div>
    </div>
  `;
}

(async () => {
  try {
    console.log("📥 Scarico il feed XML...");
    const xmlData = await fetchXML(xmlUrl);

    console.log("📦 Parsing del feed...");
    const parsed = await parseStringPromise(xmlData);
    const annunci = parsed.Annunci?.Annuncio || [];

    console.log(`🧱 Trovati ${annunci.length} annunci nel feed`);

    if (!annunci.length) {
      console.log('⚠️ Nessun annuncio trovato nel feed XML.');
      process.exit(1);
    }

    console.log(`🏗️ Genero ${annunci.length} card complete con link LandingPages...`);
    const cardsHtml = annunci.map(generateCard).filter(Boolean).join('\n');

    console.log("🧩 Carico il template...");
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const output = template.replace('<!-- PROPERTIES_CARDS -->', cardsHtml);

    fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
    console.log('✅ index.html generato con successo!');

    // Statistiche
    const tipi = {};
    annunci.forEach(annuncio => {
      const tipo = determinaTipologia(annuncio);
      tipi[tipo] = (tipi[tipo] || 0) + 1;
    });
    
    console.log('\n📊 Statistiche immobili:');
    Object.entries(tipi).forEach(([tipo, count]) => {
      console.log(`  ${tipo}: ${count} immobili`);
    });

    // Commit & push
    console.log("\n🔁 Controllo modifiche...");
    try {
      execSync('git config user.name "github-actions[bot]"');
      execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
      execSync('git add index.html');

      try {
        execSync('git diff --cached --quiet');
        console.log("🟢 Nessuna modifica da committare.");
      } catch {
        console.log("📝 Committo le modifiche...");
        execSync(`git commit -m "🔄 Aggiornamento automatico del ${new Date().toLocaleString('it-IT')}"`);
        console.log("🚀 Eseguo push...");
        execSync('git push');
        console.log("✅ Push completato con successo!");
      }
    } catch (gitError) {
      console.log("⚠️ Errore Git (ignorato):", gitError.message);
    }

  } catch (err) {
    console.error('❌ Errore durante la generazione:', err.message);
    
    // Fallback: mantieni il file esistente
    if (fs.existsSync(OUTPUT_PATH)) {
      console.log("🔄 Errore nel feed, mantengo l'index.html esistente");
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
})();