const fs = require('fs');
const http = require('http');
const { parseStringPromise } = require('xml2js');

// URL del file XML da Miogest
const xmlUrl = "http://partner.miogest.com/agenzie/vella.xml";

// Percorsi dei file locali
const TEMPLATE_PATH = './template.html';
const OUTPUT_PATH = './index.html';

// Link di default per il bottone "Vedi dettagli"
const DEFAULT_DETAIL_LINK = 'https://www.luxuryacademy.online/';

// Funzione per scaricare il file XML
function fetchXML(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Funzione per generare una card HTML a partire da un annuncio
function generateCard(annuncio) {
  const get = (tag) => annuncio[tag]?.[0] || '';
  const foto = annuncio.Foto?.[0] || '';
  const titolo = get('Titolo');
  const comune = get('Comune');
  const prezzo = get('Prezzo');
  const descrizione = get('Descrizione');
  const descrizioneShort = descrizione.length > 150 ? descrizione.substring(0, 150) + '...' : descrizione;

  // Salta gli annunci incompleti
  if (!foto || !titolo || !comune || !prezzo || !descrizione) return '';

  return `
    <div class="property-card">
      <div class="property-image">
        <img src="${foto}" alt="Immagine proprietà">
      </div>
      <div class="property-details">
        <div class="property-title">${titolo}</div>
        <div class="property-location">${comune}</div>
        <div class="property-price">${prezzo} €</div>
        <div class="property-description">${descrizioneShort}</div>
        <a class="view-button" href="${DEFAULT_DETAIL_LINK}" target="_blank">Vedi dettagli</a>
      </div>
    </div>
  `;
}

// Funzione principale
(async () => {
  try {
    console.log("📥 Scarico il feed XML...");
    const xmlData = await fetchXML(xmlUrl);

    console.log("📦 Parsing del feed...");
    const parsed = await parseStringPromise(xmlData);
    const annunci = parsed.Annunci?.Annuncio || [];

    if (!annunci.length) {
      console.log('⚠️ Nessun annuncio trovato nel feed XML.');
    }

    console.log(`🧱 Genero ${annunci.length} card...`);
    const cardsHtml = annunci.map(generateCard).filter(Boolean).join('\n');

    console.log("🧩 Carico il template...");
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

    // Inserisce le card nel punto definito dal placeholder
    const output = template.replace('<!-- PROPERTIES_CARDS -->', cardsHtml);

    fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
    console.log('✅ index.html generato con successo!');
  } catch (err) {
    console.error('❌ Errore durante la generazione:', err);
    process.exit(1); // Segnala fallimento in ambienti CI come GitHub Actions
  }
})();
