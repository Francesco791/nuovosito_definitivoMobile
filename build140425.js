const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');
const { parseStringPromise } = require('xml2js');

const xmlUrl = "http://partner.miogest.com/agenzie/vella.xml";
const TEMPLATE_PATH = './template.html';
const OUTPUT_PATH = './index.html';
const DEFAULT_DETAIL_LINK = 'https://www.luxuryacademy.online/';

function fetchXML(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function generateCard(annuncio) {
  const get = (tag) => annuncio[tag]?.[0] || '';
  const foto = annuncio.Foto?.[0] || '';
  const titolo = get('Titolo');
  const comune = get('Comune');
  const prezzo = get('Prezzo');
  const descrizione = get('Descrizione');
  const contratto = get('TipoContratto')?.toLowerCase();

  if (!foto || !titolo || !comune || !prezzo || !descrizione || !contratto) return '';

  const descrizioneShort = descrizione.length > 150
    ? descrizione.substring(0, 150) + '...'
    : descrizione;

  return `
    <div class="property-card" data-contratto="${contratto}">
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
    const output = template.replace('<!-- PROPERTIES_CARDS -->', cardsHtml);

    fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
    console.log('✅ index.html generato con successo!');

    // 🔄 Commit & push automatico su GitHub
    console.log("🔁 Controllo modifiche...");
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
    execSync('git add index.html');

    try {
      execSync('git diff --cached --quiet');
      console.log("🟢 Nessuna modifica da committare.");
    } catch {
      console.log("📝 Committo le modifiche...");
      execSync('git commit -m "🔄 Aggiornamento automatico index.html"');
      console.log("🚀 Eseguo push...");
      execSync('git push');
      console.log("✅ Push completato con successo!");
    }

  } catch (err) {
    console.error('❌ Errore durante la generazione:', err);
    process.exit(1);
  }
})();
